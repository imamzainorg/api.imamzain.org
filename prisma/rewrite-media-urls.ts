/**
 * One-off data step for the R2 standardization (2026-11): points every stored media URL at the new
 * flat UUID keys (`media/<uuid>.<ext>`, `audio/<uuid>.mp3`, `books/pdf/<uuid>.pdf`,
 * `academic-papers/pdf/<uuid>.pdf`) and creates the `media_variants` rows for the stored WebP variants
 * (`media/variants/<uuid>/w<width>.webp`).
 *
 * The new objects must already be in the bucket (uploaded next to the old ones, nothing deleted).
 * MAP_FILE is a JSON file generated from the standardized copy's reports/url-map.csv + manifest.csv:
 *   { map: { "<old key, percent-decoded, NFC>": { url, size, mime, width, height } },
 *     variants: { "<new master url>": [{ width, url, size }] } }
 *
 * Columns rewritten: media.url (+ file_size, mime_type, width, height), audios.audio_url,
 * audios.pdf_url, books.pdf_url, academic_papers.pdf_url, media_variants.url.
 * URLs with no entry in the map are left as they are and listed.
 *
 * One transaction. DRY_RUN=1 runs everything and rolls back.
 *
 * Usage:
 *   DRY_RUN=1 MAP_FILE=<path> npx ts-node -P tsconfig.base.json prisma/rewrite-media-urls.ts
 *   MAP_FILE=<path> npx ts-node -P tsconfig.base.json prisma/rewrite-media-urls.ts
 */

import { readFileSync, writeFileSync } from 'fs';
import { PrismaClient, Prisma } from '@prisma/client';

const DRY_RUN = process.env.DRY_RUN === '1';
const MAP_FILE = process.env.MAP_FILE;
if (!MAP_FILE) throw new Error('MAP_FILE is required');
const prisma = new PrismaClient({ datasourceUrl: process.env.DIRECT_URL ?? process.env.DATABASE_URL });

const CDN = 'https://cdn.imamzain.org/';
type Target = { url: string; size: number; mime: string; width: number | null; height: number | null };
type Variant = { width: number; url: string; size: number };
const data = JSON.parse(readFileSync(MAP_FILE, 'utf8')) as {
  map: Record<string, Target>;
  variants: Record<string, Variant[]>;
};

function norm(url: string): string {
  url = url.trim(); // some stored URLs carry a trailing space
  const path = url.startsWith(CDN) ? url.slice(CDN.length) : url;
  let decoded = path;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    /* keep raw */
  }
  return decoded.normalize('NFC');
}

const NEW_KEY =
  /^https:\/\/cdn\.imamzain\.org\/((media|audio|books\/pdf|academic-papers\/pdf)\/[0-9a-f-]{36}\.\w+|media\/variants\/[0-9a-f-]{36}\/w\d+\.webp)$/;
const COLUMNS = [
  ['academic_papers', 'pdf_url'],
  ['books', 'pdf_url'],
  ['audios', 'audio_url'],
  ['audios', 'pdf_url'],
  ['media', 'url'],
  ['media_variants', 'url'],
] as const;

class Rollback extends Error {}

async function main() {
  const report: string[] = [];
  const unmapped: Record<string, string[]> = {};
  try {
    await prisma.$transaction(
      async (tx) => {
        const plans: Record<string, { id: string; old: string; target: Target }[]> = {};
        for (const [table, col] of COLUMNS) {
          const rows = await tx.$queryRawUnsafe<{ id: string; url: string }[]>(
            `select id::text as id, "${col}" as url from "${table}" where "${col}" like 'https://cdn.imamzain.org/%'`,
          );
          const plan: { id: string; old: string; target: Target }[] = [];
          const miss: string[] = [];
          let already = 0;
          for (const r of rows) {
            if (NEW_KEY.test(r.url)) {
              already++;
              continue;
            }
            const t = data.map[norm(r.url)];
            if (t) plan.push({ id: r.id, old: r.url, target: t });
            else miss.push(r.url);
          }
          plans[`${table}.${col}`] = plan;
          if (miss.length) unmapped[`${table}.${col}`] = miss;
          report.push(`${table}.${col}: ${rows.length} on the CDN, ${plan.length} to rewrite, ${already} already new, ${miss.length} unmapped`);
        }

        // Unique columns: byte-identical files share one new key, but two rows can't share a URL. The first
        // row (by old URL) takes the new key; the others keep their old URL until they get their own copy.
        for (const k of ['media.url', 'audios.audio_url']) {
          const taken = new Set<string>();
          const kept: typeof plans[string] = [];
          for (const p of [...plans[k]].sort((a, b) => a.old.localeCompare(b.old))) {
            if (taken.has(p.target.url)) {
              (unmapped[`${k} (shares a file with another row, left on its old URL)`] ??= []).push(`${p.id} ${p.old}`);
              continue;
            }
            taken.add(p.target.url);
            kept.push(p);
          }
          if (kept.length !== plans[k].length) report.push(`${k}: ${plans[k].length - kept.length} rows left on their old URL (shared file)`);
          plans[k] = kept;
        }

        // Undo file: every value this run changes, written before anything is updated.
        if (!DRY_RUN) {
          const before = await tx.$queryRaw`select id::text, url, file_size::text, mime_type, width, height from media`;
          const variantsBefore = await tx.$queryRaw`select * from media_variants`;
          const file = `media-urls-before-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
          writeFileSync(file, JSON.stringify({ plans, media: before, media_variants: variantsBefore }, (_, v) => (typeof v === 'bigint' ? v.toString() : v)));
          report.push(`undo data written to ${file}`);
        }

        // Media: url + the new file's facts.
        const m = plans['media.url'];
        if (m.length) {
          await tx.$executeRaw`
            update media t set url = v.url, file_size = v.size, mime_type = v.mime, width = v.w, height = v.h
            from unnest(${m.map((p) => p.id)}::uuid[], ${m.map((p) => p.target.url)}::text[], ${m.map((p) => BigInt(p.target.size))}::bigint[],
                        ${m.map((p) => p.target.mime)}::text[], ${m.map((p) => p.target.width)}::int[], ${m.map((p) => p.target.height)}::int[])
                 as v(id, url, size, mime, w, h)
            where t.id = v.id`;
        }
        for (const [table, col] of COLUMNS) {
          if (table === 'media') continue;
          const p = plans[`${table}.${col}`];
          if (!p.length) continue;
          await tx.$executeRawUnsafe(
            `update "${table}" t set "${col}" = v.url from unnest($1::uuid[], $2::text[]) as v(id, url) where t.id = v.id`,
            p.map((x) => x.id),
            p.map((x) => x.target.url),
          );
        }

        // Variants: for every media row whose (new) url has stored variants, replace its variant rows.
        const media = await tx.$queryRaw<{ id: string; url: string }[]>`select id::text as id, url from media`;
        const vIds: string[] = [], vW: number[] = [], vUrl: string[] = [], vSize: bigint[] = [];
        const withVariants = new Set<string>();
        for (const row of media) {
          for (const v of data.variants[row.url] ?? []) {
            withVariants.add(row.id);
            vIds.push(row.id); vW.push(v.width); vUrl.push(v.url); vSize.push(BigInt(v.size));
          }
        }
        const deleted = withVariants.size
          ? await tx.$executeRaw`delete from media_variants where media_id = any(${[...withVariants]}::uuid[])`
          : 0;
        const inserted = vIds.length
          ? await tx.$executeRaw`
              insert into media_variants (media_id, width, url, file_size, format)
              select id, w, url, size, 'webp' from unnest(${vIds}::uuid[], ${vW}::int[], ${vUrl}::text[], ${vSize}::bigint[]) as v(id, w, url, size)`
          : 0;
        report.push(`media_variants: ${deleted} old rows replaced, ${inserted} inserted for ${withVariants.size} media`);

        // After: what is still on an old-style key.
        for (const [table, col] of COLUMNS) {
          const [{ n }] = await tx.$queryRawUnsafe<{ n: bigint }[]>(
            `select count(*) as n from "${table}" where "${col}" like 'https://cdn.imamzain.org/%' and "${col}" !~ $1`,
            NEW_KEY.source,
          );
          report.push(`after: ${table}.${col} still on old keys: ${n}`);
        }
        if (DRY_RUN) throw new Rollback();
      },
      { timeout: 300_000, maxWait: 30_000, isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    report.push('COMMITTED');
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
    report.push('DRY RUN: rolled back, nothing changed');
  } finally {
    await prisma.$disconnect();
  }
  console.log(report.join('\n'));
  for (const [k, urls] of Object.entries(unmapped)) {
    console.log(`\nunmapped ${k} (${urls.length}):`);
    for (const u of urls.slice(0, 60)) console.log('  ' + u);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
