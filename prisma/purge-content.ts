/**
 * Purge every JSON-derived content table so `prisma:seed-content` can
 * rebuild them from a clean slate — used when the legacy JSON exports have
 * drifted far enough from the DB (missing records, category redesign) that
 * a targeted fix isn't worth it.
 *
 * SCOPE IS DELIBERATELY NARROW. Only tables whose entire content is
 * reproducible from `imamzain.org/src/data/*.json` are touched:
 *   posts, books, academic_papers, gallery_images, audios, speakers,
 *   static_pages, all four *_categories, media, media_variants
 *   (+ every translation/join table under them).
 *
 * NEVER touched, and actively guarded against: contest tables (real
 * entrant data), contact_submissions / proxy_visit_requests (real form
 * submissions), newsletter_*, users/roles/permissions, audit_logs,
 * site_settings, languages, youtube_* (live-synced, not JSON-derived),
 * daily_hadiths / stores / store_locations (DB already has MORE rows than
 * their JSON source — purging would be a regression, not a cleanup).
 *
 * The guard: every protected table's row count is snapshotted before the
 * deletes and re-checked in the same transaction right before commit. Any
 * change — even one row — throws, which rolls back the whole transaction.
 * This is a backstop against a coding mistake (wrong table in the delete
 * list, an unexpected CASCADE), not the primary safety net — the primary
 * safety net is the pg_dump you take before running this for real.
 *
 * Usage:
 *   npm run prisma:purge-content -- --dry     # report only, delete nothing (default)
 *   npm run prisma:purge-content -- --confirm # actually delete
 *
 * Deletes run in FK-dependency order (leaf/translation tables first,
 * `media` last, since every purge-scope table that references it is gone
 * by the time it's reached).
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const PROTECTED_TABLES = [
  'qutuf_sajjadiya_contest_answers',
  'qutuf_sajjadiya_contest_attempts',
  'qutuf_sajjadiya_contest_questions',
  'contact_submissions',
  'proxy_visit_requests',
  'newsletter_subscribers',
  'newsletter_campaigns',
  'users',
  'roles',
  'permissions',
  'user_roles',
  'role_permissions',
  'permission_translations',
  'role_translations',
  'audit_logs',
  'site_settings',
  'languages',
  'youtube_videos',
  'youtube_playlists',
  'youtube_playlist_items',
  'daily_hadiths',
  'daily_hadith_translations',
  'stores',
  'store_locations',
  'store_translations',
  'store_location_translations',
] as const;

// FK-dependency order: each table's dependents (translations, join rows)
// are deleted before it; `media` is last since posts/books/gallery_images/
// static_pages/*_translations all hold an FK into it.
const PURGE_ORDER = [
  'post_attachments',
  'post_translations',
  'book_translations',
  'academic_paper_translations',
  'gallery_image_translations',
  'audio_translations',
  'speaker_translations',
  'static_page_translations',
  'media_variants',
  'posts',
  'books',
  'academic_papers',
  'gallery_images',
  'audios',
  'speakers',
  'static_pages',
  'post_category_translations',
  'book_category_translations',
  'gallery_category_translations',
  'academic_paper_category_translations',
  'post_categories',
  'book_categories',
  'gallery_categories',
  'academic_paper_categories',
  'media',
] as const;

async function protectedCounts(tx: PrismaClient | Parameters<Parameters<PrismaClient['$transaction']>[0]>[0]): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  for (const table of PROTECTED_TABLES) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const count = await (tx[table as keyof typeof tx] as any).count();
    counts.set(table, count);
  }
  return counts;
}

async function main() {
  const dryRun = !process.argv.includes('--confirm');

  console.log('Purge scope (will be deleted' + (dryRun ? ' — DRY RUN, nothing actually happens' : '') + '):');
  const before = new Map<string, number>();
  for (const table of PURGE_ORDER) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const count = await (prisma[table as keyof typeof prisma] as any).count();
    before.set(table, count);
    console.log(`  ${table}: ${count} rows`);
  }

  console.log('\nProtected (must be unchanged after):');
  const protectedBefore = await protectedCounts(prisma);
  for (const [table, count] of protectedBefore) console.log(`  ${table}: ${count} rows`);

  if (dryRun) {
    console.log('\nDry run — nothing deleted. Re-run with --confirm to execute for real.');
    return;
  }

  console.log('\nDeleting…');
  // Default interactive-transaction timeout (5s) is nowhere near enough for
  // 25 sequential round-trips to a remote Supabase instance — raise it well
  // past the realistic worst case rather than risk a mid-purge timeout.
  await prisma.$transaction(
    async (tx) => {
      for (const table of PURGE_ORDER) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result = await (tx[table as keyof typeof tx] as any).deleteMany({});
        console.log(`  ${table}: deleted ${result.count}`);
      }

      const protectedAfter = await protectedCounts(tx as unknown as PrismaClient);
      for (const [table, countBefore] of protectedBefore) {
        const countAfter = protectedAfter.get(table);
        if (countAfter !== countBefore) {
          throw new Error(
            `GUARD TRIPPED: protected table "${table}" changed from ${countBefore} to ${countAfter} rows. ` +
              `Rolling back the entire purge — this should never happen and means something in the ` +
              `delete list or an FK cascade touched a table it shouldn't have.`,
          );
        }
      }
      console.log('\nGuard check passed — every protected table unchanged.');
    },
    { timeout: 120_000, maxWait: 10_000 },
  );

  console.log('\nPurge complete. Run `npm run prisma:seed-content` to rebuild.');
}

main()
  .catch((err) => {
    console.error('Purge failed:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
