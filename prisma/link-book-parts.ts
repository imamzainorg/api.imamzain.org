/**
 * One-off data migration for the already-seeded `books` table: retrofits the
 * parent/part series structure and the `is_publication` flag onto rows that
 * were seeded before migration 20260908120000_book_parts_and_publication_flag
 * existed. `seedBooks()` in seed-content.ts does this natively for a FRESH
 * database — this script brings an already-populated one (prod) up to the
 * same shape without wiping or re-seeding anything.
 *
 * What it does, against the legacy JSON at $SEED_DATA_DIR/books.json (or the
 * default `../imamzain.org/src/data`):
 *
 *   1. Joins every DB book to its source JSON row via pdf_url == source.pdf
 *      (falling back to media.url == source.image, then exact title match).
 *      A DB row that already has children (a series parent from a previous
 *      run of this script, or from a fresh seedBooks()) is excluded from the
 *      join entirely — it doesn't correspond to any single source row, and
 *      joining it anyway is exactly what caused this script's first version
 *      to mis-resolve a parent back onto its own first part's source row (via
 *      the shared cover image) and then try to set the parent's parent_id to
 *      itself. See "Known-parent exclusion" below.
 *   2. For every source `series` group with >= 2 entries: creates ONE parent
 *      book (title = series name, category/cover/author/publisher copied
 *      from part 1) if one doesn't already exist, links every part's
 *      parent_id to it, and normalizes each part's title to the series name
 *      (part_number — not embedded "ج1"/"ج2" text — is the durable way to
 *      tell parts apart going forward).
 *   3. Sets is_publication = true on every joined book whose source
 *      `category` array contains "الإصدارات" anywhere (not just first).
 *
 * Idempotent: re-running finds the parents/links already in place and does
 * nothing further. Any book that can't be joined to a source row is reported
 * and left untouched — never guessed at. The join maps (pdf/image/title) also
 * refuse to build on a duplicate key — see "Loud on ambiguity" below.
 *
 * Known-parent exclusion: a series parent is identified structurally (it has
 * at least one book pointing parent_id at it), not by any source-derived
 * field, because a parent legitimately shares its cover image with its own
 * first part (and has no pdf_url, no unique title of its own vs. that part
 * pre-normalization) — none of those are safe "is this a leaf row" signals
 * once a series exists.
 *
 * Loud on ambiguity: pdf_url and image URLs are unique across the current
 * legacy export, so the primary/first fallback join keys are unambiguous
 * today — but title is NOT (several series share a title across their own
 * parts, by design — grouping, not throwing, on a duplicate title is
 * therefore normal). If a future edit to books.json (or a CDN/media repoint
 * that changes pdf_url/media.url away from what's in the JSON — see
 * media-cdn-repoint.md) ever makes a key this script actually NEEDS to
 * resolve a specific DB row ambiguous, it throws right there rather than
 * silently picking one candidate and mis-joining production data.
 *
 * Usage:
 *   npm run prisma:link-book-parts            # apply
 *   npm run prisma:link-book-parts -- --dry    # report only, write nothing
 */

import { PrismaClient } from '@prisma/client';
import { assertDataDir, loadJson, normalizeUrl } from './lib/seed-utils';
import type { BookJson } from './lib/seed-utils';

const prisma = new PrismaClient();

function isPublicationCategory(rawCats: string[]): boolean {
  return rawCats.some((c) => c.trim() === 'الإصدارات');
}

/**
 * Group source rows by a join key (title legitimately repeats across a
 * series' own parts — e.g. every "سيرة المعصومين" part shares that exact
 * title — so building this eagerly must NOT throw on a duplicate; only
 * *resolving* an ambiguous key for a specific unmatched DB row should, via
 * resolveUniqueMatch below).
 */
function groupByKey(rows: BookJson[], keyOf: (row: BookJson) => string | null | undefined): Map<string, BookJson[]> {
  const map = new Map<string, BookJson[]>();
  for (const row of rows) {
    const key = keyOf(row);
    if (!key) continue;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(row);
  }
  return map;
}

/** Look up a join key; throw loudly if it's ambiguous (>1 source row shares it) instead of silently picking one. */
function resolveUniqueMatch(index: Map<string, BookJson[]>, key: string, label: string): BookJson | undefined {
  const candidates = index.get(key);
  if (!candidates || candidates.length === 0) return undefined;
  if (candidates.length > 1) {
    throw new Error(
      `Ambiguous ${label} join key "${key}" — source rows id=${candidates.map((c) => c.id).join(', ')} all match it. ` +
        `Resolve the duplicate in books.json before re-running; guessing which one a DB row belongs to risks mis-joining production data.`,
    );
  }
  return candidates[0];
}

async function main() {
  const dryRun = process.argv.includes('--dry');
  assertDataDir();

  const source = loadJson<BookJson[]>('books.json');

  // A "series" is a group of >= 2 JSON rows sharing the same `series`
  // string. Computed up front (pure function of the source JSON, no DB
  // dependency) because it's needed below to recognize a series parent that
  // survived a previous partial run.
  const seriesGroups = new Map<string, BookJson[]>();
  for (const s of source) {
    const key = s.series?.trim();
    if (!key) continue;
    if (!seriesGroups.has(key)) seriesGroups.set(key, []);
    seriesGroups.get(key)!.push(s);
  }
  const seriesNames = new Set([...seriesGroups.entries()].filter(([, g]) => g.length >= 2).map(([name]) => name));

  const allBooks = await prisma.books.findMany({
    where: { deleted_at: null },
    select: {
      id: true,
      pdf_url: true,
      is_publication: true,
      media: { select: { url: true } },
      book_translations: { where: { lang: 'ar' }, select: { title: true } },
      _count: { select: { parts_rel: true } },
    },
  });

  // A series parent must be excluded from source-joining entirely — it
  // doesn't correspond to any single source row, and joining it anyway
  // (via its shared cover image with its own first part) is what caused
  // this script's first version to try to set a parent's parent_id to
  // itself. A row with children is definitely a parent. But a parent that
  // was created and then crashed before any of its children got linked
  // (exactly the state a partial failure of THIS script leaves behind) has
  // ZERO children at that point — "has children" alone isn't enough, so a
  // row with no pdf_url whose title exactly matches a known series name is
  // also treated as a parent, whether or not it has children yet. Verified
  // against the current source data: no non-series book's own title, and no
  // pdf-less row's title, collides with a series name.
  const isKnownParent = (b: (typeof allBooks)[number]) =>
    b._count.parts_rel > 0 || (!b.pdf_url && seriesNames.has(b.book_translations[0]?.title?.trim() ?? ''));
  const dbBooks = allBooks.filter((b) => !isKnownParent(b));
  const knownParents = allBooks.filter(isKnownParent);
  if (knownParents.length) {
    console.log(`${knownParents.length} existing series parent(s) detected — excluded from source joining.`);
  }

  // Join DB -> source row. pdf_url is a near-verbatim copy of source.pdf at
  // seed time (normalizeUrl is the identity function for the already-https
  // URLs this dataset uses), so it's the primary key; media.url == source
  // .image and an exact Arabic-title match are fallbacks for the few rows
  // with no pdf_url. Both pdf_url and image are confirmed unique across the
  // current export, but title legitimately repeats within a series — see
  // resolveUniqueMatch, which throws rather than guesses if a fallback key
  // is ever actually needed and turns out ambiguous.
  const byPdf = groupByKey(source, (s) => (s.pdf?.trim() ? normalizeUrl(s.pdf) : null));
  const byImage = groupByKey(source, (s) => (s.image?.trim() ? normalizeUrl(s.image) : null));
  const byTitle = groupByKey(source, (s) => s.title?.trim() || null);

  const joinFailures: string[] = [];
  const joined = new Map<string, BookJson>(); // db book id -> source row
  for (const b of dbBooks) {
    const match =
      (b.pdf_url && resolveUniqueMatch(byPdf, b.pdf_url, 'pdf_url')) ||
      (b.media.url && resolveUniqueMatch(byImage, b.media.url, 'image')) ||
      (b.book_translations[0]?.title && resolveUniqueMatch(byTitle, b.book_translations[0].title.trim(), 'title'));
    if (match) joined.set(b.id, match);
    else joinFailures.push(`${b.id} (title: ${b.book_translations[0]?.title ?? '?'})`);
  }

  console.log(`DB books: ${dbBooks.length} leaf row(s) (+ ${knownParents.length} known parent(s)). Source rows: ${source.length}. Joined: ${joined.size}.`);
  if (joinFailures.length) {
    console.log(`⚠ ${joinFailures.length} DB book(s) could not be joined to a source row — left untouched:`);
    for (const f of joinFailures) console.log(`   - ${f}`);
  }

  // ── Publication flag ──────────────────────────────────────────────────────
  // Only ever applied to joined leaf rows — a known parent's is_publication
  // was set correctly at creation time and is never re-derived here (there
  // is no single source row whose category would even mean anything for it).
  let publicationChanges = 0;
  for (const b of dbBooks) {
    const src = joined.get(b.id);
    if (!src) continue;
    const rawCats = Array.isArray(src.category) ? src.category : src.category ? [src.category] : [];
    const shouldBe = isPublicationCategory(rawCats);
    if (shouldBe !== b.is_publication) {
      publicationChanges++;
      if (!dryRun) await prisma.books.update({ where: { id: b.id }, data: { is_publication: shouldBe } });
    }
  }
  console.log(`is_publication: ${publicationChanges} book(s) ${dryRun ? 'would be' : 'were'} updated.`);

  // ── Series parent/part linking ───────────────────────────────────────────
  // (seriesGroups was already computed above, before the DB query.)

  // Reverse index: source row id -> DB book id, needed to walk from a series
  // group's JSON rows back to the DB rows we need to update. Built only from
  // `joined`, which never contains a known parent, so this can't collide.
  const dbIdBySourceId = new Map<number, string>();
  for (const [dbId, src] of joined) dbIdBySourceId.set(src.id, dbId);

  let parentsCreated = 0;
  let parentsAlreadyExisted = 0;
  let partsLinked = 0;
  let partsAlreadyLinked = 0;
  const skippedGroups: string[] = [];

  for (const [seriesName, group] of seriesGroups) {
    if (group.length < 2) continue; // not a real series — e.g. "ديمومة سجادية" has only 1 surviving part

    const dbRows = group
      .map((g) => ({ src: g, dbId: dbIdBySourceId.get(g.id) }))
      .filter((r): r is { src: BookJson; dbId: string } => Boolean(r.dbId));

    if (dbRows.length !== group.length) {
      skippedGroups.push(`${seriesName} (${dbRows.length}/${group.length} parts joined — skipped, resolve join failures first)`);
      continue;
    }

    const first = [...dbRows].sort((a, b) => (a.src.partNumber ?? 0) - (b.src.partNumber ?? 0))[0]!;
    const rawCats = Array.isArray(first.src.category) ? first.src.category : first.src.category ? [first.src.category] : [];
    const primaryCat = rawCats[0]?.trim();
    if (!primaryCat) {
      skippedGroups.push(`${seriesName} (part 1 has no category in source data)`);
      continue;
    }

    const firstDb = await prisma.books.findUniqueOrThrow({
      where: { id: first.dbId },
      select: { category_id: true, cover_image_id: true, document_languages: true },
    });

    // Idempotency: matched on category + title, NOT cover_image_id — an
    // editor legitimately changing the parent's cover art via the CMS
    // between runs must not make this look like a fresh series.
    const existingParent = await prisma.books.findFirst({
      where: {
        parent_id: null,
        category_id: firstDb.category_id,
        book_translations: { some: { lang: 'ar', title: seriesName, is_default: true } },
      },
      select: { id: true },
    });

    // In dry mode a not-yet-existing parent has no real id — use a label so
    // the parts-linking preview below still runs and prints something
    // meaningful instead of silently reporting 0 parts affected (which is
    // exactly what happens on the very first production run, when every
    // parent is new).
    let parentId: string | null;
    if (existingParent) {
      parentId = existingParent.id;
      parentsAlreadyExisted++;
    } else {
      parentsCreated++;
      if (dryRun) {
        console.log(`[dry] would create parent "${seriesName}" (${dbRows.length} parts)`);
        parentId = null;
      } else {
        const created = await prisma.books.create({
          data: {
            category_id: firstDb.category_id,
            cover_image_id: firstDb.cover_image_id,
            document_languages: firstDb.document_languages,
            is_publication: isPublicationCategory(rawCats),
            book_translations: {
              create: { lang: 'ar', title: seriesName, author: first.src.author ?? null, publisher: first.src.printHouse ?? null, is_default: true },
            },
          },
        });
        parentId = created.id;
      }
    }

    for (const { src, dbId } of dbRows) {
      if (parentId) {
        const already = await prisma.books.findUnique({ where: { id: dbId }, select: { parent_id: true } });
        if (already?.parent_id === parentId) {
          partsAlreadyLinked++;
          continue;
        }
      }
      partsLinked++;
      if (dryRun || !parentId) {
        console.log(`[dry] would link part "${src.title}" (part ${src.partNumber}) -> parent "${seriesName}"${parentId ? ` (${parentId})` : ' (new)'}`);
        continue;
      }
      await prisma.books.update({
        where: { id: dbId },
        data: {
          parent_id: parentId,
          // A live DB CHECK constraint (chk_books_parts, not tracked in any
          // migration in this repo — added directly in production at some
          // point) requires part_number and parts to be both-null or
          // both-set. part_number stays as each part's position; parts is
          // kept in sync with the real group size rather than nulled out.
          parts: dbRows.length,
          book_translations: { updateMany: { where: { lang: 'ar' }, data: { title: seriesName } } },
        },
      });
    }
  }

  console.log(
    `Series: ${parentsCreated} parent(s) ${dryRun ? 'would be' : 'were'} created, ${parentsAlreadyExisted} already existed; ` +
      `${partsLinked} part(s) ${dryRun ? 'would be' : 'were'} linked, ${partsAlreadyLinked} already linked.`,
  );
  if (skippedGroups.length) {
    console.log(`⚠ ${skippedGroups.length} series group(s) skipped:`);
    for (const s of skippedGroups) console.log(`   - ${s}`);
  }
  if (dryRun) console.log('Dry run — nothing written.');
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('❌ link-book-parts failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
