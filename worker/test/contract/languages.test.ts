import { describe, expect, it } from 'vitest';
import { adminToken, api, expectError, expectSuccess, tokenWith, withDb } from './support/http';

const BASE = '/api/v1/languages';
const errorsOf = (res: { body: { errors?: string[] } }) => res.body.errors;

/** A code no language row (live or deleted) uses; `zz` stays free for other suites' FK tests. */
async function freeCode(): Promise<string> {
  return withDb(async (q) => {
    const used = new Set((await q('SELECT code FROM languages')).map((r) => (r.code as string).trim()));
    const free: string[] = [];
    for (const a of 'qxjvwk') for (const b of 'abcdefghijklmnopqrstuvwxyz') if (!used.has(a + b)) free.push(a + b);
    return free[Math.floor(Math.random() * free.length)];
  });
}

const post = async (body: unknown) => api(BASE, { method: 'POST', token: await adminToken(), body });
const patch = async (code: string, body: unknown) => api(`${BASE}/${code}`, { method: 'PATCH', token: await adminToken(), body });
const del = async (code: string) => api(`${BASE}/${code}`, { method: 'DELETE', token: await adminToken() });
const codes = (res: { body: { data: { code: string }[] } }) => res.body.data.map((l) => l.code);

describe('POST /languages', () => {
  it('creates an active language and answers 201 with the row', async () => {
    const code = await freeCode();
    const res = await post({ code, name: `Name ${code}`, native_name: `Native ${code}` });

    expectSuccess(res, 201);
    expect(res.body.message).toBe('Language created');
    expect(res.body.data).toEqual({ code, name: `Name ${code}`, native_name: `Native ${code}`, is_active: true, deleted_at: null });
    await del(code);
  });

  it('lowercases and trims the code, and keeps an explicit is_active: false', async () => {
    const code = await freeCode();
    const res = await post({ code: ` ${code.toUpperCase()} `, name: 'n', native_name: 'n', is_active: false });

    expectSuccess(res, 201);
    expect(res.body.data).toMatchObject({ code, is_active: false });
    await del(code);
  });

  it('refuses a code that is already live', async () => {
    const code = await freeCode();
    expectSuccess(await post({ code, name: 'n', native_name: 'n' }), 201);

    expectError(await post({ code, name: 'n', native_name: 'n' }), 409, 'CONFLICT', `A language with code "${code}" already exists`);
    await del(code);
  });

  it('revives a soft-deleted code with the new values', async () => {
    const code = await freeCode();
    expectSuccess(await post({ code, name: 'old', native_name: 'old' }), 201);
    expectSuccess(await del(code));

    const res = await post({ code, name: 'new', native_name: 'جديد', is_active: false });
    expectSuccess(res, 201);
    expect(res.body.data).toEqual({ code, name: 'new', native_name: 'جديد', is_active: false, deleted_at: null });
    await del(code);
  });

  describe('validation', () => {
    const ok = { name: 'n', native_name: 'n' };
    const cases: [string, unknown, string[]][] = [
      ['a one-letter code', { ...ok, code: 'a' }, ['code must be a 2-letter lowercase ISO 639-1 code']],
      ['a three-letter code', { ...ok, code: 'abc' }, ['code must be a 2-letter lowercase ISO 639-1 code']],
      ['a non-letter code', { ...ok, code: 'a1' }, ['code must be a 2-letter lowercase ISO 639-1 code']],
      ['an empty name', { code: 'qq', name: '', native_name: 'n' }, ['name must be longer than or equal to 1 characters']],
      ['a 101-char name', { code: 'qq', name: 'x'.repeat(101), native_name: 'n' }, ['name must be shorter than or equal to 100 characters']],
      ['an empty native_name', { code: 'qq', name: 'n', native_name: '' }, ['native_name must be longer than or equal to 1 characters']],
      ['a non-boolean is_active', { code: 'qq', ...ok, is_active: 'yes' }, ['is_active must be a boolean value']],
      ['an unknown key', { code: 'qq', ...ok, extra: 1 }, ['property extra should not exist']],
    ];

    it.each(cases)('rejects %s with Nest’s messages', async (_name, body, errors) => {
      const res = await post(body);
      expectError(res, 400, 'VALIDATION_FAILED', 'Validation failed');
      expect(errorsOf(res)).toEqual(errors);
    });

    it('rejects a missing name and native_name', async () => {
      const res = await post({ code: 'qq' });
      expectError(res, 400, 'VALIDATION_FAILED', 'Validation failed');
      expect(errorsOf(res)).toEqual(expect.arrayContaining(['name must be a string', 'native_name must be a string']));
    });
  });

  it('is 401 without a token and 403 without languages:create', async () => {
    expectError(await api(BASE, { method: 'POST', body: {} }), 401, 'UNAUTHORIZED', 'Unauthorized');
    const token = await tokenWith(['languages:read', 'languages:update', 'languages:delete']);
    expectError(await api(BASE, { method: 'POST', token, body: { code: 'qq', name: 'n', native_name: 'n' } }), 403, 'FORBIDDEN');
  });
});

describe('GET /languages and /languages/all', () => {
  it('lists only live, active languages, CDN-cacheable', async () => {
    const live = await freeCode();
    expectSuccess(await post({ code: live, name: 'n', native_name: 'n' }), 201);
    const retired = await freeCode();
    expectSuccess(await post({ code: retired, name: 'n', native_name: 'n', is_active: false }), 201);
    const gone = await freeCode();
    expectSuccess(await post({ code: gone, name: 'n', native_name: 'n' }), 201);
    expectSuccess(await del(gone));

    const res = await api(BASE);

    expectSuccess(res);
    expect(res.body.message).toBe('Languages fetched');
    expect(res.headers.get('cache-control')).toBe('public, max-age=3600, s-maxage=86400');
    expect(res.headers.get('vary')).toMatch(/Accept-Language/);
    expect(codes(res)).toContain(live);
    expect(codes(res)).not.toContain(retired);
    expect(codes(res)).not.toContain(gone);
    expect(res.body.data.every((l: { is_active: boolean; deleted_at: unknown }) => l.is_active && l.deleted_at === null)).toBe(true);

    const all = await api(`${BASE}/all`, { token: await adminToken() });
    expectSuccess(all);
    expect(codes(all)).toEqual(expect.arrayContaining([live, retired]));
    expect(codes(all)).not.toContain(gone);

    await del(live);
    await del(retired);
  });

  it('needs languages:read for /all', async () => {
    expectError(await api(`${BASE}/all`), 401, 'UNAUTHORIZED');
    expectError(await api(`${BASE}/all`, { token: await tokenWith(['languages:create']) }), 403, 'FORBIDDEN');
  });
});

describe('PATCH /languages/:code', () => {
  it('updates only the fields sent', async () => {
    const code = await freeCode();
    expectSuccess(await post({ code, name: 'before', native_name: 'قبل' }), 201);

    const res = await patch(code, { name: 'after', is_active: false });

    expectSuccess(res);
    expect(res.body.message).toBe('Language updated');
    expect(res.body.data).toEqual({ code, name: 'after', native_name: 'قبل', is_active: false, deleted_at: null });
    expectSuccess(await patch(code, {}));
    await del(code);
  });

  it('is 404 for an unknown or deleted code', async () => {
    const code = await freeCode();
    expectSuccess(await post({ code, name: 'n', native_name: 'n' }), 201);
    expectSuccess(await del(code));

    expectError(await patch(code, { name: 'x' }), 404, 'NOT_FOUND', 'Language not found');
    expectError(await patch('zz', { name: 'x' }), 404, 'NOT_FOUND', 'Language not found');
  });

  it.each([
    ['a 101-char name', { name: 'x'.repeat(101) }, ['name must be shorter than or equal to 100 characters']],
    ['a non-boolean is_active', { is_active: 1 }, ['is_active must be a boolean value']],
    ['an unknown key', { code: 'qq' }, ['property code should not exist']],
  ])('rejects %s', async (_name, body, errors) => {
    const code = await freeCode();
    expectSuccess(await post({ code, name: 'n', native_name: 'n' }), 201);
    const res = await patch(code, body);
    expectError(res, 400, 'VALIDATION_FAILED', 'Validation failed');
    expect(errorsOf(res)).toEqual(errors);
    await del(code);
  });

  it('is 401 / 403 without the right permission', async () => {
    expectError(await api(`${BASE}/qq`, { method: 'PATCH', body: {} }), 401, 'UNAUTHORIZED');
    const token = await tokenWith(['languages:create']);
    expectError(await api(`${BASE}/qq`, { method: 'PATCH', token, body: {} }), 403, 'FORBIDDEN');
  });
});

describe('DELETE /languages/:code', () => {
  it('soft-deletes the language and keeps the row', async () => {
    const code = await freeCode();
    expectSuccess(await post({ code, name: 'n', native_name: 'n' }), 201);

    const res = await del(code);

    expectSuccess(res);
    expect(res.body).toMatchObject({ message: 'Language deleted', data: null });
    const rows = await withDb((q) => q('SELECT deleted_at FROM languages WHERE code = $1', [code]));
    expect(rows[0].deleted_at).not.toBeNull();
    expectError(await del(code), 404, 'NOT_FOUND', 'Language not found');
  });

  it('is 404 for an unknown code, 401 / 403 without languages:delete', async () => {
    expectError(await del('zz'), 404, 'NOT_FOUND', 'Language not found');
    expectError(await api(`${BASE}/qq`, { method: 'DELETE' }), 401, 'UNAUTHORIZED');
    const token = await tokenWith(['languages:create']);
    expectError(await api(`${BASE}/qq`, { method: 'DELETE', token }), 403, 'FORBIDDEN');
  });
});
