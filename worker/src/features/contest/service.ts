import type { Context } from 'hono';
import { Prisma } from '../../generated/prisma/client';
import { getDb } from '../../lib/db';
import { badRequest, conflict, forbidden, isUniqueViolation, notFound, unauthorized } from '../../lib/errors';
import { hmacHex, KEY_INFO, resolveHmacKeyring, verifyHmacHex, type HmacKeyring } from '../../lib/hmac-keys';
import { buildPaginationMeta } from '../../lib/pagination';
import type { AppBindings, AppEnv } from '../../lib/types';
import type { StartInput, SubmitInput } from './schemas';

type Ctx = Context<AppEnv>;
type ContactType = 'phone' | 'email';

const PHONE_RE = /^\+?[\d\s-]{7,20}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const ALREADY_PARTICIPATED = 'لقد شاركتَ في المسابقة مسبقاً، لا يمكنك المشاركة مرة أخرى.';

// The CMS flips `contest_open`; a missing or malformed row reads as CLOSED (the contest ended in
// September 2026, and no environment should open it by accident).
const CONTEST_OPEN_SETTING_KEY = 'contest_open';
const CONTEST_CLOSED_MESSAGE = 'انتهت مسابقة قطوف من الصحيفة السجادية ولم تعد تستقبل مشاركات جديدة.';

const OFF_VALUES = new Set(['false', '0', 'no', 'off']);

/**
 * The stored and compared form of a contact, so variants of one person collapse to one identity:
 * e-mail trimmed and lower-cased; phone without spaces and dashes, the "00" prefix folded into "+".
 * A leading national "0" is not rewritten: the contest is worldwide, there is no default country.
 */
export function canonicalContact(contactType: ContactType, raw: string): string {
  if (contactType === 'email') return raw.trim().toLowerCase();
  const compact = raw.replace(/[\s-]/g, '');
  return compact.startsWith('00') ? `+${compact.slice(2)}` : compact;
}

/** Every stored form of one identity: rows written before "00" was folded still carry it. */
export function identityVariants(contactType: ContactType, canonical: string): string[] {
  if (contactType === 'phone' && canonical.startsWith('+')) return [canonical, `00${canonical.slice(1)}`];
  return [canonical];
}

/**
 * CONTEST_REVEAL_SCORE: on unless false/0/no/off. An instant score for an unverified identity is an
 * answer-key oracle, so a contest with a prize switches it off and the committee announces results.
 */
export function scoreIsRevealed(env: { CONTEST_REVEAL_SCORE?: string }): boolean {
  const raw = env.CONTEST_REVEAL_SCORE?.trim().toLowerCase();
  return raw === undefined || raw === '' || !OFF_VALUES.has(raw);
}

/** A dedicated CONTEST_ATTEMPT_SECRET as-is; otherwise a key derived from JWT_SECRET (see lib/hmac-keys). */
const attemptKeys = (env: AppBindings): HmacKeyring =>
  resolveHmacKeyring({ dedicatedSecret: env.CONTEST_ATTEMPT_SECRET, dedicatedName: 'CONTEST_ATTEMPT_SECRET', jwtSecret: env.JWT_SECRET, info: KEY_INFO.contestAttempt });

/** HMAC of the attempt id: a stolen or guessed id can't be submitted without it. */
const signAttemptToken = (env: AppBindings, attemptId: string) => hmacHex(attemptKeys(env).signingKey, attemptId);

interface Question {
  id: string;
  question: string;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
}

async function assertContestOpen(c: Ctx): Promise<void> {
  const row = await getDb(c).site_settings.findUnique({ where: { key: CONTEST_OPEN_SETTING_KEY } });
  if (row?.value === 'true') return;
  throw forbidden(CONTEST_CLOSED_MESSAGE, { code: 'CONTEST_CLOSED' });
}

export async function findAllAttempts(c: Ctx, page: number, limit: number, submitted?: boolean) {
  const db = getDb(c);
  const where: Prisma.qutuf_sajjadiya_contest_attemptsWhereInput = {};
  if (submitted === true) where.submitted_at = { not: null };
  if (submitted === false) where.submitted_at = null;

  const [items, total] = await Promise.all([
    db.qutuf_sajjadiya_contest_attempts.findMany({
      where,
      orderBy: [{ started_at: 'desc' }, { id: 'asc' }],
      skip: (page - 1) * limit,
      take: limit,
      select: { id: true, name: true, phone: true, email: true, started_at: true, submitted_at: true, ip: true, user_agent: true, final_score: true },
    }),
    db.qutuf_sajjadiya_contest_attempts.count({ where }),
  ]);
  return { message: 'Attempts fetched', data: { items, pagination: buildPaginationMeta(page, limit, total) } };
}

export async function listQuestions(c: Ctx) {
  // `id` holds Arabic-Indic numerals (١..٥٠): a plain ORDER BY id sorts ١, ١٠, ١١ … so sort on the
  // ASCII transliteration, numerically; an id without digits sorts last instead of failing.
  const rows = await getDb(c).$queryRaw<Question[]>`
    SELECT id, question, option_a, option_b, option_c, option_d
    FROM qutuf_sajjadiya_contest_questions
    ORDER BY
      NULLIF(regexp_replace(translate(id, '٠١٢٣٤٥٦٧٨٩', '0123456789'), '\\D', '', 'g'), '')::int
        ASC NULLS LAST,
      id ASC
  `;
  return { message: 'Questions fetched', data: rows };
}

/** The attempt holding this identity, in either column and in any stored form. */
const findAttemptByIdentity = (c: Ctx, variants: string[]) =>
  getDb(c).qutuf_sajjadiya_contest_attempts.findFirst({
    where: { OR: [{ phone: { in: variants } }, { email: { in: variants } }] },
    select: { id: true, submitted_at: true, final_score: true },
  });

/**
 * /start is idempotent for an attempt never submitted: a lost response must not lock the person out,
 * and handing the same attempt back costs nothing (answers are stored only at /submit).
 */
function resumeOrReject(env: AppBindings, existing: { id: string; submitted_at: Date | null; final_score: number | null }) {
  if (existing.submitted_at !== null || existing.final_score !== null) throw conflict(ALREADY_PARTICIPATED);
  return { message: 'Contest resumed', data: { attempt_id: existing.id, attempt_token: signAttemptToken(env, existing.id), resumed: true } };
}

export async function start(c: Ctx, dto: StartInput) {
  await assertContestOpen(c);

  if (dto.contactType === 'phone' && !PHONE_RE.test(dto.contact)) throw badRequest('Invalid phone number format');
  if (dto.contactType === 'email' && !EMAIL_RE.test(dto.contact)) throw badRequest('Invalid email format');

  const normalized = canonicalContact(dto.contactType, dto.contact);
  const variants = identityVariants(dto.contactType, normalized);
  const phone = dto.contactType === 'phone' ? normalized : null;
  const email = dto.contactType === 'email' ? normalized : null;

  // The partial unique indexes on phone / email are the atomic backstop; this is the fast path.
  const existing = await findAttemptByIdentity(c, variants);
  if (existing) return resumeOrReject(c.env, existing);

  let rows: { id: string }[];
  try {
    rows = await getDb(c).$queryRaw`
      INSERT INTO qutuf_sajjadiya_contest_attempts
      (name, phone, email, started_at, submitted_at, ip, user_agent)
      VALUES (${dto.name}, ${phone}, ${email}, NOW(), NULL, ${c.get('ip')}, ${c.req.header('user-agent') ?? ''})
      RETURNING id
    `;
  } catch (err) {
    // A concurrent /start with the same identity (a double click): the loser takes the winner's attempt.
    if (isUniqueViolation(err)) {
      const winner = await findAttemptByIdentity(c, variants);
      if (winner) return resumeOrReject(c.env, winner);
      throw conflict(ALREADY_PARTICIPATED);
    }
    throw err;
  }

  const attemptId = rows[0].id;
  return { message: 'Contest started', data: { attempt_id: attemptId, attempt_token: signAttemptToken(c.env, attemptId), resumed: false } };
}

export async function submit(c: Ctx, dto: SubmitInput) {
  await assertContestOpen(c);

  // Optional until every frontend sends it. Nest's @IsOptional lets `null` through and then crashed
  // on it (500); an explicit null counts as absent here.
  if (dto.attempt_token != null) {
    if (!verifyHmacHex(attemptKeys(c.env), dto.attempt_id, dto.attempt_token)) throw unauthorized('Invalid attempt token');
  } else {
    console.warn(`Contest submit without attempt_token (attempt_id=${dto.attempt_id}); frontend should adopt token-binding`);
  }

  const db = getDb(c);
  const correct = new Map(
    (await db.$queryRaw<Array<{ id: string; correct_answer: string }>>`SELECT id, correct_answer FROM qutuf_sajjadiya_contest_questions`).map((r) => [
      String(r.id),
      r.correct_answer,
    ]),
  );

  // One answer per unique question id: duplicates must not inflate the score.
  const seen = new Set<string>();
  let finalScore = 0;
  const answers: { question_id: string; selected: string; is_correct: boolean }[] = [];
  for (const answer of dto.answers) {
    const qid = String(answer.question_id);
    if (seen.has(qid)) continue;
    seen.add(qid);
    if (!correct.has(qid)) continue;
    const isCorrect = correct.get(qid) === answer.answer;
    if (isCorrect) finalScore++;
    answers.push({ question_id: qid, selected: answer.answer, is_correct: isCorrect });
  }

  // Completeness on the de-duplicated, known set: duplicate or unknown ids can't pad the count.
  if (correct.size === 0 || answers.length !== correct.size) throw conflict('All questions must be answered');

  const answerRows = Prisma.join(
    answers.map((v) => Prisma.sql`(gen_random_uuid(), ${dto.attempt_id}::uuid, ${v.question_id}, ${v.selected}, ${v.is_correct})`),
    ', ',
  );

  // The row lock, the answers and the finalization in one transaction; the conditional UPDATE answers 0
  // when another submitter finalized the attempt first.
  const updated = await db.$transaction(async (tx) => {
    const attempts = await tx.$queryRaw<{ id: string; final_score: number | null }[]>`
      SELECT id, final_score FROM qutuf_sajjadiya_contest_attempts WHERE id = ${dto.attempt_id}::uuid FOR UPDATE
    `;
    if (!attempts.length) throw notFound('Attempt not found');
    if (attempts[0].final_score !== null) throw conflict('This attempt has already been submitted');

    await tx.$executeRaw(Prisma.sql`
      INSERT INTO qutuf_sajjadiya_contest_answers (id, attempt_id, question_id, selected, is_correct)
      VALUES ${answerRows}
      ON CONFLICT (attempt_id, question_id) DO NOTHING
    `);

    return tx.$executeRaw`
      UPDATE qutuf_sajjadiya_contest_attempts SET final_score = ${finalScore}, submitted_at = NOW()
      WHERE id = ${dto.attempt_id}::uuid AND final_score IS NULL
    `;
  });
  if (updated === 0) throw conflict('This attempt has already been submitted');

  // The score is always stored; whether the participant is told is a deployment choice.
  const revealed = scoreIsRevealed(c.env);
  return { message: 'Contest submitted', data: { final_score: revealed ? finalScore : null, total_questions: correct.size, score_revealed: revealed } };
}
