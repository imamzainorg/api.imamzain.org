// Nest sources: AuthService.cleanupStaleRefreshTokens, LoginThrottleService.cleanupStaleAttempts,
// AuditService.cleanupOldAuditLogs. Nest ran them at 03:15 / 03:20 / 03:30; here one 03:15 tick runs all three.
import type { PrismaClient } from '../generated/prisma/client';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Revoked refresh tokens stay this long as tombstones for reuse detection. */
const REVOKED_TOKEN_GRACE_DAYS = 30;
const AUDIT_LOG_RETENTION_DAYS = 365;

/** Each sweep is independent: one failing doesn't stop the others. */
export async function runRetention(db: PrismaClient, now = new Date()): Promise<void> {
  await sweep('refresh_tokens', () =>
    db.refresh_tokens.deleteMany({
      where: {
        OR: [
          { expires_at: { lt: now } },
          { revoked_at: { lt: new Date(now.getTime() - REVOKED_TOKEN_GRACE_DAYS * DAY_MS) } },
        ],
      },
    }),
  );
  await sweep('login_attempts', () =>
    db.login_attempts.deleteMany({
      where: { last_failed_at: { lt: new Date(now.getTime() - DAY_MS) } },
    }),
  );
  await sweep('audit_logs', () =>
    db.audit_logs.deleteMany({
      where: { created_at: { lt: new Date(now.getTime() - AUDIT_LOG_RETENTION_DAYS * DAY_MS) } },
    }),
  );
}

async function sweep(table: string, run: () => Promise<{ count: number }>): Promise<void> {
  try {
    const { count } = await run();
    if (count > 0) console.log(`Pruned ${count} stale ${table} row(s)`);
  } catch (err) {
    console.warn(`${table} retention sweep failed: ${err}`);
  }
}
