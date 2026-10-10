import { describe, expect, it } from 'vitest';
import { adminToken, api, expectError, expectSuccess, tokenFor, tokenWith, workerOnly } from './support/http';
import { allPermissionNames, caseVariants, assignRole, createRole, createUser, login, permissionIds, soleAdministrator, uid } from './support/rbac';

const BASE = '/api/v1/roles';
const MISSING = '00000000-0000-4000-8000-000000000000';
const FORBIDDEN = 'You do not have permission to access this resource';

const tr = (lang: string, title = `title ${lang}`, extra: Record<string, unknown> = {}) => ({ lang, title, ...extra });

async function post(body: unknown, token?: string) {
  return api(BASE, { method: 'POST', token: token ?? (await adminToken()), body });
}

async function create(name = uid('role-'), translations = [tr('ar')]) {
  const res = await post({ name, translations });
  expectSuccess(res, 201);
  return res.body.data;
}

describe('POST /roles', () => {
  it('creates the role, trimming the name, and answers with its translations and no permissions', async () => {
    const name = uid('role-');
    const res = await post({ name: `  ${name}  `, translations: [tr('ar', 'مدير', { description: 'وصف' }), tr('en', 'Manager')] });

    expectSuccess(res, 201);
    expect(res.body.message).toBe('Role created');
    const data = res.body.data;
    expect(Object.keys(data)).toEqual(['id', 'name', 'role_translations', 'translation', 'permissions']);
    expect(data.name).toBe(name);
    expect(data.permissions).toEqual([]);
    expect(data.role_translations).toHaveLength(2);
    expect(data.translation).toEqual({ role_id: data.id, lang: 'ar', title: 'مدير', description: 'وصف' });
  });

  it('refuses a name another role has in any letter case', async () => {
    const name = uid('role-');
    await create(name);
    expectError(await post({ name: name.toUpperCase(), translations: [tr('ar')] }), 409, 'CONFLICT', 'A role with that name already exists');
  });

  // REHAUL-FINDINGS-2026-09 (roles.service.ts:128): Nest's check-then-insert lets concurrent case variants through.
  workerOnly('worker-only: concurrent case variants of one new name create exactly one role', async () => {
    const token = await adminToken();
    const results = await Promise.all(caseVariants(uid('race-')).map((name) => post({ name, translations: [tr('ar')] }, token)));
    expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409, 409]);
  });

  it('refuses the same language twice and an unknown language', async () => {
    expectError(await post({ name: uid('role-'), translations: [tr('ar'), tr('ar')] }), 409, 'CONFLICT', 'A record with that value already exists');
    expectError(
      await post({ name: uid('role-'), translations: [tr('zz')] }),
      400,
      'FK_CONSTRAINT_VIOLATION',
      'Foreign key constraint failed — referenced record does not exist',
    );
  });

  it.each([
    ['a name that is short once trimmed', { name: ' a ', translations: [tr('ar')] }, ['name must be longer than or equal to 2 characters']],
    ['a 51-char name', { name: 'x'.repeat(51), translations: [tr('ar')] }, ['name must be shorter than or equal to 50 characters']],
    ['no translations', { name: 'role-x', translations: [] }, ['translations must contain at least 1 elements']],
    ['a three-letter lang', { name: 'role-x', translations: [tr('ara')] }, ['translations.0.lang must be shorter than or equal to 2 characters']],
    ['an empty title', { name: 'role-x', translations: [tr('ar', '')] }, ['translations.0.title must be longer than or equal to 1 characters']],
    ['a 201-char title', { name: 'role-x', translations: [tr('ar', 'x'.repeat(201))] }, ['translations.0.title must be shorter than or equal to 200 characters']],
    [
      'a 1001-char description',
      { name: 'role-x', translations: [tr('ar', 't', { description: 'x'.repeat(1001) })] },
      ['translations.0.description must be shorter than or equal to 1000 characters'],
    ],
    ['an unknown key', { name: 'role-x', translations: [tr('ar')], extra: 1 }, ['property extra should not exist']],
  ])('rejects %s', async (_name, body, errors) => {
    const res = await post(body);
    expectError(res, 400, 'VALIDATION_FAILED', 'Validation failed');
    expect(res.body.errors).toEqual(errors);
  });

  it('is 401 without a token and 403 without roles:create', async () => {
    expectError(await api(BASE, { method: 'POST', body: {} }), 401, 'UNAUTHORIZED', 'Unauthorized');
    expectError(await post({ name: uid('role-'), translations: [tr('ar')] }, await tokenWith(['roles:read', 'roles:update'])), 403, 'FORBIDDEN', FORBIDDEN);
  });
});

describe('GET /roles and /roles/permissions', () => {
  it('lists roles by name with the translation for Accept-Language', async () => {
    const stem = uid('role-');
    const b = await create(`${stem}-b`, [tr('ar', 'ب'), tr('en', 'B')]);
    const a = await create(`${stem}-a`, [tr('ar', 'أ')]);

    const res = await api(`${BASE}?limit=100`, { token: await adminToken(), lang: 'en' });
    expectSuccess(res);
    expect(res.body.message).toBe('Roles fetched');
    const names: string[] = res.body.data.items.map((r: { name: string }) => r.name);
    expect(names.indexOf(a.name)).toBeLessThan(names.indexOf(b.name));
    const items = res.body.data.items as { id: string; translation: { lang: string } }[];
    expect(items.find((r) => r.id === b.id)!.translation.lang).toBe('en');
    expect(items.find((r) => r.id === a.id)!.translation.lang).toBe('ar');
  });

  // The controller's `limit ?? 100` never applies: the query DTO already defaults it to 20.
  it('pages permissions by 20 by default, sorted by name', async () => {
    const res = await api(`${BASE}/permissions`, { token: await adminToken() });
    expectSuccess(res);
    expect(res.body.message).toBe('Permissions fetched');
    expect(res.body.data.pagination).toMatchObject({ page: 1, limit: 20 });
    const names = res.body.data.items.map((p: { name: string }) => p.name);
    expect(names).toEqual(await allPermissionNames().then((all) => all.slice(0, 20)));
    expect(Object.keys(res.body.data.items[0])).toEqual(['id', 'name', 'permission_translations', 'translation']);
  });

  it('is 403 without roles:read', async () => {
    expectError(await api(BASE, { token: await tokenWith(['roles:update']) }), 403, 'FORBIDDEN', FORBIDDEN);
    expectError(await api(`${BASE}/permissions`, { token: await tokenWith(['users:read']) }), 403, 'FORBIDDEN', FORBIDDEN);
  });
});

describe('GET /roles/:id', () => {
  it('answers with the role, and 404 for a missing one', async () => {
    const role = await create();
    const res = await api(`${BASE}/${role.id}`, { token: await adminToken() });
    expectSuccess(res);
    expect(res.body.message).toBe('Role fetched');
    expect(res.body.data).toEqual(role);
    expectError(await api(`${BASE}/${MISSING}`, { token: await adminToken() }), 404, 'NOT_FOUND', 'Role not found');
  });
});

describe('PATCH /roles/:id', () => {
  it('renames and upserts translations: an existing language is updated, a new one added', async () => {
    const role = await create(uid('role-'), [tr('ar', 'قديم')]);
    const name = uid('role-');
    const res = await api(`${BASE}/${role.id}`, {
      method: 'PATCH',
      token: await adminToken(),
      body: { name, translations: [tr('ar', 'جديد'), tr('en', 'New', { description: 'd' })] },
    });

    expectSuccess(res);
    expect(res.body.message).toBe('Role updated');
    expect(res.body.data.name).toBe(name);
    const byLang = Object.fromEntries(res.body.data.role_translations.map((t: { lang: string }) => [t.lang, t]));
    expect(byLang.ar).toMatchObject({ title: 'جديد', description: null });
    expect(byLang.en).toMatchObject({ title: 'New', description: 'd' });
  });

  it('refuses a name another role has in any case, but allows a case-only rename of itself', async () => {
    const other = await create();
    const role = await create();
    const patch = async (name: string) => api(`${BASE}/${role.id}`, { method: 'PATCH', token: await adminToken(), body: { name } });

    expectError(await patch(other.name.toUpperCase()), 409, 'CONFLICT', 'A role with that name already exists');
    const res = await patch(role.name.toUpperCase());
    expectSuccess(res);
    expect(res.body.data.name).toBe(role.name.toUpperCase());
  });

  it('is 404 for a missing role', async () => {
    expectError(await api(`${BASE}/${MISSING}`, { method: 'PATCH', token: await adminToken(), body: {} }), 404, 'NOT_FOUND', 'Role not found');
  });
});

describe('DELETE /roles/:id', () => {
  it('refuses a role assigned to a user', async () => {
    const role = await create();
    const user = await createUser();
    await assignRole(user.id, role.id);
    expectError(await api(`${BASE}/${role.id}`, { method: 'DELETE', token: await adminToken() }), 409, 'CONFLICT', 'Cannot delete a role that is assigned to users');
  });

  it('deletes an unassigned role with its permissions, then 404s', async () => {
    const role = await createRole(['posts:read']);
    const res = await api(`${BASE}/${role.id}`, { method: 'DELETE', token: await adminToken() });
    expectSuccess(res);
    expect(res.body).toMatchObject({ message: 'Role deleted', data: null });
    expectError(await api(`${BASE}/${role.id}`, { method: 'DELETE', token: await adminToken() }), 404, 'NOT_FOUND', 'Role not found');
  });
});

describe('POST /roles/:id/permissions', () => {
  it('grants a permission once, however often it is sent', async () => {
    const role = await create();
    const { 'posts:read': permissionId } = await permissionIds(['posts:read']);
    const grant = async () => api(`${BASE}/${role.id}/permissions`, { method: 'POST', token: await adminToken(), body: { permissionId } });

    const res = await grant();
    expectSuccess(res, 201);
    expect(res.body.message).toBe('Permission assigned');
    expect(res.body.data.permissions).toEqual([expect.objectContaining({ id: permissionId, name: 'posts:read' })]);
    expect((await grant()).body.data.permissions).toHaveLength(1);
  });

  it('invalidates the access tokens of every user holding the role', async () => {
    const role = await createRole(['posts:read']);
    const user = await createUser();
    await assignRole(user.id, role.id);
    const token = (await login(user.username)).body.data.accessToken;
    // Any route the Worker serves: the user lacks users:read, so a live token gets 403.
    expectError(await api(`/api/v1/users/${user.id}`, { token }), 403, 'FORBIDDEN');

    const { 'audios:read': permissionId } = await permissionIds(['audios:read']);
    expectSuccess(await api(`${BASE}/${role.id}/permissions`, { method: 'POST', token: await adminToken(), body: { permissionId } }), 201);

    expectError(await api(`/api/v1/users/${user.id}`, { token }), 401, 'UNAUTHORIZED', 'Token has been invalidated');
    expect((await login(user.username)).body.data.user.permissions.sort()).toEqual(['audios:read', 'posts:read']);
  });

  it('refuses to grant a permission the actor does not hold', async () => {
    const role = await create();
    const { 'books:delete': permissionId } = await permissionIds(['books:delete']);
    expectError(
      await api(`${BASE}/${role.id}/permissions`, { method: 'POST', token: await tokenWith(['roles:update']), body: { permissionId } }),
      403,
      'FORBIDDEN',
      'You cannot grant a permission you do not hold yourself',
    );
  });

  it('is 404 for a missing role or permission, 400 for a bad id', async () => {
    const role = await create();
    const { 'posts:read': permissionId } = await permissionIds(['posts:read']);
    const token = await adminToken();
    expectError(await api(`${BASE}/${MISSING}/permissions`, { method: 'POST', token, body: { permissionId } }), 404, 'NOT_FOUND', 'Role not found');
    expectError(await api(`${BASE}/${role.id}/permissions`, { method: 'POST', token, body: { permissionId: MISSING } }), 404, 'NOT_FOUND', 'Permission not found');
    for (const body of [{}, { permissionId: 'nope' }]) {
      const res = await api(`${BASE}/${role.id}/permissions`, { method: 'POST', token, body });
      expectError(res, 400, 'VALIDATION_FAILED', 'Validation failed');
      expect(res.body.errors).toEqual(['permissionId must be a UUID']);
    }
  });
});

describe('DELETE /roles/:id/permissions/:permissionId', () => {
  it('revokes a permission, then 404s when it is no longer assigned', async () => {
    const role = await createRole(['posts:read', 'audios:read']);
    const { 'posts:read': permissionId } = await permissionIds(['posts:read']);
    const revoke = async () => api(`${BASE}/${role.id}/permissions/${permissionId}`, { method: 'DELETE', token: await adminToken() });

    const res = await revoke();
    expectSuccess(res);
    expect(res.body.message).toBe('Permission removed');
    expect(res.body.data.permissions.map((p: { name: string }) => p.name)).toEqual(['audios:read']);
    expectError(await revoke(), 404, 'NOT_FOUND', 'Permission is not assigned to this role');
  });

  it('refuses to revoke a permission the actor does not hold', async () => {
    const role = await createRole(['books:delete']);
    const { 'books:delete': permissionId } = await permissionIds(['books:delete']);
    expectError(
      await api(`${BASE}/${role.id}/permissions/${permissionId}`, { method: 'DELETE', token: await tokenWith(['roles:update']) }),
      403,
      'FORBIDDEN',
      'You cannot revoke a permission you do not hold yourself',
    );
  });

  it('refuses to leave no active user holding every permission', async () => {
    const { superAdminRoleId, permissionId } = await soleAdministrator();
    // An actor that may do anything without being an administrator in the DB.
    const actor = await createUser();
    const token = await tokenFor(actor.id, await allPermissionNames());

    expectError(
      await api(`${BASE}/${superAdminRoleId}/permissions/${permissionId}`, { method: 'DELETE', token }),
      409,
      'CONFLICT',
      'This change would leave no active user holding every permission — grant another account the full permission set first',
    );
  });
});
