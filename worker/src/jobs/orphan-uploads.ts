// Nest source: MediaService.cleanupOrphanUploads (src/media/media.service.ts).
import type { PrismaClient } from '../generated/prisma/client';
import { deleteObject } from '../lib/r2';
import type { AppBindings } from '../lib/types';

/** Deletes the R2 objects of image uploads whose presigned URL expired without a confirm. */
export async function cleanupOrphanUploads(
  db: PrismaClient,
  env: AppBindings,
  now = new Date(),
): Promise<number> {
  const expired = await db.pending_media_uploads.findMany({ where: { expires_at: { lt: now } } });
  if (expired.length === 0) return 0;
  console.log(`Found ${expired.length} expired pending upload(s)`);

  let cleaned = 0;
  for (const record of expired) {
    // The row is the only trace of the object: drop it only once the object is gone.
    try {
      await deleteObject(env, record.key);
    } catch (err) {
      console.warn(`Failed to delete R2 object ${record.key}: ${err}`);
      continue;
    }
    // deleteMany: a confirm may have removed the row meanwhile.
    const { count } = await db.pending_media_uploads.deleteMany({ where: { id: record.id } });
    if (count > 0) {
      cleaned++;
      console.log(`Cleaned up orphan upload ${record.key}`);
    }
  }
  return cleaned;
}
