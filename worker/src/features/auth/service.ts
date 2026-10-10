import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Context } from 'hono';
import { sign } from 'hono/jwt';
import type { Prisma } from '../../generated/prisma/client';
import { AUDIT_ACTIONS, auditSync } from '../../lib/audit';
import { JWT_ALGORITHM } from '../../lib/auth';
import { getDb, lockKey } from '../../lib/db';
import { badRequest, tooManyRequests, unauthorized } from '../../lib/errors';
import { hashPassword, verifyPassword } from '../../lib/password';
import type { AppBindings, AppEnv } from '../../lib/types';
import { clearFailures, loginThrottleKey, recordFailure, secondsUntilUnlocked } from './login-throttle';
import type { ChangePasswordInput, LoginInput } from './schemas';

type Ctx = Context<AppEnv>;
type Db = Prisma.TransactionClient;

const REFRESH_TOKEN_TTL_DAYS = 7;
const DEFAULT_REFRESH_REUSE_GRACE_SECONDS = 10;
const MAX_REFRESH_REUSE_GRACE_SECONDS = 60;

const refreshInvalid = () => unauthorized('Invalid or expired refresh token', { code: 'AUTH_REFRESH_INVALID' });
const accountDisabled = () => unauthorized('Account is disabled', { code: 'AUTH_ACCOUNT_DISABLED' });

/** This caller lost the conditional rotation race; never leaves the service. */
class RotationLostError extends Error {}

const USER_WITH_PERMISSIONS_INCLUDE = {
  user_roles: { include: { roles: { include: { role_permissions: { include: { permissions: true } } } } } },
} satisfies Prisma.usersInclude;

type UserWithPermissions = Prisma.usersGetPayload<{ include: typeof USER_WITH_PERMISSIONS_INCLUDE }>;
type StoredRefreshToken = Prisma.refresh_tokensGetPayload<{ include: { users: true } }>;

function flattenPermissions(user: UserWithPermissions): string[] {
  const names = new Set<string>();
  for (const ur of user.user_roles) for (const rp of ur.roles.role_permissions) names.add(rp.permissions.name);
  return Array.from(names);
}

const MS_UNITS: Record<string, number> = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000, y: 31_557_600_000 };

/**
 * JWT_EXPIRES_IN as jsonwebtoken reads a string: the `ms` package's format ("15m", "24h", "7 days"),
 * a bare number being milliseconds, floored to whole seconds.
 */
export function expiresInSeconds(value: string | undefined): number {
  const raw = value ?? '24h';
  const m = raw.length <= 100 ? /^(-?(?:\d+)?\.?\d+) *(milliseconds?|msecs?|ms|seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d|weeks?|w|years?|yrs?|y)?$/i.exec(raw) : null;
  if (!m) throw new Error(`JWT_EXPIRES_IN "${raw}" is not a valid timespan`);
  const unit = (m[2] ?? 'ms').toLowerCase();
  const key = unit.startsWith('ms') || unit.startsWith('milli') ? 'ms' : unit[0] === 'y' ? 'y' : unit[0];
  return Math.floor((parseFloat(m[1]) * MS_UNITS[key]) / 1000);
}

/** REFRESH_REUSE_GRACE_SECONDS: unset, blank or non-numeric is 10 s; clamped to 0..60 (0 = no grace). */
export function refreshReuseGraceMs(env: { REFRESH_REUSE_GRACE_SECONDS?: string }): number {
  const raw = env.REFRESH_REUSE_GRACE_SECONDS;
  if (raw === undefined || raw.trim() === '') return DEFAULT_REFRESH_REUSE_GRACE_SECONDS * 1000;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return DEFAULT_REFRESH_REUSE_GRACE_SECONDS * 1000;
  return Math.min(Math.max(Math.floor(parsed), 0), MAX_REFRESH_REUSE_GRACE_SECONDS) * 1000;
}

/** Same claims and order as Nest's JwtService.sign, so either side accepts the other's tokens. */
function signAccessToken(env: AppBindings, user: UserWithPermissions, permissions: string[]): Promise<string> {
  const iat = Math.floor(Date.now() / 1000);
  return sign(
    { sub: user.id, username: user.username, permissions, token_version: user.token_version, iat, exp: iat + expiresInSeconds(env.JWT_EXPIRES_IN) },
    env.JWT_SECRET,
    JWT_ALGORITHM,
  );
}

const hashToken = (raw: string) => createHash('sha256').update(raw).digest('hex');

/** Stores a new refresh token. Without `familyId` it starts a new family (a login). */
async function issueRefreshToken(db: Db, userId: string, opts: { familyId?: string; id?: string } = {}): Promise<string> {
  const raw = randomBytes(40).toString('hex');
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + REFRESH_TOKEN_TTL_DAYS);
  await db.refresh_tokens.create({
    data: { id: opts.id, user_id: userId, token_hash: hashToken(raw), expires_at: expiresAt, family_id: opts.familyId ?? randomUUID() },
  });
  return raw;
}

// Compared against when the username is unknown, so both failures cost one bcrypt compare: no timing oracle.
let dummyHash: { rounds: string | undefined; hash: Promise<string> } | undefined;
function getDummyHash(env: AppBindings): Promise<string> {
  if (!dummyHash || dummyHash.rounds !== env.BCRYPT_ROUNDS) dummyHash = { rounds: env.BCRYPT_ROUNDS, hash: hashPassword(randomBytes(24).toString('hex'), env) };
  return dummyHash.hash;
}

type LoginOutcome =
  | { kind: 'locked'; retryAfterSeconds: number }
  | { kind: 'failed'; user: UserWithPermissions | null; failedCount: number; lockedUntil: Date | null }
  | { kind: 'ok'; user: UserWithPermissions };

export async function login(c: Ctx, dto: LoginInput) {
  // Trimmed, then matched byte-for-byte: usernames are case-sensitive at login.
  const username = dto.username.trim();
  const key = loginThrottleKey(username);
  const path = '/api/v1/auth/login';
  const db = getDb(c);

  // One transaction per attempt, serialized per username key: the lock check, the compare and the
  // failure count can't interleave, so a concurrent burst gets exactly the allowed guesses. Audits
  // run after it: the request's single connection belongs to the transaction until it ends.
  const outcome = await db.$transaction(
    async (tx): Promise<LoginOutcome> => {
      await lockKey(tx, `login:${key}`);
      const retryAfterSeconds = await secondsUntilUnlocked(tx, key);
      if (retryAfterSeconds > 0) return { kind: 'locked', retryAfterSeconds };

      const user = await tx.users.findFirst({ where: { username, deleted_at: null }, include: USER_WITH_PERMISSIONS_INCLUDE });
      const match = await verifyPassword(dto.password, user?.password_hash ?? (await getDummyHash(c.env)));
      if (!user || !match) return { kind: 'failed', user, ...(await recordFailure(tx, key)) };

      await clearFailures(tx, key);
      return { kind: 'ok', user };
    },
    { maxWait: 10_000, timeout: 30_000 },
  );

  if (outcome.kind === 'locked') {
    await auditSync(c, {
      actorId: null,
      action: AUDIT_ACTIONS.USER_LOGIN_FAILED,
      resourceType: 'user',
      changes: { method: 'POST', path, reason: 'locked', retry_after_seconds: outcome.retryAfterSeconds },
    });
    throw tooManyRequests('Too many failed login attempts for this username — try again later', {
      code: 'AUTH_LOGIN_LOCKED',
      retryAfterSeconds: outcome.retryAfterSeconds,
    });
  }

  if (outcome.kind === 'failed') {
    // Never the attempted username (often a mistyped password); a known account is identified by id.
    await auditSync(c, {
      actorId: null,
      action: AUDIT_ACTIONS.USER_LOGIN_FAILED,
      resourceType: 'user',
      resourceId: outcome.user?.id ?? null,
      changes: {
        method: 'POST',
        path,
        reason: outcome.user ? 'bad_password' : 'unknown_username',
        failed_count: outcome.failedCount,
        locked_until: outcome.lockedUntil?.toISOString() ?? null,
      },
    });
    throw unauthorized('Invalid credentials');
  }

  const { user } = outcome;
  const permissions = flattenPermissions(user);
  const accessToken = await signAccessToken(c.env, user, permissions);
  const refreshToken = await issueRefreshToken(db, user.id);

  await auditSync(c, { actorId: user.id, action: AUDIT_ACTIONS.USER_LOGIN, resourceType: 'user', resourceId: user.id, changes: { method: 'POST', path } });

  return {
    message: 'Login successful',
    data: {
      accessToken,
      refresh_token: refreshToken,
      user: { id: user.id, username: user.username, roles: user.user_roles.map((ur) => ur.roles.name), permissions, must_change_password: user.must_change_password },
    },
  };
}

const findStoredRefreshToken = (db: Db, hash: string): Promise<StoredRefreshToken | null> =>
  db.refresh_tokens.findUnique({ where: { token_hash: hash }, include: { users: true } });

/** A fresh access token plus a refresh token in `familyId`, on the caller's client (rotation's transaction). */
async function mintSession(c: Ctx, db: Db, userId: string, familyId: string, refreshTokenId?: string) {
  const user = await db.users.findFirst({ where: { id: userId, deleted_at: null }, include: USER_WITH_PERMISSIONS_INCLUDE });
  if (!user) throw accountDisabled();
  const accessToken = await signAccessToken(c.env, user, flattenPermissions(user));
  const refreshToken = await issueRefreshToken(db, user.id, { familyId, id: refreshTokenId });
  return { accessToken, refreshToken };
}

const refreshResponse = (session: { accessToken: string; refreshToken: string }) => ({
  message: 'Tokens refreshed',
  data: { accessToken: session.accessToken, refresh_token: session.refreshToken },
});

export async function refresh(c: Ctx, rawToken: string) {
  const db = getDb(c);
  const hash = hashToken(rawToken);

  // Read outside any rotation transaction, so the reuse revocation below can commit before the throw.
  const stored = await findStoredRefreshToken(db, hash);
  if (!stored || stored.expires_at < new Date()) throw refreshInvalid();
  if (stored.revoked_at !== null) return refreshRevokedToken(c, stored);
  if (stored.users.deleted_at !== null) throw accountDisabled();

  try {
    return await rotateRefreshToken(c, stored);
  } catch (err) {
    if (!(err instanceof RotationLostError)) throw err;
  }

  // Rotated (or logged out) between the read and the conditional update: answer as a request arriving
  // a moment later would be answered, so inside the grace window it is a benign second refresh.
  const current = await findStoredRefreshToken(db, hash);
  if (!current || current.revoked_at === null) throw unauthorized('Refresh token already rotated', { code: 'AUTH_REFRESH_ALREADY_ROTATED' });
  return refreshRevokedToken(c, current);
}

/** The conditional updateMany lets exactly one concurrent caller win; a loser's transaction has written nothing. */
async function rotateRefreshToken(c: Ctx, stored: StoredRefreshToken) {
  const successorId = randomUUID();
  const session = await getDb(c).$transaction(async (tx) => {
    const revoked = await tx.refresh_tokens.updateMany({
      where: { id: stored.id, revoked_at: null },
      data: { revoked_at: new Date(), replaced_by_id: successorId },
    });
    if (revoked.count !== 1) throw new RotationLostError();
    return mintSession(c, tx, stored.user_id, stored.family_id, successorId);
  });
  return refreshResponse(session);
}

/**
 * A revoked token was presented:
 * - no successor: logout, logout-all, a password change or a family revocation ended it. Dead, but no theft.
 * - rotated within the grace window: a benign concurrent refresh; a sibling in the same family.
 * - rotated longer ago: a replay of a token the client moved past. Revoke that family only.
 */
async function refreshRevokedToken(c: Ctx, stored: StoredRefreshToken) {
  if (stored.replaced_by_id === null || stored.revoked_at === null) throw refreshInvalid();

  const graceMs = refreshReuseGraceMs(c.env);
  const rotatedAgoMs = Date.now() - stored.revoked_at.getTime();
  if (graceMs > 0 && rotatedAgoMs < graceMs) return refreshWithinGrace(c, stored);

  // Committed on its own before the throw: inside a transaction the throw would roll it back.
  const { count } = await getDb(c).refresh_tokens.updateMany({
    where: { user_id: stored.user_id, family_id: stored.family_id, revoked_at: null },
    data: { revoked_at: new Date() },
  });
  await auditSync(c, {
    actorId: stored.user_id,
    action: AUDIT_ACTIONS.REFRESH_TOKEN_REUSE_DETECTED,
    resourceType: 'user',
    resourceId: stored.user_id,
    changes: {
      method: 'POST',
      path: '/api/v1/auth/refresh',
      family_id: stored.family_id,
      revoked_tokens: count,
      rotated_seconds_ago: Math.floor(rotatedAgoMs / 1000),
    },
  });
  console.warn(`Refresh-token reuse detected for user ${stored.user_id}; session family ${stored.family_id} revoked (${count} token(s))`);
  throw unauthorized('Refresh token reuse detected', { code: 'AUTH_TOKEN_REUSED' });
}

async function refreshWithinGrace(c: Ctx, stored: StoredRefreshToken) {
  if (stored.users.deleted_at !== null) throw accountDisabled();
  const db = getDb(c);
  // Only while the session lives: a logout after the rotation ended the family for good.
  const live = await db.refresh_tokens.count({ where: { family_id: stored.family_id, revoked_at: null, expires_at: { gt: new Date() } } });
  if (live === 0) throw refreshInvalid();
  return refreshResponse(await mintSession(c, db, stored.user_id, stored.family_id));
}

export async function logout(c: Ctx, userId: string, rawRefreshToken: string | null | undefined) {
  const db = getDb(c);
  const changes = (revoked_tokens: number) => ({ method: 'POST', path: '/api/v1/auth/logout', revoked_tokens });

  if (rawRefreshToken) {
    // A session is a family: end all of it, so a grace-window sibling can't outlive the logout.
    // Unknown or foreign tokens revoke nothing.
    const token = await db.refresh_tokens.findFirst({ where: { user_id: userId, token_hash: hashToken(rawRefreshToken) }, select: { family_id: true } });
    const revoked = token
      ? (await db.refresh_tokens.updateMany({ where: { user_id: userId, family_id: token.family_id, revoked_at: null }, data: { revoked_at: new Date() } })).count
      : 0;
    await auditSync(c, { actorId: userId, action: AUDIT_ACTIONS.USER_LOGOUT, resourceType: 'user', resourceId: userId, changes: changes(revoked) });
  } else {
    // Everywhere: refresh tokens, and every access token through token_version.
    const [revoked] = await db.$transaction([
      db.refresh_tokens.updateMany({ where: { user_id: userId, revoked_at: null }, data: { revoked_at: new Date() } }),
      db.users.update({ where: { id: userId }, data: { token_version: { increment: 1 } } }),
    ]);
    await auditSync(c, { actorId: userId, action: AUDIT_ACTIONS.USER_LOGOUT_ALL, resourceType: 'user', resourceId: userId, changes: changes(revoked.count) });
  }

  return { message: 'Logged out successfully', data: null };
}

export async function getMe(c: Ctx, userId: string) {
  const user = await getDb(c).users.findFirst({ where: { id: userId, deleted_at: null }, include: USER_WITH_PERMISSIONS_INCLUDE });
  if (!user) throw unauthorized();
  return {
    message: 'Profile fetched',
    data: {
      id: user.id,
      username: user.username,
      created_at: user.created_at,
      roles: user.user_roles.map((ur) => ur.roles.name),
      permissions: flattenPermissions(user),
      must_change_password: user.must_change_password,
    },
  };
}

export async function changePassword(c: Ctx, userId: string, dto: ChangePasswordInput) {
  const db = getDb(c);
  const user = await db.users.findFirst({ where: { id: userId, deleted_at: null } });
  if (!user) throw unauthorized();

  if (!(await verifyPassword(dto.currentPassword, user.password_hash))) throw unauthorized('Current password is incorrect');

  // "Changing" an admin-set password to itself would clear the flag and keep the admin's password.
  if (user.must_change_password && dto.newPassword === dto.currentPassword) {
    throw badRequest('Choose a new password that differs from the temporary one', { code: 'PASSWORD_MUST_DIFFER' });
  }

  const newHash = await hashPassword(dto.newPassword, c.env);
  await db.$transaction(async (tx) => {
    await tx.users.update({
      where: { id: userId },
      data: { password_hash: newHash, updated_at: new Date(), token_version: { increment: 1 }, must_change_password: false },
    });
    await tx.refresh_tokens.updateMany({ where: { user_id: userId, revoked_at: null }, data: { revoked_at: new Date() } });
  });

  await auditSync(c, { actorId: userId, action: AUDIT_ACTIONS.PASSWORD_CHANGED, resourceType: 'user', resourceId: userId, changes: { method: 'PATCH', path: '/api/v1/auth/me/password' } });

  return { message: 'Password changed successfully', data: null };
}
