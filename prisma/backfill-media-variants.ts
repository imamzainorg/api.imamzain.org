/**
 * One-off backfill script: generate sharp WebP variants for every media row
 * that doesn't have them yet.
 *
 * The variant pipeline ships in commit f3a31eb (round-2 audit work). Any
 * media uploaded before that commit has no rows in `media_variants` and
 * will render at its original resolution on the public site. This script
 * walks the media table, calls the same generator the API uses on new
 * uploads, and inserts the resulting variant rows.
 *
 * Usage:
 *   npm run prisma:backfill-variants
 *
 * Behaviour:
 * - Skips rows that already have at least one variant. Re-running is safe.
 * - Concurrency: processes one media row at a time. The sharp resize +
 *   R2 upload is bandwidth-bound; running multiple in parallel doesn't
 *   help and risks SMTP-style rate-limit issues on R2.
 * - Failures per row are isolated and logged; the script keeps going so a
 *   single corrupt image doesn't block the rest.
 *
 * Requires:
 *   DATABASE_URL / DIRECT_URL and the full R2_* env group, same as the
 *   API server. Run from the project root so the .env loads correctly.
 */

import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { ImageVariantService } from '../src/media/image-variant.service';
import { R2Service } from '../src/storage/r2.service';
import { PrismaService } from '../src/prisma/prisma.service';

async function main() {
  const logger = new Logger('BackfillVariants');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });

  const prisma = app.get(PrismaService);
  const variants = app.get(ImageVariantService);
  const r2 = app.get(R2Service);

  try {
    // Pull every media row that has zero variants. This is cheap with the
    // existing FK index on media_variants.media_id.
    const targets = await prisma.$queryRaw<Array<{ id: string; url: string }>>`
      SELECT m.id::text AS id, m.url
      FROM media m
      LEFT JOIN media_variants mv ON mv.media_id = m.id
      WHERE mv.media_id IS NULL
        AND m.mime_type LIKE 'image/%'
      ORDER BY m.created_at DESC
    `;

    if (targets.length === 0) {
      logger.log('No media rows missing variants — nothing to do.');
      await app.close();
      return;
    }

    logger.log(`Backfilling variants for ${targets.length} media row(s)…`);

    let succeeded = 0;
    let failed = 0;

    for (let i = 0; i < targets.length; i++) {
      const { id, url } = targets[i];
      const key = r2.keyFromPublicUrl(url);

      try {
        const generated = await variants.generateForMedia(id, key);
        if (generated.length > 0) {
          succeeded++;
          logger.log(`  [${i + 1}/${targets.length}] ${id} — ${generated.length} variant(s)`);
        } else {
          failed++;
          logger.warn(`  [${i + 1}/${targets.length}] ${id} — no variants produced (corrupt or up-scale-only?)`);
        }
      } catch (err) {
        failed++;
        logger.warn(`  [${i + 1}/${targets.length}] ${id} — failed: ${err}`);
      }
    }

    logger.log(`Done. ${succeeded} succeeded, ${failed} failed.`);
  } finally {
    await app.close();
  }
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('Backfill failed:', err);
    process.exit(1);
  });
