/**
 * Upload legacy local files for `media` rows whose URLs 404 in R2.
 *
 * The seeder writes `media` rows from JSON paths under the legacy site's
 * `public/` directory (e.g. `public/general/foo.jpg`). If those files were
 * never copied to R2, `prisma:hydrate-media` leaves the row at the
 * `file_size = 1` sentinel and logs an HTTP 404.
 *
 * This script closes that gap:
 *   1. Pull every `media` row still flagged with `file_size = 1`.
 *   2. For each, derive the R2 key from the public URL.
 *   3. If R2 already has the object, skip (the 404 may have been a CDN
 *      cache blip — verify via the S3 API before assuming missing).
 *   4. Otherwise look for the file at `<LEGACY_PUBLIC_DIR>/<key>` and
 *      upload it. ContentType is inferred from the extension.
 *
 * After running this, re-run `prisma:hydrate-media` to fill in the real
 * file_size + mime_type for the newly uploaded objects.
 *
 * Usage:
 *   npm run prisma:upload-missing-r2
 *
 * Env:
 *   LEGACY_PUBLIC_DIR — local directory whose layout mirrors R2 keys
 *                       (default: ../../imamzain.org/public)
 *   Plus the standard R2_* env group required by R2Service.
 */

import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { AppModule } from '../src/app.module';
import { R2Service } from '../src/storage/r2.service';
import { PrismaService } from '../src/prisma/prisma.service';

const LEGACY_PUBLIC_DIR =
  process.env.LEGACY_PUBLIC_DIR ?? path.join(__dirname, '../../imamzain.org/public');

const MIME_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  pdf: 'application/pdf',
};

function mimeForFile(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  return MIME_BY_EXT[ext] ?? 'application/octet-stream';
}

async function main() {
  const logger = new Logger('UploadMissingR2');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });

  const prisma = app.get(PrismaService);
  const r2 = app.get(R2Service);

  try {
    if (!fs.existsSync(LEGACY_PUBLIC_DIR)) {
      logger.error(`Legacy public dir does not exist: ${LEGACY_PUBLIC_DIR}`);
      process.exitCode = 1;
      return;
    }
    logger.log(`Legacy public dir: ${LEGACY_PUBLIC_DIR}`);

    const targets = await prisma.media.findMany({
      where: { file_size: BigInt(1) },
      select: { id: true, url: true, filename: true },
    });

    if (targets.length === 0) {
      logger.log('No un-hydrated media rows — nothing to do.');
      return;
    }

    logger.log(`Processing ${targets.length} un-hydrated media record(s)…`);

    let uploaded = 0;
    let alreadyInR2 = 0;
    let notFoundLocally = 0;
    let errored = 0;

    for (let i = 0; i < targets.length; i++) {
      const { url, filename } = targets[i];
      const key = r2.keyFromPublicUrl(url);

      try {
        if (await r2.objectExists(key)) {
          alreadyInR2++;
          continue;
        }

        // URL chars (e.g. spaces) may arrive percent-encoded in the DB.
        // The local FS holds the literal filename, so decode before lookup.
        const localRel = decodeURIComponent(key);
        const localPath = path.join(LEGACY_PUBLIC_DIR, localRel);

        if (!fs.existsSync(localPath)) {
          notFoundLocally++;
          logger.warn(`  ✗ no local file for ${key}`);
          continue;
        }

        const buffer = fs.readFileSync(localPath);
        const mime = mimeForFile(filename);
        await r2.putObjectBuffer(key, buffer, mime);
        uploaded++;
        logger.log(`  ✓ uploaded ${key} (${buffer.length} bytes)`);
      } catch (err) {
        errored++;
        logger.warn(`  ✗ ${key} — ${(err as Error).message}`);
      }
    }

    logger.log('');
    logger.log(
      `Done. ${uploaded} uploaded, ${alreadyInR2} already in R2, ${notFoundLocally} not found locally, ${errored} errored.`,
    );
    if (uploaded > 0) {
      logger.log('Next: run `npm run prisma:hydrate-media` to fill in file_size + mime_type for the new objects.');
    }
    if (notFoundLocally > 0 || errored > 0) {
      process.exitCode = 1;
    }
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Upload failed:', err);
  process.exit(1);
});
