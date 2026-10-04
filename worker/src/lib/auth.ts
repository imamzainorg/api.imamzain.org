import { verify } from 'hono/jwt';
import { createMiddleware } from 'hono/factory';
import type { Context } from 'hono';
import { forbidden, unauthorized } from './errors';
import { getDb } from './db';
import type { AppEnv } from './types';

/** The one algorithm access tokens are signed and verified with. */
export const JWT_ALGORITHM = 'HS256' as const;

/** ENFORCE_PASSWORD_CHANGE_AFTER_RESET: off unless exactly `true`. */
export function isPasswordChangeEnforced(env: { ENFORCE_PASSWORD_CHANGE_AFTER_RESET?: string }): boolean {
  return env.ENFORCE_PASSWORD_CHANGE_AFTER_RESET?.trim().toLowerCase() === 'true';
}

/** Routes a flagged account may still call: read its profile, change the password, log out, refresh. */
const PASSWORD_CHANGE_EXEMPT_PATH = /^(?:\/api\/v1)?\/auth\/(?:me|me\/password|logout|refresh)\/?$/i;

export function isPasswordChangeExemptPath(path: string | undefined): boolean {
  return PASSWORD_CHANGE_EXEMPT_PATH.test((path ?? '').split('?')[0]);
}

/** passport-jwt's fromAuthHeaderAsBearerToken: `<scheme> <token>` with scheme "bearer", any case. */
function bearerToken(header: string | undefined): string | null {
  const m = /(\S+)\s+(\S+)/.exec(header ?? '');
  return m && m[1].toLowerCase() === 'bearer' ? m[2] : null;
}

interface AccessTokenPayload {
  sub?: unknown;
  username?: string;
  permissions?: string[];
  token_version?: number;
}

/** JwtAuthGuard + JwtStrategy.validate: verify the token, look the user up once, set `c.var.user`. */
export const authenticate = createMiddleware<AppEnv>(async (c, next) => {
  const token = bearerToken(c.req.header('authorization'));
  if (!token) throw unauthorized();

  let payload: AccessTokenPayload;
  try {
    payload = (await verify(token, c.env.JWT_SECRET, JWT_ALGORITHM)) as AccessTokenPayload;
  } catch {
    throw unauthorized();
  }
  if (typeof payload.sub !== 'string') throw unauthorized();

  const row = await getDb(c).users.findUnique({
    where: { id: payload.sub },
    select: { id: true, username: true, token_version: true, deleted_at: true, must_change_password: true },
  });
  if (!row || row.deleted_at !== null) throw unauthorized();

  if (payload.token_version !== undefined && row.token_version !== payload.token_version) {
    throw unauthorized('Token has been invalidated');
  }

  // An admin set this password, so it is not a secret the user chose.
  if (row.must_change_password && isPasswordChangeEnforced(c.env) && !isPasswordChangeExemptPath(new URL(c.req.url).pathname)) {
    throw forbidden('You must change your password before continuing', { code: 'PASSWORD_CHANGE_REQUIRED' });
  }

  c.set('user', { id: row.id, username: row.username, permissions: payload.permissions ?? [] });
  await next();
});

/** `@Auth('posts:update', ...)`: authenticate, then require every listed permission. */
export function requirePermission(...permissions: string[]) {
  return createMiddleware<AppEnv>(async (c, next) => {
    await authenticate(c, async () => {});
    const have = c.get('user').permissions;
    if (!permissions.every((p) => have.includes(p))) {
      throw forbidden('You do not have permission to access this resource');
    }
    await next();
  });
}

export const currentUser = (c: Context<AppEnv>) => c.get('user');
