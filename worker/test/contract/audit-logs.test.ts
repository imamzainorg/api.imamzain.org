import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { adminToken, api, expectError, expectSuccess, ISO_DATE, tokenWith, withDb } from './support/http';

const BASE = '/api/v1/audit-logs';
const uid = () => `ct_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
const get = async (path: string) => api(`${BASE}${path}`, { token: await adminToken() });

const RUN = uid();
const ids: string[] = [];
let userId: string;

// Three rows 1 h apart, the last two sharing a created_at so the id tie-break shows.
beforeAll(async () => {
  await withDb(async (q) => {
    userId = (await q(`SELECT id::text AS id FROM users WHERE deleted_at IS NULL ORDER BY created_at LIMIT 1`))[0].id as string;
    for (const [n, at] of [[1, '2020-01-01T00:00:00Z'], [2, '2020-01-01T01:00:00Z'], [3, '2020-01-01T01:00:00Z']] as const) {
      const rows = await q(
        `INSERT INTO audit_logs (user_id, action, resource_type, resource_id, created_at) VALUES ($1, $2, 'ct_resource', $3, $4) RETURNING id::text AS id`,
        [n === 1 ? null : userId, RUN, `${RUN}-${n}`, at],
      );
      ids.push(rows[0].id as string);
    }
  });
});

describe('GET /audit-logs', () => {
  it('lists newest first, ties by id, with the user inlined and a null user kept', async () => {
    const res = await get(`?action=${RUN}`);

    expectSuccess(res);
    expect(res.body.message).toBe('Audit logs fetched');
    const { items, pagination } = res.body.data;
    expect(pagination).toEqual({ page: 1, limit: 20, total: 3, pages: 1 });
    expect(items.map((i: { id: string }) => i.id)).toEqual([...[ids[1], ids[2]].sort(), ids[0]]);
    expect(items[0].created_at).toMatch(ISO_DATE);
    expect(items[0].users).toEqual({ id: userId, username: expect.any(String) });
    expect(items.at(-1).users).toBeNull();
  });

  it('filters by user, resource and date range, and paginates', async () => {
    expect((await get(`?action=${RUN}&user_id=${userId}`)).body.data.pagination.total).toBe(2);
    expect((await get(`?action=${RUN}&resource_type=ct_resource&resource_id=${RUN}-2`)).body.data.items).toHaveLength(1);
    expect((await get(`?action=${RUN}&from=2020-01-01T00:30:00Z`)).body.data.pagination.total).toBe(2);
    expect((await get(`?action=${RUN}&to=2020-01-01T00:30:00Z`)).body.data.pagination.total).toBe(1);

    const page = await get(`?action=${RUN}&limit=2&page=2`);
    expect(page.body.data.pagination).toEqual({ page: 2, limit: 2, total: 3, pages: 2 });
    expect(page.body.data.items).toHaveLength(1);
  });

  it.each([
    ['a malformed user_id', '?user_id=nope', ['user_id must be a UUID']],
    ['a malformed date', '?from=yesterday', ['from must be a valid ISO 8601 date string']],
    ['limit above 100', '?limit=101', ['limit must not be greater than 100']],
    ['page 0', '?page=0', ['page must not be less than 1']],
    ['an unknown filter', '?foo=1', ['property foo should not exist']],
  ])('rejects %s', async (_name, query, errors) => {
    const res = await get(query);
    expectError(res, 400, 'VALIDATION_FAILED', 'Validation failed');
    expect(res.body.errors).toEqual(errors);
  });

  it('needs a token with audit-logs:read', async () => {
    expectError(await api(BASE), 401, 'UNAUTHORIZED');
    expectError(await api(BASE, { token: await tokenWith(['posts:read']) }), 403, 'FORBIDDEN');
    expectSuccess(await api(BASE, { token: await tokenWith(['audit-logs:read']) }));
  });
});

describe('GET /audit-logs/:id', () => {
  it('returns one entry with its user', async () => {
    const res = await get(`/${ids[1]}`);

    expectSuccess(res);
    expect(res.body.message).toBe('Audit log entry fetched');
    expect(res.body.data).toMatchObject({ id: ids[1], action: RUN, resource_id: `${RUN}-2`, users: { id: userId } });
  });

  it('is a 404 for an unknown id and a 400 for a malformed one', async () => {
    expectError(await get(`/${randomUUID()}`), 404, 'NOT_FOUND', 'Audit log entry not found');
    expectError(await get('/nope'), 400, 'INVALID_IDENTIFIER');
  });

  it('needs a token with audit-logs:read', async () => {
    expectError(await api(`${BASE}/${ids[0]}`), 401, 'UNAUTHORIZED');
    expectError(await api(`${BASE}/${ids[0]}`, { token: await tokenWith(['posts:read']) }), 403, 'FORBIDDEN');
  });
});
