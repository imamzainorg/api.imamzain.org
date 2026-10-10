import { describe, expect, it } from 'vitest';
import { adminToken, api, expectError, expectSuccess, ISO_DATE, tokenWith } from './support/http';
import { tokenSub, uid } from './support/rbac';

const FORMS = '/api/v1/forms';
const MISSING = '00000000-0000-4000-8000-000000000000';
const FORBIDDEN = 'You do not have permission to access this resource';

const visit = (extra: Record<string, unknown> = {}) => ({ visitor_name: `Visitor ${uid('v')}`, visitor_phone: '+9647801234567', visitor_country: 'IQ', ...extra });
const contact = (extra: Record<string, unknown> = {}) => ({ name: `Sender ${uid('c')}`, email: 'sender@example.com', message: 'السلام عليكم، أود الاستفسار', ...extra });

async function submitVisit(extra: Record<string, unknown> = {}) {
  const res = await api(`${FORMS}/proxy-visit`, { method: 'POST', body: visit(extra) });
  expectSuccess(res, 201);
  return res.body.data;
}

async function submitContact(extra: Record<string, unknown> = {}) {
  const res = await api(`${FORMS}/contact`, { method: 'POST', body: contact(extra) });
  expectSuccess(res, 201);
  return res.body.data;
}

const patchVisit = async (id: string, body: unknown) => api(`${FORMS}/proxy-visits/${id}`, { method: 'PATCH', token: await adminToken(), body });
const patchContact = async (id: string, body: unknown) => api(`${FORMS}/contacts/${id}`, { method: 'PATCH', token: await adminToken(), body });

describe('POST /forms/proxy-visit (public)', () => {
  it('records a PENDING request, waiting for the notification digest', async () => {
    const body = visit();
    const res = await api(`${FORMS}/proxy-visit`, { method: 'POST', body });

    expectSuccess(res, 201);
    expect(res.body.message).toBe('Proxy visit request submitted');
    expect(res.body.data).toEqual({
      id: expect.any(String),
      name: body.visitor_name,
      phone: body.visitor_phone,
      country: 'IQ',
      status: 'PENDING',
      submitted_at: expect.stringMatching(ISO_DATE),
      processed_at: null,
      processed_by: null,
      notes: null,
      deleted_at: null,
      notification_failed_at: null,
      notified_at: null,
    });
  });

  it.each([
    ['a local phone number', { visitor_phone: '07801234567' }, ['Phone must be in E.164 format e.g. +9647801234567']],
    ['a lower-case country', { visitor_country: 'iq' }, ['visitor_country must match /^[A-Z]{2}$/ regular expression']],
    [
      'a three-letter country',
      { visitor_country: 'IRQ' },
      ['visitor_country must match /^[A-Z]{2}$/ regular expression', 'visitor_country must be shorter than or equal to 2 characters'],
    ],
    ['a one-letter name', { visitor_name: 'A' }, ['visitor_name must be longer than or equal to 2 characters']],
    ['a 101-char name', { visitor_name: 'x'.repeat(101) }, ['visitor_name must be shorter than or equal to 100 characters']],
    ['an unknown key', { status: 'COMPLETED' }, ['property status should not exist']],
  ])('rejects %s', async (_name, extra, errors) => {
    const res = await api(`${FORMS}/proxy-visit`, { method: 'POST', body: visit(extra) });
    expectError(res, 400, 'VALIDATION_FAILED', 'Validation failed');
    expect(res.body.errors).toEqual(errors);
  });
});

describe('POST /forms/contact (public)', () => {
  it('records a NEW submission; the country is optional', async () => {
    const res = await api(`${FORMS}/contact`, { method: 'POST', body: contact({ email: 'Sender@Example.COM' }) });
    expectSuccess(res, 201);
    expect(res.body.message).toBe('Contact submission received');
    expect(res.body.data).toMatchObject({ email: 'Sender@Example.COM', country: null, status: 'NEW', responded_by: null, notified_at: null });

    expect((await submitContact({ country: 'DE' })).country).toBe('DE');
  });

  it.each([
    ['an address without a TLD', { email: 'a@b' }, ['email must be an email']],
    ['a display-name address', { email: 'Ali <ali@example.com>' }, ['email must be an email']],
    ['a 255-char address', { email: `${'a'.repeat(64)}@${'b'.repeat(186)}.com` }, ['email must be shorter than or equal to 254 characters', 'email must be an email']],
    ['a 9-char message', { message: 'x'.repeat(9) }, ['message must be longer than or equal to 10 characters']],
    ['a 2001-char message', { message: 'x'.repeat(2001) }, ['message must be shorter than or equal to 2000 characters']],
    ['a lower-case country', { country: 'de' }, ['country must match /^[A-Z]{2}$/ regular expression']],
  ])('rejects %s', async (_name, extra, errors) => {
    const res = await api(`${FORMS}/contact`, { method: 'POST', body: contact(extra) });
    expectError(res, 400, 'VALIDATION_FAILED', 'Validation failed');
    expect(res.body.errors).toEqual(errors);
  });

  it('accepts the addresses isEmail accepts', async () => {
    for (const email of ['first.last+tag@sub.example.co.uk', 'عربي@example.com']) {
      expectSuccess(await api(`${FORMS}/contact`, { method: 'POST', body: contact({ email }) }), 201);
    }
  });
});

describe('PATCH /forms/proxy-visits/:id', () => {
  it('stamps the processor on a real transition only, and clears it back in PENDING', async () => {
    const admin = tokenSub(await adminToken());
    const v = await submitVisit();

    const approved = await patchVisit(v.id, { status: 'APPROVED', processed_at: '2026-01-15T14:30:00Z' });
    expectSuccess(approved);
    expect(approved.body.message).toBe('Request updated');
    expect(approved.body.data).toMatchObject({ status: 'APPROVED', processed_by: admin, processed_at: '2026-01-15T14:30:00.000Z' });

    // Re-sending the same status must not move the stamp.
    expect((await patchVisit(v.id, { status: 'APPROVED' })).body.data.processed_at).toBe('2026-01-15T14:30:00.000Z');

    const back = await patchVisit(v.id, { status: 'PENDING' });
    expect(back.body.data).toMatchObject({ status: 'PENDING', processed_by: null, processed_at: null });
  });

  it('follows the transition table; COMPLETED is final, but its notes stay editable', async () => {
    const rejected = await submitVisit();
    expectSuccess(await patchVisit(rejected.id, { status: 'REJECTED' }));
    expectError(await patchVisit(rejected.id, { status: 'COMPLETED' }), 400, 'BAD_REQUEST', 'A REJECTED request cannot become COMPLETED (allowed: PENDING, APPROVED)');

    // The harness has no Twilio credentials, so COMPLETED sends nothing.
    const done = await submitVisit();
    const completed = await patchVisit(done.id, { status: 'COMPLETED' });
    expectSuccess(completed);
    expect(completed.body.data.status).toBe('COMPLETED');
    expectError(await patchVisit(done.id, { status: 'PENDING' }), 400, 'BAD_REQUEST', 'A COMPLETED request is final — its status can no longer change');

    const noted = await patchVisit(done.id, { notes: 'visit made on Friday' });
    expectSuccess(noted);
    expect(noted.body.data).toMatchObject({ status: 'COMPLETED', notes: 'visit made on Friday' });
    expect((await patchVisit(done.id, { notes: null })).body.data.notes).toBeNull();
  });

  it('is 404 for a missing or deleted request, and validates the body', async () => {
    const v = await submitVisit();
    expectSuccess(await api(`${FORMS}/proxy-visits/${v.id}`, { method: 'DELETE', token: await adminToken() }));
    for (const id of [MISSING, v.id]) expectError(await patchVisit(id, { notes: 'x' }), 404, 'NOT_FOUND', 'Request not found');

    const bad = await patchVisit(MISSING, { status: 'DONE', processed_at: 'yesterday' });
    expectError(bad, 400, 'VALIDATION_FAILED');
    expect(bad.body.errors).toEqual([
      'status must be one of the following values: PENDING, APPROVED, COMPLETED, REJECTED',
      'processed_at must be a valid ISO 8601 date string',
    ]);
  });

  it('is 403 without forms:update', async () => {
    const v = await submitVisit();
    expectError(await api(`${FORMS}/proxy-visits/${v.id}`, { method: 'PATCH', token: await tokenWith(['forms:read']), body: {} }), 403, 'FORBIDDEN', FORBIDDEN);
  });
});

describe('proxy-visit lists, delete and restore', () => {
  it('lists live requests newest first, filtered by status; the trash holds the deleted ones', async () => {
    const token = await adminToken();
    const older = await submitVisit();
    const newer = await submitVisit();
    const gone = await submitVisit();
    expectSuccess(await patchVisit(newer.id, { status: 'APPROVED' }));
    const del = await api(`${FORMS}/proxy-visits/${gone.id}`, { method: 'DELETE', token });
    expectSuccess(del);
    expect(del.body).toMatchObject({ message: 'Request deleted', data: null });

    const all = await api(`${FORMS}/proxy-visits?limit=100`, { token });
    expectSuccess(all);
    expect(all.body.message).toBe('Requests fetched');
    const ids = all.body.data.items.map((r: { id: string }) => r.id);
    expect(ids.indexOf(newer.id)).toBeLessThan(ids.indexOf(older.id));
    expect(ids).not.toContain(gone.id);

    const approved = (await api(`${FORMS}/proxy-visits?status=APPROVED&limit=100`, { token })).body.data.items;
    expect(approved.every((r: { status: string }) => r.status === 'APPROVED')).toBe(true);
    expect(approved.map((r: { id: string }) => r.id)).toContain(newer.id);

    const trash = await api(`${FORMS}/proxy-visits/trash?limit=100`, { token });
    expect(trash.body.message).toBe('Trash fetched');
    expect(trash.body.data.items.map((r: { id: string }) => r.id)).toContain(gone.id);

    const restored = await api(`${FORMS}/proxy-visits/${gone.id}/restore`, { method: 'POST', token });
    expectSuccess(restored);
    expect(restored.body).toMatchObject({ message: 'Request restored', data: { id: gone.id, deleted_at: null } });
    expectError(await api(`${FORMS}/proxy-visits/${gone.id}/restore`, { method: 'POST', token }), 404, 'NOT_FOUND', 'Deleted request not found');
    expectError(await api(`${FORMS}/proxy-visits/${MISSING}`, { method: 'DELETE', token }), 404, 'NOT_FOUND', 'Request not found');
  });

  it('is 401 / 403 for the admin views, and validates the status filter', async () => {
    expectError(await api(`${FORMS}/proxy-visits`), 401, 'UNAUTHORIZED');
    expectError(await api(`${FORMS}/proxy-visits`, { token: await tokenWith(['forms:update']) }), 403, 'FORBIDDEN', FORBIDDEN);
    expectError(await api(`${FORMS}/proxy-visits/trash`, { token: await tokenWith(['forms:read']) }), 403, 'FORBIDDEN', FORBIDDEN);
    const bad = await api(`${FORMS}/proxy-visits?status=pending`, { token: await adminToken() });
    expectError(bad, 400, 'VALIDATION_FAILED');
    expect(bad.body.errors).toEqual(['status must be one of the following values: PENDING, APPROVED, COMPLETED, REJECTED']);
  });
});

describe('contact submissions (admin)', () => {
  it('stamps the responder on RESPONDED and clears it when leaving; SPAM and NEW move freely', async () => {
    const admin = tokenSub(await adminToken());
    const s = await submitContact();

    const responded = await patchContact(s.id, { status: 'RESPONDED', notes: 'called back' });
    expectSuccess(responded);
    expect(responded.body.message).toBe('Submission updated');
    expect(responded.body.data).toMatchObject({ status: 'RESPONDED', responded_by: admin, responded_at: expect.stringMatching(ISO_DATE), notes: 'called back' });

    const spam = await patchContact(s.id, { status: 'SPAM' });
    expect(spam.body.data).toMatchObject({ status: 'SPAM', responded_by: null, responded_at: null, notes: 'called back' });
    expect((await patchContact(s.id, { status: 'NEW' })).body.data.status).toBe('NEW');
  });

  it('lists by status, deletes, restores, and 404s', async () => {
    const token = await adminToken();
    const s = await submitContact();
    expectSuccess(await patchContact(s.id, { status: 'SPAM' }));

    const spam = await api(`${FORMS}/contacts?status=SPAM&limit=100`, { token });
    expectSuccess(spam);
    expect(spam.body.message).toBe('Submissions fetched');
    expect(spam.body.data.items.map((r: { id: string }) => r.id)).toContain(s.id);

    expect((await api(`${FORMS}/contacts/${s.id}`, { method: 'DELETE', token })).body).toMatchObject({ message: 'Submission deleted', data: null });
    expectError(await patchContact(s.id, { status: 'NEW' }), 404, 'NOT_FOUND', 'Submission not found');
    expect((await api(`${FORMS}/contacts/trash?limit=100`, { token })).body.data.items.map((r: { id: string }) => r.id)).toContain(s.id);

    expect((await api(`${FORMS}/contacts/${s.id}/restore`, { method: 'POST', token })).body).toMatchObject({ message: 'Submission restored', data: { id: s.id } });
    expectError(await api(`${FORMS}/contacts/${s.id}/restore`, { method: 'POST', token }), 404, 'NOT_FOUND', 'Deleted submission not found');
  });

  it('is 403 without forms:delete for the trash', async () => {
    expectError(await api(`${FORMS}/contacts/trash`, { token: await tokenWith(['forms:read', 'forms:update']) }), 403, 'FORBIDDEN', FORBIDDEN);
  });
});
