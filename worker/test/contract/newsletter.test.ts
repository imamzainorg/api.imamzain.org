import { createHmac, hkdfSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { HARNESS_JWT_SECRET } from '../harness/config';
import { adminToken, api, expectError, expectSuccess, tokenWith, withDb, workerOnly } from './support/http';
import { uid } from './support/rbac';

const NEWSLETTER = '/api/v1/newsletter';
const MISSING = '00000000-0000-4000-8000-000000000000';
const FORBIDDEN = 'You do not have permission to access this resource';
const INVALID_LINK = 'This confirmation link is invalid or has expired';
const HOUR = 3_600_000;

// The subscriber tokens are HMACs under keys derived from JWT_SECRET, as Nest derives them.
const derivedKey = (info: string) =>
  Buffer.from(hkdfSync('sha256', process.env.JWT_SECRET ?? HARNESS_JWT_SECRET, Buffer.from('imamzain.org/api/hmac-key-derivation/v1'), info, 32));
const mac = (info: string, message: string) => createHmac('sha256', derivedKey(info)).update(message).digest('hex');
const unsubscribeToken = (id: string) => mac('imamzain/newsletter-unsubscribe/v1', id);
const confirmToken = (id: string, issuedAt: Date) => mac('imamzain/newsletter-confirm/v1', `confirm:${id}:${issuedAt.getTime()}`);

interface Row {
  id: string;
  email: string;
}

interface Seed {
  is_active?: boolean;
  confirmed_at?: Date | null;
  confirmation_sent_at?: Date | null;
  unsubscribed_at?: Date | null;
  deleted_at?: Date | null;
}

/** A subscriber row in the exact state asked for; `subscribe` can't make one, as it needs the e-mail sender. */
async function seed(s: Seed = {}): Promise<Row> {
  const email = `${uid('n')}@example.com`;
  const rows = await withDb((q) =>
    q(
      `INSERT INTO newsletter_subscribers (email, is_active, confirmed_at, confirmation_sent_at, unsubscribed_at, deleted_at)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [email, s.is_active ?? true, s.confirmed_at ?? null, s.confirmation_sent_at ?? null, s.unsubscribed_at ?? null, s.deleted_at ?? null],
    ),
  );
  return { id: rows[0].id as string, email };
}

const rowOf = async (id: string) => (await withDb((q) => q('SELECT * FROM newsletter_subscribers WHERE id = $1', [id])))[0];

const confirm = (body: unknown) => api(`${NEWSLETTER}/confirm`, { method: 'POST', body });
const unsubscribe = (body: unknown) => api(`${NEWSLETTER}/unsubscribe`, { method: 'POST', body });
const admin = async (path: string, method = 'POST') => api(`${NEWSLETTER}/subscribers${path}`, { method, token: await adminToken() });

describe('POST /newsletter/subscribe (public)', () => {
  it('answers the same for any address, leaves nobody subscribed, and rejects an invalid one', async () => {
    const email = `${uid('s')}@example.com`;
    const res = await api(`${NEWSLETTER}/subscribe`, { method: 'POST', body: { email } });
    expectSuccess(res);
    expect(res.body).toMatchObject({ message: 'Please check your inbox to confirm your subscription', data: null });
    const [row] = await withDb((q) => q('SELECT is_active, confirmed_at FROM newsletter_subscribers WHERE email = $1', [email]));
    expect(row).toMatchObject({ is_active: false, confirmed_at: null });

    const bad = await api(`${NEWSLETTER}/subscribe`, { method: 'POST', body: { email: 'nope' } });
    expectError(bad, 400, 'VALIDATION_FAILED', 'Validation failed');
    expect(bad.body.errors).toEqual(['Please provide a valid email address']);
  });
});

// Nest's harness has no mail transport, so it never claims a confirmation; the Worker's local email binding does.
describe('POST /newsletter/subscribe with a mail transport', () => {
  workerOnly('worker-only: the link it mints confirms the address, and a second request inside the cool-down changes nothing', async () => {
    const email = `${uid('s')}@example.com`;
    expectSuccess(await api(`${NEWSLETTER}/subscribe`, { method: 'POST', body: { email } }));
    const [first] = await withDb((q) => q('SELECT id, is_active, confirmation_sent_at FROM newsletter_subscribers WHERE email = $1', [email]));
    expect(first).toMatchObject({ is_active: false, confirmation_sent_at: expect.any(Date) });

    expectSuccess(await api(`${NEWSLETTER}/subscribe`, { method: 'POST', body: { email } }));
    const [second] = await withDb((q) => q('SELECT confirmation_sent_at FROM newsletter_subscribers WHERE email = $1', [email]));
    expect(second.confirmation_sent_at).toEqual(first.confirmation_sent_at);

    expectSuccess(await confirm({ email, token: confirmToken(first.id as string, first.confirmation_sent_at as Date) }));
    expect((await rowOf(first.id as string)).is_active).toBe(true);
  });
});

describe('POST /newsletter/confirm (public)', () => {
  it('activates a pending subscriber, and a second click is a harmless 200', async () => {
    const issuedAt = new Date(Date.now() - HOUR);
    const sub = await seed({ is_active: false, confirmation_sent_at: issuedAt });
    const body = { email: sub.email, token: confirmToken(sub.id, issuedAt) };

    const res = await confirm(body);
    expectSuccess(res);
    expect(res.body).toMatchObject({ message: 'Subscription confirmed', data: null });
    expect(await rowOf(sub.id)).toMatchObject({ is_active: true, unsubscribed_at: null, deleted_at: null, confirmed_at: expect.any(Date) });

    const again = await confirm(body);
    expectSuccess(again);
    expect(again.body.message).toBe('Subscription already confirmed');
  });

  it('brings back someone who had unsubscribed, because the click is fresh consent', async () => {
    const issuedAt = new Date(Date.now() - HOUR);
    const sub = await seed({ is_active: false, confirmed_at: new Date(Date.now() - 48 * HOUR), unsubscribed_at: new Date(Date.now() - 24 * HOUR), confirmation_sent_at: issuedAt });

    expectSuccess(await confirm({ email: sub.email, token: confirmToken(sub.id, issuedAt) }));
    expect(await rowOf(sub.id)).toMatchObject({ is_active: true, unsubscribed_at: null });
  });

  it('answers every bad link with the same 401, and leaves the row alone', async () => {
    const fresh = new Date(Date.now() - HOUR);
    const pending = await seed({ is_active: false, confirmation_sent_at: fresh });
    const expired = await seed({ is_active: false, confirmation_sent_at: new Date(Date.now() - 73 * HOUR) });
    const superseded = await seed({ is_active: false, confirmation_sent_at: fresh });
    const optedOutAfter = await seed({ is_active: false, confirmation_sent_at: new Date(Date.now() - 3 * HOUR), unsubscribed_at: new Date(Date.now() - HOUR) });
    const neverAsked = await seed({ is_active: false });

    const cases: [string, string, string][] = [
      ['an unknown address', `${uid('x')}@example.com`, 'a'.repeat(64)],
      ['a wrong token', pending.email, 'a'.repeat(64)],
      ['an unsubscribe token', pending.email, unsubscribeToken(pending.id)],
      ['an expired link', expired.email, confirmToken(expired.id, new Date(Date.now() - 73 * HOUR))],
      ['a superseded link', superseded.email, confirmToken(superseded.id, new Date(fresh.getTime() - 1000))],
      ['a link older than the opt-out', optedOutAfter.email, confirmToken(optedOutAfter.id, new Date(Date.now() - 3 * HOUR))],
      ['an address never asked to confirm', neverAsked.email, 'a'.repeat(64)],
    ];
    for (const [, email, token] of cases) {
      expectError(await confirm({ email, token }), 401, 'UNAUTHORIZED', INVALID_LINK);
    }
    for (const row of [pending, expired, superseded, optedOutAfter, neverAsked]) expect((await rowOf(row.id)).is_active).toBe(false);
  });

  it.each([
    ['an invalid address', { email: 'not-an-email', token: 'abc' }, ['Please provide a valid email address']],
    ['a 257-char token', { email: 'a@example.com', token: 't'.repeat(257) }, ['token must be shorter than or equal to 256 characters']],
    ['an unknown key', { email: 'a@example.com', token: 'abc', extra: 1 }, ['property extra should not exist']],
  ])('rejects %s', async (_name, body, errors) => {
    const res = await confirm(body);
    expectError(res, 400, 'VALIDATION_FAILED', 'Validation failed');
    expect(res.body.errors).toEqual(errors);
  });
});

describe('POST /newsletter/unsubscribe (public)', () => {
  it('deactivates with the token from the link, and a second click is a 200', async () => {
    const sub = await seed({ confirmed_at: new Date() });
    const body = { email: `  ${sub.email}  `, token: unsubscribeToken(sub.id) };

    const res = await unsubscribe(body);
    expectSuccess(res);
    expect(res.body.message).toBe('Successfully unsubscribed');
    expect(res.body.data).toMatchObject({ id: sub.id, email: sub.email, is_active: false, unsubscribed_at: expect.any(String) });
    expect(await rowOf(sub.id)).toMatchObject({ is_active: false, unsubscribed_at: expect.any(Date) });

    const again = await unsubscribe(body);
    expectSuccess(again);
    expect(again.body.message).toBe('Already unsubscribed');
  });

  it('does not tell a wrong token from an unknown address', async () => {
    const sub = await seed();
    for (const body of [
      { email: sub.email, token: 'a'.repeat(64) },
      { email: sub.email, token: confirmToken(sub.id, new Date()) },
      { email: `${uid('x')}@example.com`, token: unsubscribeToken(sub.id) },
    ]) {
      expectError(await unsubscribe(body), 401, 'UNAUTHORIZED', 'Invalid unsubscribe token');
    }
    expect((await rowOf(sub.id)).is_active).toBe(true);
  });

  it('rejects an invalid address', async () => {
    const res = await unsubscribe({ email: 'nope', token: 'abc' });
    expectError(res, 400, 'VALIDATION_FAILED', 'Validation failed');
    expect(res.body.errors).toEqual(['Please provide a valid email address']);
  });
});

describe('GET /newsletter/subscribers (admin)', () => {
  it('lists active subscribers by default, inactive ones on request, and never deleted ones', async () => {
    const needle = uid('lst');
    const mk = async (s: Seed) => {
      const email = `${needle}-${uid('')}@example.com`;
      const rows = await withDb((q) => q('INSERT INTO newsletter_subscribers (email, is_active, deleted_at) VALUES ($1, $2, $3) RETURNING id', [email, s.is_active ?? true, s.deleted_at ?? null]));
      return rows[0].id as string;
    };
    const active = await mk({});
    const inactive = await mk({ is_active: false });
    const deleted = await mk({ is_active: false, deleted_at: new Date() });
    const token = await adminToken();
    const ids = async (qs: string) => {
      const res = await api(`${NEWSLETTER}/subscribers?search=${needle}&limit=100${qs}`, { token });
      expectSuccess(res);
      expect(res.body.message).toBe('Subscribers fetched');
      return (res.body.data.items as { id: string }[]).map((i) => i.id);
    };

    expect(await ids('')).toEqual([active]);
    expect(await ids('&is_active=false')).toEqual([inactive]);
    expect(await ids('&is_active=false')).not.toContain(deleted);
  });

  it('is 401 / 403, and validates the query', async () => {
    expectError(await api(`${NEWSLETTER}/subscribers`), 401, 'UNAUTHORIZED');
    expectError(await api(`${NEWSLETTER}/subscribers`, { token: await tokenWith(['newsletter:update']) }), 403, 'FORBIDDEN', FORBIDDEN);

    const res = await api(`${NEWSLETTER}/subscribers?limit=101&is_active=maybe&search=a`, { token: await adminToken() });
    expectError(res, 400, 'VALIDATION_FAILED', 'Validation failed');
    expect(res.body.errors).toEqual(
      expect.arrayContaining(['limit must not be greater than 100', 'is_active must be a boolean value', 'search must be longer than or equal to 2 characters']),
    );
  });
});

describe('admin unsubscribe / resubscribe', () => {
  it('toggles the subscriber without a token, re-stamping consent, and is idempotent', async () => {
    const sub = await seed({ confirmed_at: new Date(Date.now() - 24 * HOUR) });

    const off = await admin(`/${sub.id}/unsubscribe`);
    expectSuccess(off);
    expect(off.body).toMatchObject({ message: 'Successfully unsubscribed', data: { id: sub.id, is_active: false } });
    expect((await admin(`/${sub.id}/unsubscribe`)).body.message).toBe('Already unsubscribed');

    const on = await admin(`/${sub.id}/resubscribe`);
    expectSuccess(on);
    expect(on.body).toMatchObject({ message: 'Successfully resubscribed', data: { id: sub.id, is_active: true, unsubscribed_at: null } });
    expect(Date.now() - new Date(on.body.data.confirmed_at).getTime()).toBeLessThan(60_000);
    expect((await admin(`/${sub.id}/resubscribe`)).body.message).toBe('Already subscribed');
  });

  it('is 404 for an unknown or deleted subscriber, 401 without a token and 403 without the permission', async () => {
    const gone = await seed({ is_active: false, deleted_at: new Date() });
    for (const id of [MISSING, gone.id]) {
      expectError(await admin(`/${id}/unsubscribe`), 404, 'NOT_FOUND', 'Subscriber not found');
      expectError(await admin(`/${id}/resubscribe`), 404, 'NOT_FOUND', 'Subscriber not found');
    }
    expectError(await api(`${NEWSLETTER}/subscribers/${MISSING}/unsubscribe`, { method: 'POST' }), 401, 'UNAUTHORIZED');
    expectError(await api(`${NEWSLETTER}/subscribers/${MISSING}/resubscribe`, { method: 'POST', token: await tokenWith(['newsletter:read']) }), 403, 'FORBIDDEN', FORBIDDEN);
  });
});

describe('subscriber trash', () => {
  it('soft-deletes, lists the trash, and restores without undoing an opt-out', async () => {
    const subscribed = await seed({ confirmed_at: new Date() });
    const optedOut = await seed({ is_active: false, confirmed_at: new Date(Date.now() - 24 * HOUR), unsubscribed_at: new Date(Date.now() - HOUR) });
    const pending = await seed({ is_active: false });

    for (const sub of [subscribed, optedOut, pending]) {
      const del = await admin(`/${sub.id}`, 'DELETE');
      expectSuccess(del);
      expect(del.body).toMatchObject({ message: 'Subscriber deleted', data: null });
      expect(await rowOf(sub.id)).toMatchObject({ is_active: false, deleted_at: expect.any(Date) });
    }
    expectError(await admin(`/${subscribed.id}`, 'DELETE'), 404, 'NOT_FOUND', 'Subscriber not found');

    const trash = await api(`${NEWSLETTER}/subscribers/trash?limit=100`, { token: await adminToken() });
    expectSuccess(trash);
    expect(trash.body.message).toBe('Trash fetched');
    expect((trash.body.data.items as { id: string }[]).map((i) => i.id)).toEqual(expect.arrayContaining([subscribed.id, optedOut.id, pending.id]));

    const back = async (id: string) => {
      const res = await admin(`/${id}/restore`);
      expectSuccess(res);
      expect(res.body.message).toBe('Subscriber restored');
      return res.body.data;
    };
    expect(await back(subscribed.id)).toMatchObject({ is_active: true, deleted_at: null });
    expect(await back(optedOut.id)).toMatchObject({ is_active: false, deleted_at: null });
    expect(await back(pending.id)).toMatchObject({ is_active: false, deleted_at: null });

    expectError(await admin(`/${subscribed.id}/restore`), 404, 'NOT_FOUND', 'Deleted subscriber not found');
    expectError(await admin(`/${MISSING}`, 'DELETE'), 404, 'NOT_FOUND', 'Subscriber not found');
  });

  it('needs newsletter:delete', async () => {
    const token = await tokenWith(['newsletter:read', 'newsletter:update']);
    expectError(await api(`${NEWSLETTER}/subscribers/trash`), 401, 'UNAUTHORIZED');
    expectError(await api(`${NEWSLETTER}/subscribers/trash`, { token }), 403, 'FORBIDDEN', FORBIDDEN);
    expectError(await api(`${NEWSLETTER}/subscribers/${MISSING}/restore`, { method: 'POST', token }), 403, 'FORBIDDEN', FORBIDDEN);
    expectError(await api(`${NEWSLETTER}/subscribers/${MISSING}`, { method: 'DELETE', token }), 403, 'FORBIDDEN', FORBIDDEN);
  });
});
