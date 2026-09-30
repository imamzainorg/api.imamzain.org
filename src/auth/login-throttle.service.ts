import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import * as crypto from 'crypto';
import { cronsDisabled } from '../common/utils/cron.util';
import { PrismaService } from '../prisma/prisma.service';

/** Failures further apart than this start a fresh count. */
export const LOGIN_FAILURE_WINDOW_MS = 15 * 60_000;
/** Consecutive failures (inside the window) tolerated before the first lock. */
export const LOGIN_FAILURE_THRESHOLD = 5;
const LOGIN_LOCK_BASE_MS = 60_000;
const LOGIN_LOCK_MAX_MS = 15 * 60_000;

/**
 * Identity key for the per-username counter: SHA-256 of the trimmed,
 * lower-cased username. Hashed because people routinely type a password into
 * the username box — the attempted string must never be stored or logged.
 * Case-folded so `Admin` / `admin` share one counter even though the accounts
 * table is case-sensitive.
 */
export function loginThrottleKey(username: string): string {
  return crypto.createHash('sha256').update(username.trim().toLowerCase()).digest('hex');
}

/**
 * Lock length after the Nth consecutive failure: nothing below the threshold,
 * then 1, 2, 4, 8 minutes, capped at 15. Doubling keeps an honest typo streak
 * cheap while making a sustained guess run cost ~96 attempts a day at most.
 */
export function lockDurationMs(failedCount: number): number {
  if (failedCount < LOGIN_FAILURE_THRESHOLD) return 0;
  const doublings = Math.min(failedCount - LOGIN_FAILURE_THRESHOLD, 10);
  return Math.min(LOGIN_LOCK_BASE_MS * 2 ** doublings, LOGIN_LOCK_MAX_MS);
}

export interface LoginFailureState {
  failedCount: number;
  lockedUntil: Date | null;
}

/**
 * Per-username login back-off, independent of the per-IP throttle on the
 * route (which a distributed guesser sidesteps). State lives in Postgres so it
 * survives restarts and is shared by every instance without needing Redis.
 *
 * Counters are kept for ANY submitted username, existing or not — otherwise
 * "this name locks, that one never does" would be a username oracle.
 */
@Injectable()
export class LoginThrottleService {
  private readonly logger = new Logger(LoginThrottleService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Seconds left on an active lock, or 0 when the username may try again. */
  async secondsUntilUnlocked(key: string, now = new Date()): Promise<number> {
    const row = await this.prisma.login_attempts.findUnique({
      where: { username_key: key },
      select: { locked_until: true },
    });
    if (!row?.locked_until || row.locked_until <= now) return 0;
    return Math.ceil((row.locked_until.getTime() - now.getTime()) / 1000);
  }

  /**
   * Count one failed attempt and (past the threshold) start or extend the
   * lock. One atomic statement, so concurrent failures can't lose an
   * increment.
   *
   * The count restarts at 1 only after a full quiet window measured from the
   * LATER of the last failure and the end of the last lock. Measuring from the
   * last failure alone would let a 15-minute lock expire straight into a fresh
   * count (5 free guesses per cycle instead of 1).
   */
  async recordFailure(key: string, now = new Date()): Promise<LoginFailureState> {
    const windowStart = new Date(now.getTime() - LOGIN_FAILURE_WINDOW_MS);
    const rows = await this.prisma.$queryRaw<Array<{ failed_count: number }>>`
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
    await this.prisma.login_attempts.update({
      where: { username_key: key },
      data: { locked_until: lockedUntil },
    });
    return { failedCount, lockedUntil };
  }

  /** A successful login wipes the slate. */
  async clear(key: string): Promise<void> {
    await this.prisma.login_attempts.deleteMany({ where: { username_key: key } });
  }

  /** Daily sweep (03:20, between the token and audit sweeps) of idle counters. */
  @Cron('20 3 * * *')
  async cleanupStaleAttempts(): Promise<void> {
    if (cronsDisabled()) return;
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    try {
      const { count } = await this.prisma.login_attempts.deleteMany({
        where: { last_failed_at: { lt: cutoff } },
      });
      if (count > 0) this.logger.log(`Pruned ${count} stale login_attempts row(s)`);
    } catch (err) {
      this.logger.warn(`login_attempts sweep failed: ${err}`);
    }
  }
}
