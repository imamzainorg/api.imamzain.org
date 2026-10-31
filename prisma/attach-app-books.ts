/**
 * One-off data step for the 18 PDFs in "ملفات الكتب الجديدة": attaches each to its book as an
 * app-only download (books.pdf_access = 'app', see worker/src/features/books/pdf-access.ts).
 *
 * The file → book map below is explicit (matched by cover title and author, not guessed at run time):
 *   - 15 files belong to books already in the library that had no PDF;
 *   - folder files 9–11 (معجم إعراب ألفاظ الصحيفة, 3 volumes) replace the public PDFs those parts had;
 *   - folder file 18 (تفصيل الحقوق) is the PDF of two identical records, and gets attached to both;
 *   - the two القبانجي files are volumes 1 and 2 of ONE record, so that record becomes the series parent
 *     (no PDF of its own, as every parent) and gets two new parts, sharing its cover.
 *
 * The files themselves must already be on the CDN at https://cdn.imamzain.org/books/<file>.pdf.
 *
 * One transaction. DRY_RUN=1 runs it and rolls back. If books.pdf_access does not exist yet (migration
 * 20261031100000_books_pdf_access not applied), DRY_RUN=1 prints the plan only, and a real run refuses.
 *
 * Usage:
 *   DRY_RUN=1 npm run prisma:attach-app-books
 *   npm run prisma:attach-app-books
 */

import { PrismaClient } from '@prisma/client';

const DRY_RUN = process.env.DRY_RUN === '1';
const prisma = new PrismaClient({ datasourceUrl: process.env.DIRECT_URL ?? process.env.DATABASE_URL });

const cdnUrl = (file: string) => `https://cdn.imamzain.org/books/${file}.pdf`;

/** File name (no .pdf) → the slugs of the book records it is the PDF of. */
const ATTACH: Record<string, string[]> = {
  'al-imam-al-sajjad-wa-al-mafahim-al-tarbawiyya': ['al-imam-al-sajjad-wa-al-mafahim-al-tarbia'],
  'al-imam-al-sajjad-wa-bina-al-insan-abdullah-al-yusuf': ['al--imam-al-sajjad--wa-bina-al-insan'],
  'al-qanun-al-akhlaqi-fi-risalat-al-huquq': ['alqanun-alakhlaqi--fi-risalat-alhuquq-llimam-ali-bin-alhussain-zayn-alabidin-a'],
  'al-salat-fi-risalat-al-huquq': ['as-salat--fi-risalat-al--hoquq'],
  'al-tuhfa-al-radawiyya-fi-sharh-al-sahifa-al-sajjadiyya': ['al-tahfah--ral--radiyah-lil-sahifah-al-sajadiyah'],
  'imam-ali-ibn-al-husayn-zayn-al-abidin-2': ['al-imam-al-rabie-ali-bin-al-hussein'],
  'imam-zayn-al-abidin-daiyat-al-waei-dr-al-sayyid-radi': ['imam--zain--alabideen-daaei-alwaai-wa-muhayir-al-tughah'],
  'mae-al-imam-al-sajjad-fi-risalat-al-huquq': ['ma3--al--imam-al--sajad-fi-risalat-al-hoquq'],
  'mujam-ierab-alfaz-al-sahifa-al-sajjadiyya-j1': ['mojam-eerab-alfaz-al-sahifa-al-sajjadiyya-muhammad-jalil-abbas-volume-1'],
  'mujam-ierab-alfaz-al-sahifa-al-sajjadiyya-j2': ['mojam-eerab-alfaz-al-sahifa-al-sajjadiyya-muhammad-jalil-abbas-volume-2'],
  'mujam-ierab-alfaz-al-sahifa-al-sajjadiyya-j3': ['mojam-eerab-alfaz-al-sahifa-al-sajjadiyya-muhammad-jalil-abbas-volume-3'],
  'qabasat-min-risalat-al-huquq-sayyid-diaa-al-khazar': ['risalat-al-huquq-and-universal-declaration-of--human-rights'],
  'risalat-al-huquq-abbas-ali-al-musawi': ['risalat--alhuquq'],
  'risalat-al-huquq-wa-al-ielan-al-alami-li-huquq-al-insan': ['risalat-al-huquq-imam-al--sajjad-and-universal-declaration-of-human-rights-comparative-educational-study'],
  'taammulat-fi-risalat-al-huquq-muhammad-taqi-al-mudarrisi': ['taamulat--fi-risalat--alhuquq-llimam-ali-bin-alhussain-a'],
  'tafsil-al-huquq-sharh-riwaii-ala-risalat-al-huquq': [
    'tafsil--al--hoquq',
    'tafsil-alhuquq--sharh--ruwai-ala-risalat-alhuquq-llimam-alsajjad-a',
  ],
};

/** One record, two volumes (title pages: الجزء الأول / الجزء الثاني). */
const SERIES = {
  slug: 'risalat--al-huquq-imam-zain-al-abidin',
  parts: [
    { file: 'sharh-risalat-al-huquq-al-sayyid-hasan-al-qabanji', part_number: 1, pages: 663, slug: 'sharh-risalat-al-huquq-al-qabanji-part-1' },
    { file: 'sharh-risalat-al-huquq-al-sayyid-hasan-al-qabanji-2', part_number: 2, pages: 634, slug: 'sharh-risalat-al-huquq-al-qabanji-part-2' },
  ],
};

class DryRunRollback extends Error {}

const log = (action: string, key: string, detail = '') => console.log(`  [books] ${action} ${key}${detail ? ` :: ${detail}` : ''}`);

type Row = { id: string; slug: string; pdf_url: string | null; pdf_access: string; has_children: boolean };

async function run(db: Pick<PrismaClient, '$queryRawUnsafe' | 'books'>, hasColumn: boolean, write: boolean): Promise<void> {
  const slugs = [...new Set([...Object.values(ATTACH).flat(), SERIES.slug])];
  const rows = await db.$queryRawUnsafe<Row[]>(
    `select b.id::text, b.slug, b.pdf_url, ${hasColumn ? 'b.pdf_access' : "'public'::text as pdf_access"},
            exists (select 1 from books c where c.parent_id = b.id and c.deleted_at is null) as has_children
       from books b where b.slug = any($1) and b.deleted_at is null`,
    slugs,
  );
  const bySlug = new Map(rows.map((r) => [r.slug, r]));
  const need = (slug: string): Row => {
    const row = bySlug.get(slug);
    if (!row) throw new Error(`No live book with slug "${slug}"`);
    return row;
  };

  let attached = 0;
  for (const [file, targets] of Object.entries(ATTACH)) {
    const url = cdnUrl(file);
    for (const slug of targets) {
      const row = need(slug);
      if (row.pdf_url === url && row.pdf_access === 'app') { log('KEEP', slug, 'already attached'); continue; }
      log('UPDATE', slug, `pdf_url: ${JSON.stringify(row.pdf_url)} → ${JSON.stringify(url)} | pdf_access: ${row.pdf_access} → app`);
      if (write) await db.books.update({ where: { id: row.id }, data: { pdf_url: url, pdf_access: 'app', updated_at: new Date() } });
      attached++;
    }
  }

  // The series: the existing record becomes the parent and keeps no PDF of its own.
  const parent = need(SERIES.slug);
  if (parent.pdf_url) throw new Error(`"${SERIES.slug}" has a PDF of its own (${parent.pdf_url}); expected none for a series parent`);
  const src = await db.books.findFirst({
    where: { id: parent.id },
    select: {
      category_id: true, cover_image_id: true, is_publication: true, is_published: true, document_languages: true,
      book_translations: { select: { lang: true, title: true, author: true, publisher: true, is_default: true } },
    },
  });
  if (!src) throw new Error('series record vanished');
  const existingParts = await db.books.findMany({ where: { parent_id: parent.id, deleted_at: null }, select: { id: true, part_number: true, pdf_url: true } });

  for (const p of SERIES.parts) {
    const url = cdnUrl(p.file);
    const have = existingParts.find((x) => x.part_number === p.part_number);
    if (have) {
      log('KEEP', p.slug, `part ${p.part_number} already exists (${have.pdf_url})`);
      continue;
    }
    log('CREATE', p.slug, `part ${p.part_number} of ${SERIES.parts.length} under "${SERIES.slug}", ${p.pages} pages, ${url}`);
    if (write) {
      await db.books.create({
        data: {
          category_id: src.category_id,
          cover_image_id: src.cover_image_id,
          slug: p.slug,
          pages: p.pages,
          pdf_url: url,
          pdf_access: 'app',
          part_number: p.part_number,
          parts: SERIES.parts.length,
          parent_id: parent.id,
          is_publication: src.is_publication,
          is_published: src.is_published,
          document_languages: src.document_languages,
          book_translations: {
            create: src.book_translations.map((t) => ({
              lang: t.lang, title: t.title, author: t.author, publisher: t.publisher, series: t.title, is_default: t.is_default,
            })),
          },
        },
      });
    }
  }
  console.log(`\n  ${attached} book record(s) updated, ${SERIES.parts.length - existingParts.length} part(s) created for "${SERIES.slug}".`);
}

async function main() {
  const [{ n }] = await prisma.$queryRaw<{ n: number }[]>`
    select count(*)::int as n from information_schema.columns where table_name = 'books' and column_name = 'pdf_access'`;
  const hasColumn = n === 1;

  if (!hasColumn) {
    if (!DRY_RUN) throw new Error('books.pdf_access does not exist: apply migration 20261031100000_books_pdf_access first');
    console.log('books.pdf_access does not exist yet: printing the plan only (nothing is written).\n');
    await run(prisma, false, false);
    return;
  }

  console.log(DRY_RUN ? 'DRY RUN: every change below is rolled back at the end.\n' : 'Attaching the app-only PDFs…\n');
  try {
    await prisma.$transaction(
      async (tx) => {
        await run(tx as unknown as PrismaClient, true, true);
        if (DRY_RUN) throw new DryRunRollback();
      },
      { maxWait: 60_000, timeout: 5 * 60_000 },
    );
  } catch (err) {
    if (!(err instanceof DryRunRollback)) throw err;
  }
  console.log(DRY_RUN ? '\nDry run complete: nothing was written.' : '\nDone.');
}

main()
  .catch((err) => {
    console.error('attach-app-books failed (nothing was written):', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
