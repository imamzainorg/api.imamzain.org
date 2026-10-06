import { describe, expect, it } from 'vitest';
import { adminToken, api, expectError, expectSuccess, ISO_DATE, tokenWith } from './support/http';

const BASE = '/api/v1/settings';

/** A key no earlier run used: the suite runs twice on one DB in CI. */
const uid = () => `ct_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
const errorsOf = (res: { body: { errors?: string[] } }) => res.body.errors;

const put = async (key: string, body: unknown) => api(`${BASE}/${key}`, { method: 'PUT', token: await adminToken(), body });
const get = async (key: string) => api(`${BASE}/${key}`, { token: await adminToken() });
const del = async (key: string) => api(`${BASE}/${key}`, { method: 'DELETE', token: await adminToken() });

describe('PUT /settings/:key', () => {
  it('creates a string setting by default and answers 200 with the decoded row', async () => {
    const key = uid();
    const res = await put(key, { value: 'Hello' });

    expectSuccess(res);
    expect(res.body.message).toBe('Setting created');
    expect(Object.keys(res.body.data)).toEqual(['key', 'value', 'type', 'description', 'is_public', 'updated_at', 'updated_by']);
    expect(res.body.data).toMatchObject({
      key,
      value: 'Hello',
      type: 'string',
      description: null,
      is_public: false,
      updated_at: expect.stringMatching(ISO_DATE),
      updated_by: expect.any(String),
    });
    await del(key);
  });

  it('decodes the value by type on every read', async () => {
    const [num, bool, json] = [uid(), uid(), uid()];
    expectSuccess(await put(num, { value: '  42.5 ', type: 'number' }));
    expectSuccess(await put(bool, { value: 'true', type: 'boolean' }));
    expectSuccess(await put(json, { value: '{"a":[1,2]}', type: 'json' }));

    expect((await get(num)).body.data).toMatchObject({ value: 42.5, type: 'number' });
    expect((await get(bool)).body.data).toMatchObject({ value: true, type: 'boolean' });
    expect((await get(json)).body.data).toMatchObject({ value: { a: [1, 2] }, type: 'json' });
    for (const key of [num, bool, json]) await del(key);
  });

  it('updates an existing setting, keeping description and visibility it was not sent', async () => {
    const key = uid();
    expectSuccess(await put(key, { value: 'one', description: 'Label', is_public: true }));

    const res = await put(key, { value: 'two' });

    expectSuccess(res);
    expect(res.body.message).toBe('Setting updated');
    expect(res.body.data).toMatchObject({ key, value: 'two', description: 'Label', is_public: true });
    await del(key);
  });

  it('refuses to change the type of an existing setting, but accepts the same type', async () => {
    const key = uid();
    expectSuccess(await put(key, { value: '1', type: 'number' }));

    expectError(await put(key, { value: 'x', type: 'string' }), 409, 'CONFLICT', `Setting "${key}" already exists with type "number"; delete it first to change the type`);
    expectSuccess(await put(key, { value: '2', type: 'number' }));
    // A new value is judged by the stored type.
    expectError(await put(key, { value: 'nope' }), 400, 'BAD_REQUEST', 'Value "nope" is not a finite decimal number');
    await del(key);
  });

  it.each([
    ['number', 'abc', 'Value "abc" is not a finite decimal number'],
    ['number', '', 'Value "" is not a finite decimal number'],
    ['number', '0x1A', 'Value "0x1A" is not a finite decimal number'],
    ['number', 'Infinity', 'Value "Infinity" is not a finite decimal number'],
    ['boolean', 'yes', 'Value must be "true" or "false" for boolean settings'],
    ['json', '{nope', 'Value must be valid JSON for json settings'],
  ])('refuses a %s setting with value %j', async (type, value, message) => {
    expectError(await put(uid(), { value, type }), 400, 'BAD_REQUEST', message);
  });

  describe('validation', () => {
    const cases: [string, unknown, string[]][] = [
      ['a bad type', { value: 'x', type: 'date' }, ['type must be one of the following values: string, number, boolean, json']],
      ['a 10001-char value', { value: 'x'.repeat(10_001) }, ['value must be shorter than or equal to 10000 characters']],
      ['a 501-char description', { value: 'x', description: 'x'.repeat(501) }, ['description must be shorter than or equal to 500 characters']],
      ['a non-boolean is_public', { value: 'x', is_public: 'yes' }, ['is_public must be a boolean value']],
      ['an unknown key', { value: 'x', extra: 1 }, ['property extra should not exist']],
    ];

    it.each(cases)('rejects %s with Nest’s messages', async (_name, body, errors) => {
      const res = await put(uid(), body);
      expectError(res, 400, 'VALIDATION_FAILED', 'Validation failed');
      expect(errorsOf(res)).toEqual(errors);
    });

    it('rejects a missing value', async () => {
      const res = await put(uid(), {});
      expectError(res, 400, 'VALIDATION_FAILED', 'Validation failed');
      expect(errorsOf(res)).toContain('value must be a string');
    });

    it('rejects a key longer than 100 characters', async () => {
      const res = await put('k'.repeat(101), { value: 'x' });
      expectError(res, 400, 'VALIDATION_FAILED', 'Validation failed');
      expect(errorsOf(res)).toEqual(['key must be shorter than or equal to 100 characters']);
    });
  });

  it('is 401 without a token and 403 without settings:update', async () => {
    expectError(await api(`${BASE}/${uid()}`, { method: 'PUT', body: {} }), 401, 'UNAUTHORIZED', 'Unauthorized');
    const token = await tokenWith(['settings:read', 'settings:delete']);
    expectError(await api(`${BASE}/${uid()}`, { method: 'PUT', token, body: { value: 'x' } }), 403, 'FORBIDDEN');
  });
});

describe('GET /settings/public', () => {
  it('lists only public settings, without updated_by, CDN-cacheable', async () => {
    const [pub, priv] = [uid(), uid()];
    expectSuccess(await put(pub, { value: '7', type: 'number', description: 'Shown', is_public: true }));
    expectSuccess(await put(priv, { value: 'secret' }));

    const res = await api(`${BASE}/public`);

    expectSuccess(res);
    expect(res.body.message).toBe('Public settings fetched');
    expect(res.headers.get('cache-control')).toBe('public, max-age=900, s-maxage=3600');
    expect(res.headers.get('vary')).toMatch(/Accept-Language/);
    const keys = res.body.data.map((s: { key: string }) => s.key);
    expect(keys).toContain(pub);
    expect(keys).not.toContain(priv);
    const row = res.body.data.find((s: { key: string }) => s.key === pub);
    expect(Object.keys(row)).toEqual(['key', 'value', 'type', 'description', 'is_public', 'updated_at']);
    expect(row).toMatchObject({ value: 7, type: 'number', description: 'Shown', is_public: true });
    await del(pub);
    await del(priv);
  });

  it('reflects a delete at once', async () => {
    const key = uid();
    expectSuccess(await put(key, { value: 'x', is_public: true }));
    expect((await api(`${BASE}/public`)).body.data.map((s: { key: string }) => s.key)).toContain(key);

    expectSuccess(await del(key));
    expect((await api(`${BASE}/public`)).body.data.map((s: { key: string }) => s.key)).not.toContain(key);
  });
});

describe('GET /settings and /settings/:key', () => {
  it('lists every setting ordered by key, with updated_by', async () => {
    const prefix = uid();
    const [a, b] = [`${prefix}_a`, `${prefix}_b`];
    expectSuccess(await put(b, { value: 'b' }));
    expectSuccess(await put(a, { value: 'a' }));

    const res = await api(BASE, { token: await adminToken() });

    expectSuccess(res);
    expect(res.body.message).toBe('Settings fetched');
    const keys = res.body.data.map((s: { key: string }) => s.key);
    expect(keys.indexOf(a)).toBeLessThan(keys.indexOf(b));
    expect(res.body.data[0]).toHaveProperty('updated_by');
    await del(a);
    await del(b);
  });

  it('fetches one setting and is 404 for an unknown key', async () => {
    const key = uid();
    expectSuccess(await put(key, { value: 'x' }));

    const res = await get(key);
    expectSuccess(res);
    expect(res.body.message).toBe('Setting fetched');
    expect(res.body.data.key).toBe(key);
    expectError(await get(uid()), 404, 'NOT_FOUND', 'Setting not found');
    await del(key);
  });

  it('is 401 / 403 without settings:read', async () => {
    const token = await tokenWith(['settings:update']);
    expectError(await api(BASE), 401, 'UNAUTHORIZED');
    expectError(await api(BASE, { token }), 403, 'FORBIDDEN');
    expectError(await api(`${BASE}/anything`), 401, 'UNAUTHORIZED');
    expectError(await api(`${BASE}/anything`, { token }), 403, 'FORBIDDEN');
  });
});

describe('DELETE /settings/:key', () => {
  it('deletes the setting for good', async () => {
    const key = uid();
    expectSuccess(await put(key, { value: 'x' }));

    const res = await del(key);

    expectSuccess(res);
    expect(res.body).toMatchObject({ message: 'Setting deleted', data: null });
    expectError(await get(key), 404, 'NOT_FOUND', 'Setting not found');
    expectError(await del(key), 404, 'NOT_FOUND', 'Setting not found');
    // Gone for good, so the type can change on re-create.
    expectSuccess(await put(key, { value: '1', type: 'number' }));
    await del(key);
  });

  it('is 401 / 403 without settings:delete', async () => {
    expectError(await api(`${BASE}/anything`, { method: 'DELETE' }), 401, 'UNAUTHORIZED');
    const token = await tokenWith(['settings:read', 'settings:update']);
    expectError(await api(`${BASE}/anything`, { method: 'DELETE', token }), 403, 'FORBIDDEN');
  });
});
