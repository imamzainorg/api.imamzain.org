/**
 * Reconcile the R2 `audio/` bucket against the `audios` table.
 *
 * The AudioItemAnalyzed.json seed only covers the files in that export. The CDN
 * holds many more raw recordings. This script guarantees every audio object in
 * R2 has a corresponding DB row:
 *
 *   1. List every object under the `audio/` prefix (skipping the `audio/pdf/`
 *      companion sub-prefix and non-audio extensions).
 *   2. Build the set of keys already referenced by an `audios.audio_url`.
 *   3. For each R2 key with no row, create a DRAFT audio (is_published = false)
 *      with title + speaker parsed from the filename ("<title> - <speaker>.ext")
 *      and an `ar` translation. duration/size/peaks are left null — an editor (or
 *      a later analysis pass) fills them in. Speakers are deduped by Arabic name.
 *
 * Idempotent: a draft created here is matched by its key on the next run and
 * skipped. Nothing is published — an editor reviews drafts before they go live.
 *
 * Usage:
 *   npm run prisma:reconcile-audios            # create missing drafts
 *   npm run prisma:reconcile-audios -- --dry   # report only, write nothing
 *
 * Env: the standard R2_* group required by R2Service.
 */

import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import * as path from 'path';
import { AppModule } from '../src/app.module';
import { R2Service } from '../src/storage/r2.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { getOrCreateSpeaker } from './lib/seed-utils';

const AUDIO_EXTENSIONS = new Set(['mp3', 'm4a', 'mp4', 'aac', 'ogg', 'wav', 'flac', 'webm', '3gp', '3gpp']);

/** Parse "<title> - <speaker>.mp3" → { title, speaker }. Splits on the LAST " - ". */
function parseFilename(key: string): { title: string; speaker: string | null } {
  const base = decodeURIComponent(path.basename(key)).replace(/\.[^.]+$/, '').trim();
  const idx = base.lastIndexOf(' - ');
  if (idx === -1) return { title: base, speaker: null };
  const title = base.slice(0, idx).trim();
  const speaker = base.slice(idx + 3).trim();
  return { title: title || base, speaker: speaker || null };
}

async function main() {
  const logger = new Logger('ReconcileAudios');
  const dryRun = process.argv.includes('--dry');

  // Operator script — never run production cron ticks from this process.
  process.env.DISABLE_CRON = 'true';

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['log', 'warn', 'error'] });
  const prisma = app.get(PrismaService);
  const r2 = app.get(R2Service);

  const speakerCache = new Map<string, string>();

  try {
    const allKeys = await r2.listAudioKeys();
    // Standalone audio files only — drop the PDF companions and directory markers.
    const audioKeys = allKeys.filter((k) => {
      if (k.startsWith('audio/pdf/')) return false;
      const ext = k.split('.').pop()?.toLowerCase() ?? '';
      return AUDIO_EXTENSIONS.has(ext);
    });
    logger.log(`R2 has ${audioKeys.length} audio object(s) under audio/ (of ${allKeys.length} total).`);

    // Existing rows → normalise each audio_url back to its key for comparison.
    const rows = await prisma.audios.findMany({ select: { audio_url: true } });
    const existingKeys = new Set(rows.map((r) => r.audio_url).filter(Boolean).map((u) => r2.keyFromPublicUrl(u)));
    logger.log(`DB has ${existingKeys.size} audio_url(s) on record.`);

    const missing = audioKeys.filter((k) => !existingKeys.has(k));
    logger.log(`${missing.length} R2 file(s) have no DB row.`);

    if (dryRun) {
      for (const k of missing.slice(0, 50)) logger.log(`  [dry] would create draft for ${k}`);
      if (missing.length > 50) logger.log(`  [dry] …and ${missing.length - 50} more`);
      logger.log('Dry run — nothing written.');
      return;
    }

    let created = 0;
    for (const key of missing) {
      const { title, speaker } = parseFilename(key);
      const speakerId = await getOrCreateSpeaker(prisma, speakerCache, speaker);
      await prisma.audios.create({
        data: {
          speaker_id: speakerId,
          audio_url: r2.publicUrlForKey(key),
          is_published: false, // draft — editor reviews before publishing
          audio_translations: { create: { lang: 'ar', title, is_default: true } },
        },
      });
      created++;
    }

    logger.log(`✓ Created ${created} draft audio(s); ${speakerCache.size} speaker(s) touched.`);
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('❌ reconcile-audios failed:', err);
  process.exit(1);
});
