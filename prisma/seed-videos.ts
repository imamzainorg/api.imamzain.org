/**
 * One-off data step for the video editorial layer (migration 20261124100000_video_curation,
 * docs/YOUTUBE-REDESIGN.md section 9). Run once after the migration, before or after the first sync with
 * the new Worker: the sync only adds rows that are missing, and this script only changes what is still
 * at the sync's defaults (slug = YouTube id, no section).
 *
 *   - Every mirrored video gets a video_entries row, published. Its slug is the website's existing one
 *     (prisma/data/website-videos.json, a copy of the site's old src/data/youtube.json: 108 live URLs),
 *     otherwise YouTube's id.
 *   - The old Risalat al-Huquq uploads ("رسالة الحقوق - حق …") are hidden: the 20-part playlist replaced
 *     them (owner's decision 11).
 *   - Every mirrored playlist gets a video_series row with a readable slug and a section (SERIES below).
 *     Hidden: the live-relay playlist (decision 2) and the 2024 playlist of the old Risalat uploads.
 *
 * Live videos need no special case: the API never serves kind = 'live', whatever their entry says.
 *
 * One transaction. DRY_RUN=1 runs it and rolls back.
 *
 * Usage:
 *   DRY_RUN=1 npm run prisma:seed-videos
 *   npm run prisma:seed-videos
 */

import { PrismaClient, type video_section } from '@prisma/client';
import websiteGroups from './data/website-videos.json';

const DRY_RUN = process.env.DRY_RUN === '1';
const prisma = new PrismaClient({ datasourceUrl: process.env.DIRECT_URL ?? process.env.DATABASE_URL });

const OLD_RISALAT_TITLE = /^رسالة الحقوق - حق /;

type SeriesPlan = { slug: string; section: video_section | null; hidden?: true };

/** YouTube playlist id → readable slug and section. */
const SERIES: Record<string, SeriesPlan> = {
  PLi1h0SEPzOA65EMYg34YPWo9E1bid1AJL: { slug: 'sirat-zain-al-ibad', section: 'programmes' },
  PLi1h0SEPzOA66c0J17WcwnNGkFOMXWw4v: { slug: 'al-shahr-al-tahur', section: 'programmes' },
  PLi1h0SEPzOA7cwwfvAjCzZZxQ_YwSQdvb: { slug: 'khair-shahr', section: 'programmes' },
  PLi1h0SEPzOA6zlKPmTJCi5L3S82b7U9Ct: { slug: 'wa-yujazi-bil-jalil', section: 'programmes' },
  PLi1h0SEPzOA5hPNeAb36_pDCJw6k0YFLy: { slug: 'min-rahiq-al-sajjad', section: 'programmes' },
  'PLi1h0SEPzOA5RAJKBBaCwo8l8PIzf-IZL': { slug: 'mahattat-maa-dua-arafa', section: 'programmes' },
  'PLi1h0SEPzOA7efU2nTtrVi3-2z693pFLk': { slug: 'maa-al-ghadir', section: 'programmes' },
  PLi1h0SEPzOA79nt51XjkWQjcRr_8UMTsO: { slug: 'nafahat-tarbawiyya-wa-ijtimaiyya', section: 'programmes' },
  PLi1h0SEPzOA7Q9goeGnOktF4LOzJ7Mzg9: { slug: 'mafhum-al-manhaj-al-tarbawi', section: 'programmes' },
  'PLi1h0SEPzOA6fyyV-VfxQX2bshyD4AfpS': { slug: 'fi-rihab-al-ata-al-sajjadi', section: 'programmes' },
  PLRL38awrPbJ8: { slug: 'faid-al-tufuf', section: 'programmes' },

  PLce_GVMLUUXs: { slug: 'risalat-al-huquq', section: 'commentaries' },
  PLi1h0SEPzOA56vCK9FeWmRGJBlLkIIg4o: { slug: 'risalat-al-huquq-2024', section: 'commentaries', hidden: true },
  PLi1h0SEPzOA6BLjqM_O6Qxq__OSw5X8IX: { slug: 'lamahat-min-risalat-al-huquq', section: 'commentaries' },
  PLi1h0SEPzOA6oG27BNv9cTFOAXIYmJlar: { slug: 'dua-makarim-al-akhlaq', section: 'commentaries' },
  PLi1h0SEPzOA5H9jFEY4i2Qk3IhCF60ZcK: { slug: 'thalathun-darsan-min-dua-abi-hamza', section: 'commentaries' },
  'PLi1h0SEPzOA5KvV3-8aTK9f3vV68BsKIB': { slug: 'adiyat-al-ayyam', section: 'commentaries' },

  PLi1h0SEPzOA6grhNJ1HCsNVnk0wjvhqiU: { slug: 'al-ashara-al-sajjadiyya', section: 'majalis' },
  'PLi1h0SEPzOA5FgG-xJjr6ZT5oqP8RfD1X': { slug: 'majalis-shahr-muharram', section: 'majalis' },
  PLi1h0SEPzOA7qCKJ6DNLpxxdEVXgQXehF: { slug: 'majalis-aza', section: 'majalis' },
  PLi1h0SEPzOA7Sjbohn93uf7CcVWSVIvJ_: { slug: 'majalis-al-aza-1448', section: 'majalis' },
  PLi1h0SEPzOA60RoG6FYENYfU060cyCVMX: { slug: 'al-majlis-al-ramadani-1446', section: 'majalis' },

  PLi1h0SEPzOA4eJ7VLBem5p4OIwRxkrJgK: { slug: 'al-mutamar-al-ilmi-al-duwali-al-awwal', section: 'events' },
  'PLi1h0SEPzOA7_e_zG7YYf_-bYzr0v9LkK': { slug: 'al-multaqa-al-thani-al-baqi', section: 'events' },
  'PLi1h0SEPzOA6AnHe_HTGGMGvH-aoXd-T9': { slug: 'al-multaqa-al-tashawuri', section: 'events' },

  PLi1h0SEPzOA63HHfrcXc_XaC4qPtWxjCR: { slug: 'al-bath-al-mubashir', section: null, hidden: true },
};

/** YouTube id → the website's slug. One id is listed twice in the JSON under two slugs: the first wins. */
function websiteSlugs(): Map<string, string> {
  const slugs = new Map<string, string>();
  for (const group of websiteGroups as { videos: { url: string; slug: string }[] }[])
    for (const v of group.videos)
      if (/^[A-Za-z0-9_-]{11}$/.test(v.url) && !slugs.has(v.url)) slugs.set(v.url, v.slug);
  return slugs;
}

async function main() {
  const legacy = websiteSlugs();
  const counts = { entriesCreated: 0, slugsRestored: 0, hidden: 0, seriesCreated: 0, seriesUpdated: 0 };
  const missing: string[] = [];

  await prisma.$transaction(
    async (tx) => {
      const videos = await tx.youtube_videos.findMany({ select: { video_id: true, title: true } });
      const entries = new Map(
        (await tx.video_entries.findMany()).map((e) => [e.youtube_video_id, e]),
      );
      for (const v of videos) {
        const slug = legacy.get(v.video_id) ?? v.video_id;
        const status = OLD_RISALAT_TITLE.test(v.title) ? 'hidden' : 'published';
        if (status === 'hidden') counts.hidden++;
        const existing = entries.get(v.video_id);
        if (!existing) {
          await tx.video_entries.create({ data: { youtube_video_id: v.video_id, slug, status } });
          counts.entriesCreated++;
        } else if (existing.slug === v.video_id && slug !== v.video_id) {
          await tx.video_entries.update({
            where: { youtube_video_id: v.video_id },
            data: { slug, ...(status === 'hidden' ? { status } : {}), updated_at: new Date() },
          });
          counts.slugsRestored++;
        } else if (status === 'hidden' && existing.status !== 'hidden') {
          await tx.video_entries.update({ where: { youtube_video_id: v.video_id }, data: { status } });
        }
      }
      const mirrored = new Set(videos.map((v) => v.video_id));
      for (const id of legacy.keys()) if (!mirrored.has(id)) missing.push(id);

      const playlists = await tx.youtube_playlists.findMany({ select: { playlist_id: true, title: true } });
      const series = new Map(
        (await tx.video_series.findMany()).map((s) => [s.youtube_playlist_id, s]),
      );
      for (const p of playlists) {
        const plan = SERIES[p.playlist_id];
        if (!plan) console.warn(`  ! no plan for playlist ${p.playlist_id} (${p.title}): slug = its id`);
        const data = {
          slug: plan?.slug ?? p.playlist_id,
          section: plan?.section ?? null,
          is_hidden: plan?.hidden ?? false,
        };
        const existing = series.get(p.playlist_id);
        if (!existing) {
          await tx.video_series.create({ data: { youtube_playlist_id: p.playlist_id, ...data } });
          counts.seriesCreated++;
        } else if (existing.slug === p.playlist_id && existing.section === null && plan) {
          await tx.video_series.update({
            where: { youtube_playlist_id: p.playlist_id },
            data: { ...data, updated_at: new Date() },
          });
          counts.seriesUpdated++;
        }
      }

      console.log(counts);
      console.log(
        `  website videos not in the mirror (their URLs will 404 until a public playlist holds them): ${missing.length}`,
      );
      if (DRY_RUN) throw new Error('DRY_RUN');
    },
    { timeout: 120_000 },
  );
}

main()
  .catch((err) => {
    if (err instanceof Error && err.message === 'DRY_RUN') {
      console.log('Dry run: rolled back.');
      return;
    }
    console.error('seed-videos failed:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
