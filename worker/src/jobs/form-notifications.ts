// Nest source: FormNotificationsService.drainOutbox (src/forms/form-notifications.service.ts).
import type { PrismaClient } from '../generated/prisma/client';

const MAX_ROWS_PER_TICK = 200;
/** A submission older than this is no longer announced, so an outage never ends in one giant stale digest. */
const PENDING_MAX_AGE_MS = 48 * 60 * 60 * 1000;

export type OutboxResult = 'idle' | 'unconfigured';

/**
 * The Worker has no mail transport until group 4g (D1), so every tick takes Nest's "SMTP not configured"
 * path: pending rows are flagged failed (the dashboard's unsent counter) and stay pending, so they are
 * still announced once mail works, within the 48 h window. Group 4g ports the digest, the cool-down and
 * the recipient lookup from the Nest source above.
 */
export async function drainOutbox(db: PrismaClient, now = new Date()): Promise<OutboxResult> {
  const pendingWhere = {
    notified_at: null,
    deleted_at: null,
    submitted_at: { gte: new Date(now.getTime() - PENDING_MAX_AGE_MS) },
  };
  const [contacts, visits] = await Promise.all([
    db.contact_submissions.findMany({ where: pendingWhere, orderBy: [{ submitted_at: 'asc' }, { id: 'asc' }], take: MAX_ROWS_PER_TICK, select: { id: true } }),
    db.proxy_visit_requests.findMany({ where: pendingWhere, orderBy: [{ submitted_at: 'asc' }, { id: 'asc' }], take: MAX_ROWS_PER_TICK, select: { id: true } }),
  ]);
  if (contacts.length === 0 && visits.length === 0) return 'idle';

  await db.$transaction([
    db.contact_submissions.updateMany({ where: { id: { in: contacts.map((c) => c.id) }, notification_failed_at: null }, data: { notification_failed_at: now } }),
    db.proxy_visit_requests.updateMany({ where: { id: { in: visits.map((v) => v.id) }, notification_failed_at: null }, data: { notification_failed_at: now } }),
  ]);
  return 'unconfigured';
}
