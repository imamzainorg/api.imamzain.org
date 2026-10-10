import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { adminToken, api, expectError, expectSuccess, ISO_DATE, withDb, workerOnly } from './support/http';
import { PASSWORD, assignRole, createRole, createUser, login, uid } from './support/rbac';

const AUTH = '/api/v1/auth';
const LOCKED = 'Too many failed login attempts for this username — try again later';

const claims = (token: string) => JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
const sha256 = (raw: string) => createHash('sha256').update(raw).digest('hex');
const refresh = (refresh_token: string) => api(`${AUTH}/refresh`, { method: 'POST', body: { refresh_token } });
const me = (token: string) => api(`${AUTH}/me`, { token });

/** Moves a token's rotation back in time, past the 10 s reuse grace, without waiting. */
const ageRotation = (raw: string, seconds: number) =>
  withDb((q) => q(`UPDATE refresh_tokens SET revoked_at = revoked_at - make_interval(secs => $2) WHERE token_hash = $1`, [sha256(raw), seconds]));

async function session(username: string, password = PASSWORD) {
  const res = await login(username, password);
  expectSuccess(res);
  return res.body.data as { accessToken: string; refresh_token: string };
}

describe('POST /auth/login', () => {
  it('signs in with a trimmed username and answers with tokens and the profile', async () => {
    const role = await createRole(['posts:read']);
    const user = await createUser();
    await assignRole(user.id, role.id);

    const res = await login(`  ${user.username} `);
    expectSuccess(res);
    expect(res.body.message).toBe('Login successful');
    expect(Object.keys(res.body.data)).toEqual(['accessToken', 'refresh_token', 'user']);
    expect(res.body.data.user).toEqual({ id: user.id, username: user.username, roles: [role.name], permissions: ['posts:read'], must_change_password: false });
    expect(res.body.data.refresh_token).toMatch(/^[0-9a-f]{80}$/);

    const token = claims(res.body.data.accessToken);
    expect(Object.keys(token)).toEqual(['sub', 'username', 'permissions', 'token_version', 'iat', 'exp']);
    expect(token).toMatchObject({ sub: user.id, username: user.username, permissions: ['posts:read'] });
    expect(token.exp - token.iat).toBe(24 * 3600);
    expectSuccess(await me(res.body.data.accessToken));
  });

  it('refuses a wrong password, a wrong letter case, an unknown or a deleted user alike', async () => {
    const user = await createUser();
    const gone = await createUser();
    expectSuccess(await api(`/api/v1/users/${gone.id}`, { method: 'DELETE', token: await adminToken() }));

    for (const [name, password] of [[user.username, 'wrong-password'], [user.username.toUpperCase(), PASSWORD], [uid('nobody'), PASSWORD], [gone.username, PASSWORD]]) {
      expectError(await login(name, password), 401, 'UNAUTHORIZED', 'Invalid credentials');
    }
  });

  it('locks a username after 5 failures, even for the right password, with Retry-After', async () => {
    const user = await createUser();
    for (let i = 0; i < 5; i++) expectError(await login(user.username, 'wrong-password'), 401, 'UNAUTHORIZED');

    const res = await login(user.username);
    expectError(res, 429, 'AUTH_LOGIN_LOCKED', LOCKED);
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(50);
    // The counter is per name, case-folded, and exists for unknown names too.
    expectError(await login(user.username.toUpperCase()), 429, 'AUTH_LOGIN_LOCKED');
  });

  it('counts unknown usernames the same way', async () => {
    const name = uid('ghost');
    for (let i = 0; i < 5; i++) expectError(await login(name, 'x'), 401, 'UNAUTHORIZED', 'Invalid credentials');
    expectError(await login(name, 'x'), 429, 'AUTH_LOGIN_LOCKED');
  });

  it('a successful login clears the failure count', async () => {
    const user = await createUser();
    for (let i = 0; i < 4; i++) await login(user.username, 'wrong-password');
    await session(user.username);
    for (let i = 0; i < 4; i++) expectError(await login(user.username, 'wrong-password'), 401, 'UNAUTHORIZED');
    await session(user.username);
  });

  // REHAUL-FINDINGS-2026-09 (auth.service.ts:166): Nest's check, compare and count are separate round trips.
  workerOnly('worker-only: a concurrent burst against one username gets exactly 5 guesses', async () => {
    const user = await createUser();
    const results = await Promise.all(Array.from({ length: 8 }, () => login(user.username, 'wrong-password')));
    expect(results.map((r) => r.status).sort()).toEqual([401, 401, 401, 401, 401, 429, 429, 429]);
  });

  it.each([
    ['a short username', { username: 'ab', password: 'x' }, ['username must be longer than or equal to 3 characters']],
    ['an empty password', { username: 'abc', password: '' }, ['password must be longer than or equal to 1 characters']],
    ['a 129-char password', { username: 'abc', password: 'x'.repeat(129) }, ['password must be shorter than or equal to 128 characters']],
    ['an unknown key', { username: 'abc', password: 'x', remember: true }, ['property remember should not exist']],
  ])('rejects %s', async (_name, body, errors) => {
    const res = await api(`${AUTH}/login`, { method: 'POST', body });
    expectError(res, 400, 'VALIDATION_FAILED', 'Validation failed');
    expect(res.body.errors).toEqual(errors);
  });
});

describe('POST /auth/refresh', () => {
  it('rotates: a new pair, and the old refresh token is spent', async () => {
    const { username } = await createUser();
    const first = await session(username);

    const res = await refresh(first.refresh_token);
    expectSuccess(res);
    expect(res.body.message).toBe('Tokens refreshed');
    expect(Object.keys(res.body.data)).toEqual(['accessToken', 'refresh_token']);
    expect(res.body.data.refresh_token).not.toBe(first.refresh_token);
    expectSuccess(await me(res.body.data.accessToken));
    expectSuccess(await refresh(res.body.data.refresh_token));
  });

  it('answers a second use inside the grace window with a sibling token (two tabs)', async () => {
    const { username } = await createUser();
    const { refresh_token } = await session(username);
    const tabA = await refresh(refresh_token);
    const tabB = await refresh(refresh_token);

    expectSuccess(tabA);
    expectSuccess(tabB);
    expect(tabB.body.data.refresh_token).not.toBe(tabA.body.data.refresh_token);
    expectSuccess(await refresh(tabB.body.data.refresh_token));
  });

  it('treats a replay after the grace window as theft: revokes that family only', async () => {
    const { username } = await createUser();
    const stolen = await session(username);
    const otherDevice = await session(username);
    const rotated = (await refresh(stolen.refresh_token)).body.data;
    await ageRotation(stolen.refresh_token, 11);

    expectError(await refresh(stolen.refresh_token), 401, 'AUTH_TOKEN_REUSED', 'Refresh token reuse detected');
    expectError(await refresh(rotated.refresh_token), 401, 'AUTH_REFRESH_INVALID', 'Invalid or expired refresh token');
    expectSuccess(await refresh(otherDevice.refresh_token));
    // No token_version bump: the access token stays valid until it expires (a documented Tier 2 trade-off).
    expectSuccess(await me(rotated.accessToken));
  });

  it('refuses unknown, expired and logged-out tokens without revoking anything else', async () => {
    const { username } = await createUser();
    const expired = await session(username);
    const loggedOut = await session(username);
    const kept = await session(username);
    await withDb((q) => q(`UPDATE refresh_tokens SET expires_at = now() - interval '1 minute' WHERE token_hash = $1`, [sha256(expired.refresh_token)]));
    expectSuccess(await api(`${AUTH}/logout`, { method: 'POST', token: loggedOut.accessToken, body: { refresh_token: loggedOut.refresh_token } }));

    for (const token of ['f'.repeat(80), expired.refresh_token, loggedOut.refresh_token]) {
      expectError(await refresh(token), 401, 'AUTH_REFRESH_INVALID', 'Invalid or expired refresh token');
    }
    expectSuccess(await refresh(kept.refresh_token));
  });

  it('a logout after a rotation ends the grace window too', async () => {
    const { username } = await createUser();
    const first = await session(username);
    const rotated = (await refresh(first.refresh_token)).body.data;
    expectSuccess(await api(`${AUTH}/logout`, { method: 'POST', token: rotated.accessToken, body: { refresh_token: rotated.refresh_token } }));

    expectError(await refresh(first.refresh_token), 401, 'AUTH_REFRESH_INVALID');
  });

  it('refuses a deleted user’s token as a disabled account', async () => {
    const user = await createUser();
    const { refresh_token } = await session(user.username);
    expectSuccess(await api(`/api/v1/users/${user.id}`, { method: 'DELETE', token: await adminToken() }));
    expectError(await refresh(refresh_token), 401, 'AUTH_ACCOUNT_DISABLED', 'Account is disabled');
  });

  it('rejects an over-long token', async () => {
    const res = await refresh('x'.repeat(513));
    expectError(res, 400, 'VALIDATION_FAILED');
    expect(res.body.errors).toEqual(['refresh_token must be shorter than or equal to 512 characters']);
  });
});

describe('POST /auth/logout', () => {
  it('with a refresh token ends that session only; the access token lives on', async () => {
    const { username } = await createUser();
    const a = await session(username);
    const b = await session(username);

    const res = await api(`${AUTH}/logout`, { method: 'POST', token: a.accessToken, body: { refresh_token: a.refresh_token } });
    expectSuccess(res);
    expect(res.body).toMatchObject({ message: 'Logged out successfully', data: null });
    expectError(await refresh(a.refresh_token), 401, 'AUTH_REFRESH_INVALID');
    expectSuccess(await refresh(b.refresh_token));
    expectSuccess(await me(a.accessToken));
  });

  it('without one ends every session and every access token', async () => {
    const { username } = await createUser();
    const a = await session(username);
    const b = await session(username);

    expectSuccess(await api(`${AUTH}/logout`, { method: 'POST', token: a.accessToken }));
    for (const s of [a, b]) {
      expectError(await refresh(s.refresh_token), 401, 'AUTH_REFRESH_INVALID');
      expectError(await me(s.accessToken), 401, 'UNAUTHORIZED', 'Token has been invalidated');
    }
  });

  it('is idempotent for an unknown token, and 401 without a session', async () => {
    const { username } = await createUser();
    const a = await session(username);
    expectSuccess(await api(`${AUTH}/logout`, { method: 'POST', token: a.accessToken, body: { refresh_token: 'unknown' } }));
    expectSuccess(await refresh(a.refresh_token));
    expectError(await api(`${AUTH}/logout`, { method: 'POST' }), 401, 'UNAUTHORIZED', 'Unauthorized');
  });
});

describe('GET /auth/me', () => {
  it('answers with the profile, flagged after an admin reset', async () => {
    const user = await createUser();
    const { accessToken } = await session(user.username);

    const res = await me(accessToken);
    expectSuccess(res);
    expect(res.body.message).toBe('Profile fetched');
    expect(res.body.data).toEqual({ id: user.id, username: user.username, created_at: expect.stringMatching(ISO_DATE), roles: [], permissions: [], must_change_password: false });

    await api(`/api/v1/users/${user.id}/reset-password`, { method: 'POST', token: await adminToken(), body: { new_password: 'temporary-pass' } });
    const flagged = await session(user.username, 'temporary-pass');
    expect((await me(flagged.accessToken)).body.data.must_change_password).toBe(true);
  });

  it('is 401 without or with a bad token', async () => {
    expectError(await api(`${AUTH}/me`), 401, 'UNAUTHORIZED', 'Unauthorized');
    expectError(await me('not.a.jwt'), 401, 'UNAUTHORIZED', 'Unauthorized');
  });
});

describe('PATCH /auth/me/password', () => {
  const change = (token: string, currentPassword: string, newPassword: string) =>
    api(`${AUTH}/me/password`, { method: 'PATCH', token, body: { currentPassword, newPassword } });

  it('changes the password, clears the reset flag and ends every session', async () => {
    const user = await createUser();
    await api(`/api/v1/users/${user.id}/reset-password`, { method: 'POST', token: await adminToken(), body: { new_password: 'temporary-pass' } });
    const s = await session(user.username, 'temporary-pass');

    const res = await change(s.accessToken, 'temporary-pass', 'my-own-password');
    expectSuccess(res);
    expect(res.body).toMatchObject({ message: 'Password changed successfully', data: null });
    expectError(await me(s.accessToken), 401, 'UNAUTHORIZED', 'Token has been invalidated');
    expectError(await refresh(s.refresh_token), 401, 'AUTH_REFRESH_INVALID');
    expectError(await login(user.username, 'temporary-pass'), 401, 'UNAUTHORIZED');
    expect((await login(user.username, 'my-own-password')).body.data.user.must_change_password).toBe(false);
  });

  it('refuses a wrong current password, and keeping the admin-set one', async () => {
    const user = await createUser();
    const { accessToken } = await session(user.username);
    expectError(await change(accessToken, 'wrong-password', 'new-password-1'), 401, 'UNAUTHORIZED', 'Current password is incorrect');

    await api(`/api/v1/users/${user.id}/reset-password`, { method: 'POST', token: await adminToken(), body: { new_password: 'temporary-pass' } });
    const flagged = await session(user.username, 'temporary-pass');
    expectError(
      await change(flagged.accessToken, 'temporary-pass', 'temporary-pass'),
      400,
      'PASSWORD_MUST_DIFFER',
      'Choose a new password that differs from the temporary one',
    );
  });

  it('rejects a short new password', async () => {
    const { username } = await createUser();
    const { accessToken } = await session(username);
    const res = await change(accessToken, PASSWORD, 'short');
    expectError(res, 400, 'VALIDATION_FAILED');
    expect(res.body.errors).toEqual(['newPassword must be longer than or equal to 10 characters']);
  });
});
