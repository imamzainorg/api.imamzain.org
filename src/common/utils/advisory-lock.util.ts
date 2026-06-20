import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Stable advisory-lock keys for the @nestjs/schedule crons. Every replica runs
 * every cron (ScheduleModule.forRoot loads once per process), so a job that
 * writes side effects (sends emails, writes audit rows) must be serialized
 * across instances or it double-processes. These keys gate each such job so
 * only one instance executes a given tick.
 *
 * Values are arbitrary but must be unique per job and stable across releases.
 */
export const ADVISORY_LOCK_KEYS = {
  NEWSLETTER_SENDER: 4821001,
  SCHEDULED_POST_PUBLISH: 4821002,
  YOUTUBE_SYNC: 4821003,
} as const;

/**
 * Run `fn` only if a Postgres transaction-scoped advisory lock for `key` can be
 * acquired; otherwise skip it (another instance currently holds the lock).
 *
 * `pg_try_advisory_xact_lock` is used so the lock auto-releases when the
 * surrounding transaction ends — it can never leak across Prisma's connection
 * pool the way a session-level lock could (the unlock might land on a different
 * pooled connection). The lock is held for the full duration of `fn`, so only
 * one instance runs the body at a time. `fn` itself keeps using the regular
 * client (`this.prisma`); it does not need to run on the lock's connection,
 * since the lock only provides mutual exclusion.
 *
 * The transaction timeout is raised well above Prisma's 5s default because a
 * gated job (e.g. an SMTP send batch) can legitimately run for seconds.
 *
 * @returns true if the work ran, false if another instance held the lock.
 */
export async function withAdvisoryLock(
  prisma: PrismaService,
  key: number,
  fn: () => Promise<void>,
  timeoutMs = 120_000,
): Promise<boolean> {
  return prisma.$transaction(
    async (tx) => {
      const rows = await tx.$queryRaw<Array<{ locked: boolean }>>(
        Prisma.sql`SELECT pg_try_advisory_xact_lock(${key}::bigint) AS locked`,
      );
      if (!rows[0]?.locked) return false;
      await fn();
      return true;
    },
    { timeout: timeoutMs, maxWait: 5_000 },
  );
}
