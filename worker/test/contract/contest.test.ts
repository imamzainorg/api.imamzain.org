import { hkdfSync, createHmac } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HARNESS_JWT_SECRET } from '../harness/config';
import { adminToken, api, expectError, expectSuccess, tokenWith, withDb, workerOnly } from './support/http';
import { uid } from './support/rbac';

const BASE = '/api/v1/forms/qutuf-sajjadiya-contest';
const MISSING = '00000000-0000-4000-8000-000000000000';
const CLOSED = 'انتهت مسابقة قطوف من الصحيفة السجادية ولم تعد تستقبل مشاركات جديدة.';
const ALREADY = 'لقد شاركتَ في المسابقة مسبقاً، لا يمكنك المشاركة مرة أخرى.';

/** The token formula both sides must share, so attempts started on one side submit on the other. */
function expectedToken(attemptId: string): string {
  const key = Buffer.from(hkdfSync('sha256', process.env.JWT_SECRET ?? HARNESS_JWT_SECRET, Buffer.from('imamzain.org/api/hmac-key-derivation/v1'), 'imamzain/contest-attempt/v1', 32));
  return createHmac('sha256', key).update(attemptId).digest('hex');
}

const setOpen = (value: string) =>
  withDb((q) => q(`INSERT INTO site_settings (key, value, type) VALUES ('contest_open', $1, 'boolean') ON CONFLICT (key) DO UPDATE SET value = $1`, [value]));

let previous: string | null = null;
let key: Map<string, string>;

beforeAll(async () => {
  await withDb(async (q) => {
    previous = ((await q(`SELECT value FROM site_settings WHERE key = 'contest_open'`))[0]?.value as string) ?? null;
    // The CI seed has no questions; the prod copy has the real 50.
    if ((await q('SELECT 1 FROM qutuf_sajjadiya_contest_questions LIMIT 1')).length === 0) {
      await q(`INSERT INTO qutuf_sajjadiya_contest_questions (id, question, option_a, option_b, option_c, option_d, correct_answer) VALUES
        ('١', 'q1', 'a', 'b', 'c', 'd', 'A'), ('٢', 'q2', 'a', 'b', 'c', 'd', 'B'), ('١٠', 'q10', 'a', 'b', 'c', 'd', 'C')`);
    }
    key = new Map((await q('SELECT id, correct_answer FROM qutuf_sajjadiya_contest_questions')).map((r) => [r.id as string, r.correct_answer as string]));
  });
  await setOpen('true');
});

afterAll(async () => {
  if (previous === null) await withDb((q) => q(`DELETE FROM site_settings WHERE key = 'contest_open'`));
  else await setOpen(previous);
});

const start = (contact: string, contactType = 'phone', name = 'Participant') => api(`${BASE}/start`, { method: 'POST', body: { name, contact, contactType } });
const submit = (body: unknown) => api(`${BASE}/submit`, { method: 'POST', body });
const wrong = (a: string) => ({ A: 'B', B: 'C', C: 'D', D: 'A' })[a]!;
/** Every question answered, the first `right` of them correctly. */
const answers = (right: number) => [...key].map(([question_id, correct], i) => ({ question_id, answer: i < right ? correct : wrong(correct) }));
const phone = () => `+964${Math.floor(1e9 + Math.random() * 9e9)}`;

async function started(contact = phone(), contactType = 'phone') {
  const res = await start(contact, contactType);
  expectSuccess(res, 201);
  const { attempt_id, attempt_token } = res.body.data as { attempt_id: string; attempt_token: string };
  return { attempt_id, attempt_token };
}

describe('GET /questions (public)', () => {
  it('lists the questions in numeric order of their Arabic-Indic ids, without the answers, CDN-cacheable', async () => {
    const res = await api(`${BASE}/questions`);
    expectSuccess(res);
    expect(res.body.message).toBe('Questions fetched');
    expect(res.headers.get('cache-control')).toBe('public, max-age=300, s-maxage=3600');
    expect(Object.keys(res.body.data[0])).toEqual(['id', 'question', 'option_a', 'option_b', 'option_c', 'option_d']);
    const numeric = (id: string) => Number(id.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)));
    const ids: string[] = res.body.data.map((q: { id: string }) => q.id);
    expect(ids).toEqual([...ids].sort((a, b) => numeric(a) - numeric(b)));
    expect(ids).toHaveLength(key.size);
  });
});

describe('POST /start', () => {
  it('opens an attempt with a token both implementations derive the same way', async () => {
    const res = await start(phone());
    expectSuccess(res, 201);
    expect(res.body.message).toBe('Contest started');
    expect(res.body.data).toEqual({ attempt_id: expect.any(String), attempt_token: expectedToken(res.body.data.attempt_id), resumed: false });
  });

  it('resumes an unsubmitted attempt for any spelling of the same identity', async () => {
    const digits = String(Math.floor(1e9 + Math.random() * 9e9));
    const first = await started(`+964${digits}`);
    for (const variant of [`00964${digits}`, `+964 ${digits.slice(0, 3)}-${digits.slice(3)}`]) {
      const res = await start(variant);
      expectSuccess(res, 201);
      expect(res.body).toMatchObject({ message: 'Contest resumed', data: { attempt_id: first.attempt_id, attempt_token: first.attempt_token, resumed: true } });
    }

    const email = `${uid('p')}@example.com`;
    const byEmail = await started(email, 'email');
    // Case folds; surrounding spaces fail the e-mail format check before normalisation.
    expect((await start(email.toUpperCase(), 'email')).body.data.attempt_id).toBe(byEmail.attempt_id);
  });

  it('refuses an identity that already submitted', async () => {
    const contact = phone();
    const a = await started(contact);
    expectSuccess(await submit({ ...a, answers: answers(0) }));
    expectError(await start(contact.replace('+', '00')), 409, 'CONFLICT', ALREADY);
  });

  it('checks the contact against its declared type', async () => {
    expectError(await start('not-a-phone'), 400, 'BAD_REQUEST', 'Invalid phone number format');
    expectError(await start('+9647801234567', 'email'), 400, 'BAD_REQUEST', 'Invalid email format');
    const res = await start('+9647801234567', 'fax');
    expectError(res, 400, 'VALIDATION_FAILED');
    expect(res.body.errors).toEqual(['contactType must be one of the following values: phone, email']);
  });
});

describe('POST /submit', () => {
  it('scores the attempt once and reveals the score', async () => {
    const a = await started();
    const res = await submit({ ...a, answers: answers(1) });
    expectSuccess(res);
    expect(res.body).toMatchObject({ message: 'Contest submitted', data: { final_score: 1, total_questions: key.size, score_revealed: true } });

    expectError(await submit({ ...a, answers: answers(key.size) }), 409, 'CONFLICT', 'This attempt has already been submitted');
    const stored = await withDb((q) => q('SELECT final_score, submitted_at FROM qutuf_sajjadiya_contest_attempts WHERE id = $1', [a.attempt_id]));
    expect(stored[0]).toMatchObject({ final_score: 1, submitted_at: expect.any(Date) });
  });

  it('works without a token, and counts a repeated question once', async () => {
    const a = await started();
    const all = answers(key.size);
    const res = await submit({ attempt_id: a.attempt_id, answers: [all[0], all[0], ...all.slice(1)] });
    expectSuccess(res);
    expect(res.body.data.final_score).toBe(key.size);
  });

  it('refuses an incomplete set, even padded with repeats or unknown ids', async () => {
    const a = await started();
    const all = answers(key.size);
    const short = all.slice(1);
    for (const list of [short, [...short, short[0]], [...short, { question_id: 'nope', answer: 'A' }]]) {
      expectError(await submit({ ...a, answers: list }), 409, 'CONFLICT', 'All questions must be answered');
    }
  });

  it('refuses a wrong token and an unknown attempt', async () => {
    const a = await started();
    expectError(await submit({ ...a, attempt_token: 'f'.repeat(64), answers: answers(0) }), 401, 'UNAUTHORIZED', 'Invalid attempt token');
    expectError(await submit({ attempt_id: MISSING, answers: answers(0) }), 404, 'NOT_FOUND', 'Attempt not found');
  });

  it.each([
    ['a bad attempt id', { attempt_id: 'x', answers: [{ question_id: '١', answer: 'A' }] }, ['attempt_id must be a UUID']],
    ['no answers', { attempt_id: MISSING, answers: [] }, ['answers must contain at least 1 elements']],
    ['a lower-case answer', { attempt_id: MISSING, answers: [{ question_id: '١', answer: 'a' }] }, ['answers.0.answer must be one of the following values: A, B, C, D']],
  ])('rejects %s', async (_name, body, errors) => {
    const res = await submit(body);
    expectError(res, 400, 'VALIDATION_FAILED', 'Validation failed');
    expect(res.body.errors).toEqual(errors);
  });

  // Nest's @IsOptional lets null through, then hashing it throws (500).
  workerOnly('worker-only: a null attempt_token counts as absent', async () => {
    const a = await started();
    expectSuccess(await submit({ attempt_id: a.attempt_id, attempt_token: null, answers: answers(0) }));
  });
});

describe('while the contest is closed', () => {
  it('refuses /start and /submit, even for an attempt opened while it was open; questions stay public', async () => {
    const a = await started();
    await setOpen('false');
    try {
      expectError(await start(phone()), 403, 'CONTEST_CLOSED', CLOSED);
      expectError(await submit({ ...a, answers: answers(0) }), 403, 'CONTEST_CLOSED', CLOSED);
      expectSuccess(await api(`${BASE}/questions`));
    } finally {
      await setOpen('true');
    }
  });
});

describe('GET /attempts (admin)', () => {
  it('lists attempts newest first, filtered by submission', async () => {
    const open = await started();
    const done = await started();
    expectSuccess(await submit({ ...done, answers: answers(0) }));
    const token = await adminToken();

    const res = await api(`${BASE}/attempts?limit=100`, { token });
    expectSuccess(res);
    expect(res.body.message).toBe('Attempts fetched');
    expect(Object.keys(res.body.data.items[0])).toEqual(['id', 'name', 'phone', 'email', 'started_at', 'submitted_at', 'ip', 'user_agent', 'final_score']);
    const ids = res.body.data.items.map((r: { id: string }) => r.id);
    expect(ids.indexOf(done.attempt_id)).toBeLessThan(ids.indexOf(open.attempt_id));

    const submitted = (await api(`${BASE}/attempts?submitted=true&limit=100`, { token })).body.data.items.map((r: { id: string }) => r.id);
    const pending = (await api(`${BASE}/attempts?submitted=false&limit=100`, { token })).body.data.items.map((r: { id: string }) => r.id);
    expect(submitted).toContain(done.attempt_id);
    expect(submitted).not.toContain(open.attempt_id);
    expect(pending).toContain(open.attempt_id);
  });

  it('is 401 / 403 without contest:read, and validates the filter', async () => {
    expectError(await api(`${BASE}/attempts`), 401, 'UNAUTHORIZED');
    expectError(await api(`${BASE}/attempts`, { token: await tokenWith(['forms:read']) }), 403, 'FORBIDDEN', 'You do not have permission to access this resource');
    const res = await api(`${BASE}/attempts?submitted=yes`, { token: await adminToken() });
    expectError(res, 400, 'VALIDATION_FAILED');
    expect(res.body.errors).toEqual(['submitted must be a boolean value']);
  });
});
