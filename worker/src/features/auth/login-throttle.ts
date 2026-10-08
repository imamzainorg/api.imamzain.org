// Per-username login back-off in Postgres (src/auth/login-throttle.service.ts), independent of the
// per-IP route throttle that a distributed guesser sidesteps. Counters exist for any submitted name,
// existing or not, so locking is no username oracle.
import { createHash } from 'node:crypto';
import type { Prisma } from '../../generated/prisma/client';

type Tx = Prisma.TransactionClient;

/** Failures further apart than this start a fresh count. */
const LOGIN_FAILURE_WINDOW_MS = 15 * 60_000;
/** Consecutive failures (inside the window) tolerated before the first lock. */
const LOGIN_FAILURE_THRESHOLD = 5;
const LOGIN_LOCK_BASE_MS = 60_000;
const LOGIN_LOCK_MAX_MS = 15 * 60_000;

/**
 * SHA-256 of the trimmed, lower-cased username: people type passwords into the username box, so the
 * attempted string is never stored. Case-folded so `Admin` / `admin` share one counter.
 */
export const loginThrottleKey = (username: string): string => createHash('sha256').update(username.trim().toLowerCase()).digest('hex');

/** Nothing below the threshold, then 1, 2, 4, 8 minutes, capped at 15. */
export function lockDurationMs(failedCount: number): number {
  if (failedCount < LOGIN_FAILURE_THRESHOLD) return 0;
  const doublings = Math.min(failedCount - LOGIN_FAILURE_THRESHOLD, 10);
  return Math.min(LOGIN_LOCK_BASE_MS * 2 ** doublings, LOGIN_LOCK_MAX_MS);
}

export interface LoginFailureState {
  failedCount: number;
  lockedUntil: Date | null;
}

/** Seconds left on an active lock, or 0. */
export async function secondsUntilUnlocked(tx: Tx, key: string, now = new Date()): Promise<number> {
  const row = await tx.login_attempts.findUnique({ where: { username_key: key }, select: { locked_until: true } });
  if (!row?.locked_until || row.locked_until <= now) return 0;
  return Math.ceil((row.locked_until.getTime() - now.getTime()) / 1000);
}

/**
 * Count one failure and, past the threshold, start or extend the lock. The count restarts only after a
 * full quiet window measured from the later of the last failure and the end of the last lock;
 * otherwise a 15-minute lock would expire straight into 5 fresh guesses.
 */
export async function recordFailure(tx: Tx, key: string, now = new Date()): Promise<LoginFailureState> {
  const windowStart = new Date(now.getTime() - LOGIN_FAILURE_WINDOW_MS);
  const rows = await tx.$queryRaw<Array<{ failed_count: number }>>`
    INSERT INTO login_attempts (username_key, failed_count, first_failed_at, last_failed_at)
    VALUES (${key}, 1, ${now}::timestamptz, ${now}::timestamptz)
    ON CONFLICT (username_key) DO UPDATE SET
      failed_count = CASE
        WHEN GREATEST(login_attempts.last_failed_at, COALESCE(login_attempts.locked_until, login_attempts.last_failed_at)) < ${windowStart}::timestamptz THEN 1
        ELSE login_attempts.failed_count + 1
      END,
      first_failed_at = CASE
        WHEN GREATEST(login_attempts.last_failed_at, COALESCE(login_attempts.locked_until, login_attempts.last_failed_at)) < ${windowStart}::timestamptz THEN ${now}::timestamptz
        ELSE login_attempts.first_failed_at
      END,
      locked_until = CASE
        WHEN GREATEST(login_attempts.last_failed_at, COALESCE(login_attempts.locked_until, login_attempts.last_failed_at)) < ${windowStart}::timestamptz THEN NULL
        ELSE login_attempts.locked_until
      END,
      last_failed_at = ${now}::timestamptz
    RETURNING failed_count
  `;
  const failedCount = Number(rows[0]?.failed_count ?? 1);

  const lockMs = lockDurationMs(failedCount);
  if (lockMs === 0) return { failedCount, lockedUntil: null };

  const lockedUntil = new Date(now.getTime() + lockMs);
  await tx.login_attempts.update({ where: { username_key: key }, data: { locked_until: lockedUntil } });
  return { failedCount, lockedUntil };
}

/** A successful login wipes the slate. */
export async function clearFailures(tx: Tx, key: string): Promise<void> {
  await tx.login_attempts.deleteMany({ where: { username_key: key } });
}
