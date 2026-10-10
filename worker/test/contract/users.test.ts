import { describe, expect, it } from 'vitest';
import { adminToken, api, expectError, expectSuccess, ISO_DATE, tokenFor, tokenWith, withDb, workerOnly } from './support/http';
import { PASSWORD, allPermissionNames, caseVariants, assignRole, createRole, createUser, login, soleAdministrator, tokenSub, uid } from './support/rbac';

const BASE = '/api/v1/users';
const MISSING = '00000000-0000-4000-8000-000000000000';
const ENVELOPE = 'You cannot manage a user who holds permissions beyond your own';

const del = async (id: string, token?: string) => api(`${BASE}/${id}`, { method: 'DELETE', token: token ?? (await adminToken()) });
const restore = async (id: string, token?: string) => api(`${BASE}/${id}/restore`, { method: 'POST', token: token ?? (await adminToken()) });

describe('POST /users', () => {
  it('creates a user, trimming the username, whose password then logs in', async () => {
    const username = uid('u');
    const res = await api(BASE, { method: 'POST', token: await adminToken(), body: { username: `  ${username} `, password: PASSWORD } });

    expectSuccess(res, 201);
    expect(res.body.message).toBe('User created');
    expect(Object.keys(res.body.data)).toEqual(['id', 'username', 'created_at', 'updated_at', 'is_active', 'user_roles', 'permissions']);
    expect(res.body.data).toMatchObject({ username, created_at: expect.stringMatching(ISO_DATE), is_active: true, user_roles: [], permissions: [] });
    expect(JSON.stringify(res.body)).not.toMatch(/password/);

    // The hash must verify wherever login runs.
    const session = await login(username);
    expectSuccess(session);
    expect(session.body.data.user).toMatchObject({ id: res.body.data.id, must_change_password: false });
  });

  it('refuses a username a live user has in any letter case', async () => {
    const { username } = await createUser();
    expectError(
      await api(BASE, { method: 'POST', token: await adminToken(), body: { username: username.toUpperCase(), password: PASSWORD } }),
      409,
      'CONFLICT',
      'Username is already taken',
    );
  });

  // REHAUL-FINDINGS-2026-09 (users.service.ts:145): Nest's check-then-insert lets concurrent case variants through.
  workerOnly('worker-only: concurrent case variants of one new username create exactly one user', async () => {
    const token = await adminToken();
    const results = await Promise.all(caseVariants(uid('race')).map((username) => api(BASE, { method: 'POST', token, body: { username, password: PASSWORD } })));
    expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409, 409]);
  });

  it.each([
    ['a username short once trimmed', { username: '  ab  ', password: PASSWORD }, ['username must be longer than or equal to 3 characters']],
    ['a 51-char username', { username: 'u'.repeat(51), password: PASSWORD }, ['username must be shorter than or equal to 50 characters']],
    ['a 9-char password', { username: 'user-x', password: 'x'.repeat(9) }, ['password must be longer than or equal to 10 characters']],
    ['a 129-char password', { username: 'user-x', password: 'x'.repeat(129) }, ['password must be shorter than or equal to 128 characters']],
    ['an unknown key', { username: 'user-x', password: PASSWORD, role: 'admin' }, ['property role should not exist']],
  ])('rejects %s', async (_name, body, errors) => {
    const res = await api(BASE, { method: 'POST', token: await adminToken(), body });
    expectError(res, 400, 'VALIDATION_FAILED', 'Validation failed');
    expect(res.body.errors).toEqual(errors);
  });

  it('is 401 without a token and 403 without users:create', async () => {
    expectError(await api(BASE, { method: 'POST', body: {} }), 401, 'UNAUTHORIZED', 'Unauthorized');
    expectError(
      await api(BASE, { method: 'POST', token: await tokenWith(['users:read', 'users:update']), body: { username: uid('u'), password: PASSWORD } }),
      403,
      'FORBIDDEN',
      'You do not have permission to access this resource',
    );
  });
});

describe('GET /users and /users/:id', () => {
  it('lists live users newest first, without the deleted ones', async () => {
    const older = await createUser();
    const newer = await createUser();
    const gone = await createUser();
    expectSuccess(await del(gone.id));

    const res = await api(`${BASE}?limit=100`, { token: await adminToken() });
    expectSuccess(res);
    expect(res.body.message).toBe('Users fetched');
    const ids = res.body.data.items.map((u: { id: string }) => u.id);
    expect(ids.indexOf(newer.id)).toBeLessThan(ids.indexOf(older.id));
    expect(ids).not.toContain(gone.id);
    expect(Object.keys(res.body.data.items[0])).toEqual(['id', 'username', 'created_at', 'updated_at', 'user_roles', 'is_active']);
  });

  it('answers with roles and the flattened permissions; 404 for a missing or deleted user', async () => {
    const role = await createRole(['posts:read', 'audios:read']);
    const user = await createUser();
    await assignRole(user.id, role.id);

    const res = await api(`${BASE}/${user.id}`, { token: await adminToken() });
    expectSuccess(res);
    expect(res.body.message).toBe('User fetched');
    expect(res.body.data.user_roles).toEqual([{ user_id: user.id, role_id: role.id, roles: { id: role.id, name: role.name, role_permissions: expect.any(Array) } }]);
    expect(res.body.data.permissions.sort()).toEqual(['audios:read', 'posts:read']);

    const gone = await createUser();
    expectSuccess(await del(gone.id));
    for (const id of [MISSING, gone.id]) expectError(await api(`${BASE}/${id}`, { token: await adminToken() }), 404, 'NOT_FOUND', 'User not found');
  });

  it('is 403 without users:read', async () => {
    expectError(await api(BASE, { token: await tokenWith(['users:update']) }), 403, 'FORBIDDEN');
  });
});

describe('PATCH /users/:id', () => {
  it('renames a user; a case-only rename of the same user is allowed', async () => {
    const user = await createUser();
    const patch = async (username: string) => api(`${BASE}/${user.id}`, { method: 'PATCH', token: await adminToken(), body: { username } });

    const renamed = uid('u');
    const res = await patch(` ${renamed} `);
    expectSuccess(res);
    expect(res.body).toMatchObject({ message: 'User updated', data: { id: user.id, username: renamed } });
    expect((await patch(renamed.toUpperCase())).body.data.username).toBe(renamed.toUpperCase());
  });

  it('refuses a name another live user has in any case', async () => {
    const other = await createUser();
    const user = await createUser();
    expectError(
      await api(`${BASE}/${user.id}`, { method: 'PATCH', token: await adminToken(), body: { username: other.username.toUpperCase() } }),
      409,
      'CONFLICT',
      'Username is already taken',
    );
  });

  it('refuses an actor managing a user who holds permissions beyond their own; peers may', async () => {
    const role = await createRole(['roles:read']);
    const strong = await createUser();
    await assignRole(strong.id, role.id);
    const weak = await createUser();
    const token = await tokenWith(['users:update']);

    expectError(await api(`${BASE}/${strong.id}`, { method: 'PATCH', token, body: { username: uid('u') } }), 403, 'FORBIDDEN', ENVELOPE);
    expectSuccess(await api(`${BASE}/${weak.id}`, { method: 'PATCH', token, body: { username: uid('u') } }));
  });
});

describe('POST /users/:id/reset-password', () => {
  it('sets the password, ends every session and flags the account', async () => {
    const user = await createUser();
    const session = (await login(user.username)).body.data;
    const newPassword = 'admin-chosen-pass';

    const res = await api(`${BASE}/${user.id}/reset-password`, { method: 'POST', token: await adminToken(), body: { new_password: newPassword } });
    expectSuccess(res);
    expect(res.body).toMatchObject({ message: 'Password reset; user must re-authenticate', data: null });

    expectError(await api(`${BASE}/${user.id}`, { token: session.accessToken }), 401, 'UNAUTHORIZED', 'Token has been invalidated');
    expectError(await api('/api/v1/auth/refresh', { method: 'POST', body: { refresh_token: session.refresh_token } }), 401, 'AUTH_REFRESH_INVALID');
    expectError(await login(user.username), 401, 'UNAUTHORIZED', 'Invalid credentials');
    expect((await login(user.username, newPassword)).body.data.user.must_change_password).toBe(true);
  });

  it('refuses a target beyond the actor’s permissions, and 404s a missing user', async () => {
    const role = await createRole(['roles:read']);
    const strong = await createUser();
    await assignRole(strong.id, role.id);
    const body = { new_password: 'another-password' };

    expectError(await api(`${BASE}/${strong.id}/reset-password`, { method: 'POST', token: await tokenWith(['users:update']), body }), 403, 'FORBIDDEN', ENVELOPE);
    expectError(await api(`${BASE}/${MISSING}/reset-password`, { method: 'POST', token: await adminToken(), body }), 404, 'NOT_FOUND', 'User not found');
    const short = await api(`${BASE}/${strong.id}/reset-password`, { method: 'POST', token: await adminToken(), body: { new_password: 'short' } });
    expectError(short, 400, 'VALIDATION_FAILED');
    expect(short.body.errors).toEqual(['new_password must be longer than or equal to 10 characters']);
  });
});

describe('DELETE /users/:id, trash and restore', () => {
  it('soft-deletes, frees the username, lists the original name in the trash, and restores', async () => {
    const user = await createUser();
    const session = (await login(user.username)).body.data;

    const res = await del(user.id);
    expectSuccess(res);
    expect(res.body).toMatchObject({ message: 'User deleted', data: null });
    expectError(await api(`${BASE}/${user.id}`, { token: session.accessToken }), 401, 'UNAUTHORIZED', 'Unauthorized');

    const trash = await api(`${BASE}/trash?limit=100`, { token: await adminToken() });
    expectSuccess(trash);
    expect(trash.body.message).toBe('Trash fetched');
    const row = trash.body.data.items.find((u: { id: string }) => u.id === user.id);
    expect(row).toEqual({ id: user.id, created_at: expect.any(String), updated_at: expect.any(String), user_roles: [], username: user.username, is_active: false });

    // The name is free while the user sits in the trash; restoring then collides with the new owner.
    const taker = await createUser(user.username);
    expectError(await restore(user.id), 409, 'CONFLICT', `Cannot restore: username "${user.username}" is now used by another user`);
    expectSuccess(await del(taker.id));

    const back = await restore(user.id);
    expectSuccess(back);
    expect(back.body).toMatchObject({ message: 'User restored', data: { id: user.id, username: user.username, is_active: true } });
    expectError(await restore(user.id), 404, 'NOT_FOUND', 'Deleted user not found');
  });

  it('refuses deleting your own account', async () => {
    const admin = await adminToken();
    expectError(await del(tokenSub(admin), admin), 403, 'FORBIDDEN', 'You cannot delete your own account');
  });

  it('refuses deleting or restoring a user beyond the actor’s permissions', async () => {
    const role = await createRole(['roles:delete']);
    const strong = await createUser();
    await assignRole(strong.id, role.id);
    const token = await tokenWith(['users:delete']);

    expectError(await del(strong.id, token), 403, 'FORBIDDEN', ENVELOPE);
    expectSuccess(await del(strong.id));
    // Restoring is managing too: otherwise a users:delete holder could undo the revocation.
    expectError(await restore(strong.id, token), 403, 'FORBIDDEN', ENVELOPE);
  });

  it('refuses deleting the last user holding every permission', async () => {
    const { adminId } = await soleAdministrator();
    const actor = await createUser();
    const token = await tokenFor(actor.id, await allPermissionNames());
    expectError(
      await del(adminId, token),
      409,
      'CONFLICT',
      'This change would leave no active user holding every permission — grant another account the full permission set first',
    );
  });
});

describe('POST /users/:id/roles and DELETE /users/:id/roles/:roleId', () => {
  it('assigns a role once, invalidating the user’s tokens, then removes it', async () => {
    const role = await createRole(['posts:read']);
    const user = await createUser();
    const token = (await login(user.username)).body.data.accessToken;
    const assign = async () => api(`${BASE}/${user.id}/roles`, { method: 'POST', token: await adminToken(), body: { role_id: role.id } });

    const res = await assign();
    expectSuccess(res, 201);
    expect(res.body.message).toBe('Role assigned');
    expect(res.body.data.permissions).toEqual(['posts:read']);
    expectError(await api(`${BASE}/${user.id}`, { token }), 401, 'UNAUTHORIZED', 'Token has been invalidated');

    // A repeat changes nothing, so it leaves the new session alone.
    const fresh = (await login(user.username)).body.data.accessToken;
    expect((await assign()).body.data.user_roles).toHaveLength(1);
    expectError(await api(`${BASE}/${user.id}`, { token: fresh }), 403, 'FORBIDDEN');

    const removed = await api(`${BASE}/${user.id}/roles/${role.id}`, { method: 'DELETE', token: await adminToken() });
    expectSuccess(removed);
    expect(removed.body).toMatchObject({ message: 'Role removed', data: { user_roles: [], permissions: [] } });
    expectError(await api(`${BASE}/${user.id}`, { token: fresh }), 401, 'UNAUTHORIZED', 'Token has been invalidated');
    expectError(await api(`${BASE}/${user.id}/roles/${role.id}`, { method: 'DELETE', token: await adminToken() }), 404, 'NOT_FOUND', 'Role is not assigned to this user');
  });

  it('refuses granting or removing a role beyond the actor’s permissions', async () => {
    const role = await createRole(['roles:read']);
    const user = await createUser();
    const token = await tokenWith(['users:update']);

    expectError(
      await api(`${BASE}/${user.id}/roles`, { method: 'POST', token, body: { role_id: role.id } }),
      403,
      'FORBIDDEN',
      'You cannot assign a role that grants permissions beyond your own',
    );
    await assignRole(user.id, role.id);
    expectError(
      await api(`${BASE}/${user.id}/roles/${role.id}`, { method: 'DELETE', token }),
      403,
      'FORBIDDEN',
      'You cannot remove a role that grants permissions beyond your own',
    );
  });

  it('is 404 for a missing user or role and 400 for a bad role_id', async () => {
    const role = await createRole();
    const user = await createUser();
    const token = await adminToken();
    expectError(await api(`${BASE}/${MISSING}/roles`, { method: 'POST', token, body: { role_id: role.id } }), 404, 'NOT_FOUND', 'User not found');
    expectError(await api(`${BASE}/${user.id}/roles`, { method: 'POST', token, body: { role_id: MISSING } }), 404, 'NOT_FOUND', 'Role not found');
    const bad = await api(`${BASE}/${user.id}/roles`, { method: 'POST', token, body: { role_id: 'x' } });
    expectError(bad, 400, 'VALIDATION_FAILED');
    expect(bad.body.errors).toEqual(['role_id must be a UUID']);
  });

  it('refuses removing the last full-permission administrator’s role', async () => {
    const { adminId, superAdminRoleId } = await soleAdministrator();
    const actor = await createUser();
    const token = await tokenFor(actor.id, await allPermissionNames());
    expectError(
      await api(`${BASE}/${adminId}/roles/${superAdminRoleId}`, { method: 'DELETE', token }),
      409,
      'CONFLICT',
      'This change would leave no active user holding every permission — grant another account the full permission set first',
    );
    // Nothing changed: the admin still holds the role.
    expect(await withDb((q) => q('SELECT 1 FROM user_roles WHERE user_id = $1 AND role_id = $2', [adminId, superAdminRoleId]))).toHaveLength(1);
  });
});
