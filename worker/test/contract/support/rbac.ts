import { expect } from 'vitest';
import { adminToken, api, expectSuccess, withDb } from './http';

/** Shared setup for the users, roles and auth suites. Names are unique per call: the suite runs twice on one DB. */
export const uid = (prefix: string) => `${prefix}${Date.now().toString(36)}${crypto.randomUUID().slice(0, 5)}`;

export const PASSWORD = 'contract-password-1';

/** Four spellings of one name that differ only in letter case. */
export const caseVariants = (name: string) => [name, name.toUpperCase(), name[0].toUpperCase() + name.slice(1), name.slice(0, -1) + name.slice(-1).toUpperCase()];

export interface TestUser {
  id: string;
  username: string;
}

export async function createUser(username = uid('u'), password = PASSWORD): Promise<TestUser> {
  const res = await api('/api/v1/users', { method: 'POST', token: await adminToken(), body: { username, password } });
  expectSuccess(res, 201);
  return { id: res.body.data.id, username: res.body.data.username };
}

/** A role holding the named permissions. */
export async function createRole(permissionNames: string[] = [], name = uid('role-')): Promise<{ id: string; name: string }> {
  const token = await adminToken();
  const res = await api('/api/v1/roles', { method: 'POST', token, body: { name, translations: [{ lang: 'ar', title: `عنوان ${name}` }] } });
  expectSuccess(res, 201);
  const ids = await permissionIds(permissionNames);
  for (const name of permissionNames) {
    expectSuccess(await api(`/api/v1/roles/${res.body.data.id}/permissions`, { method: 'POST', token, body: { permissionId: ids[name] } }), 201);
  }
  return { id: res.body.data.id, name };
}

export async function assignRole(userId: string, roleId: string) {
  expectSuccess(await api(`/api/v1/users/${userId}/roles`, { method: 'POST', token: await adminToken(), body: { role_id: roleId } }), 201);
}

export function permissionIds(names: string[]): Promise<Record<string, string>> {
  return withDb(async (q) => {
    const rows = await q('SELECT id, name FROM permissions WHERE name = ANY($1)', [names]);
    expect(rows).toHaveLength(names.length);
    return Object.fromEntries(rows.map((r) => [r.name as string, r.id as string]));
  });
}

export async function login(username: string, password = PASSWORD) {
  return api('/api/v1/auth/login', { method: 'POST', body: { username, password } });
}

export const tokenSub = (token: string): string => JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).sub;

/**
 * The last-administrator tests send requests that, were the 409 not to come, would strip the harness
 * admin of its permissions and break every later test. They run only when the DB proves the 409 must
 * come: the admin is the one live user holding every permission, and only through `super-admin`.
 * Returns the admin, its super-admin role, and a permission that role alone gives the admin.
 */
export async function soleAdministrator(): Promise<{ adminId: string; superAdminRoleId: string; permissionId: string }> {
  const adminId = tokenSub(await adminToken());
  return withDb(async (q) => {
    const [{ total }] = await q('SELECT count(*)::int AS total FROM permissions');
    const full = await q(
      `SELECT ur.user_id FROM user_roles ur JOIN users u ON u.id = ur.user_id JOIN role_permissions rp ON rp.role_id = ur.role_id
       WHERE u.deleted_at IS NULL GROUP BY ur.user_id HAVING count(DISTINCT rp.permission_id) = $1`,
      [total],
    );
    if (full.length !== 1 || full[0].user_id !== adminId) throw new Error('precondition: the harness admin must be the only full-permission user');
    const [role] = await q(`SELECT id FROM roles WHERE name = 'super-admin'`);
    const [only] = await q(
      `SELECT rp.permission_id FROM role_permissions rp WHERE rp.role_id = $1 AND NOT EXISTS (
         SELECT 1 FROM user_roles ur JOIN role_permissions o ON o.role_id = ur.role_id
         WHERE ur.user_id = $2 AND ur.role_id <> $1 AND o.permission_id = rp.permission_id)
       ORDER BY rp.permission_id LIMIT 1`,
      [role.id, adminId],
    );
    if (!only) throw new Error('precondition: every super-admin permission is also granted to the admin by another role');
    return { adminId, superAdminRoleId: role.id as string, permissionId: only.permission_id as string };
  });
}

/** Every permission name: the token of an actor allowed everything, without being an administrator in the DB. */
export const allPermissionNames = () => withDb(async (q) => (await q('SELECT name FROM permissions ORDER BY name')).map((r) => r.name as string));
