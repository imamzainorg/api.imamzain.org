/**
 * Runtime switches for the auth module, read from the environment on every call
 * so they take effect without a restart-time cache and stay unit-testable.
 */

export const DEFAULT_REFRESH_REUSE_GRACE_SECONDS = 10;
export const MAX_REFRESH_REUSE_GRACE_SECONDS = 60;

/**
 * How long after a refresh token was rotated a second presentation of it is
 * still treated as a benign concurrent refresh (two tabs, a retried request)
 * rather than theft. Unset, blank or non-numeric: 10 s. Clamped to 0..60;
 * 0 turns the grace off, so any reuse of a rotated token revokes its family.
 */
export function resolveRefreshReuseGraceMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.REFRESH_REUSE_GRACE_SECONDS;
  if (raw === undefined || raw.trim() === '') return DEFAULT_REFRESH_REUSE_GRACE_SECONDS * 1000;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return DEFAULT_REFRESH_REUSE_GRACE_SECONDS * 1000;
  return Math.min(Math.max(Math.floor(parsed), 0), MAX_REFRESH_REUSE_GRACE_SECONDS) * 1000;
}

/**
 * Whether an account flagged `must_change_password` (an admin reset its
 * password) is locked out of everything but the change-password screen. OFF
 * unless the variable is exactly `true`: the CMS has to ship that screen first,
 * otherwise every reset user would be locked out with no way forward.
 */
export function isPasswordChangeEnforced(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.ENFORCE_PASSWORD_CHANGE_AFTER_RESET?.trim().toLowerCase() === 'true';
}

/**
 * Routes a flagged account may still call while enforcement is on: read its
 * profile, change the password (PATCH /auth/me/password), end its session, and
 * refresh. The prefix is optional so the check does not care how the API is mounted.
 */
const PASSWORD_CHANGE_EXEMPT_PATH = /^(?:\/api\/v1)?\/auth\/(?:me|me\/password|logout|refresh)\/?$/i;

export function isPasswordChangeExemptPath(originalUrl: string | undefined): boolean {
  const path = (originalUrl ?? '').split('?')[0];
  return PASSWORD_CHANGE_EXEMPT_PATH.test(path);
}
