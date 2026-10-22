// Nest source: PostsService.runScheduledPublish (src/posts/posts.service.ts).
import { AUDIT_ACTIONS } from '../lib/audit-actions';
import type { PrismaClient } from '../generated/prisma/client';

/** Flips posts whose `published_at` has arrived to `is_published`, one POST_PUBLISHED audit row each. */
export async function runScheduledPublish(db: PrismaClient, now = new Date()): Promise<number> {
  const due = await db.posts.findMany({
    where: { deleted_at: null, is_published: false, published_at: { not: null, lte: now } },
    select: { id: true },
  });
  if (due.length === 0) return 0;

  console.log(`Auto-publishing ${due.length} scheduled post(s)`);
  const ids = due.map((d) => d.id);
  await db.posts.updateMany({
    where: { id: { in: ids } },
    data: { is_published: true, updated_at: now },
  });
  await db.audit_logs.createMany({
    data: ids.map((id) => ({
      user_id: null,
      action: AUDIT_ACTIONS.POST_PUBLISHED,
      resource_type: 'post',
      resource_id: id,
      changes: { scheduled: true, by: 'cron' },
    })),
  });
  return ids.length;
}
