/**
 * Content sync — loads the website's JSON data files and makes the database match them.
 * Run after the base seed (prisma:seed) which handles languages, roles, and the admin user.
 *
 * Each JSON row is matched to its existing DB row by a natural key (book pdf/cover, post
 * slug, image URL, paper pdf+title, page slug, audio URL, ...). Missing rows are created,
 * changed fields are updated, and every change is printed as one line. CMS-owned state
 * (is_published, deleted_at, is_featured, editor slugs on audios) is never touched on
 * existing rows, and neither is a gallery image's category (operators recategorised some).
 *
 * The whole run is ONE transaction: it either applies completely or not at all.
 * DRY_RUN=1 runs every read and write, prints the same change log, then rolls back —
 * so a dry run also proves the writes satisfy every constraint.
 *
 * Usage:
 *   DRY_RUN=1 npm run prisma:seed-content   # preview
 *   npm run prisma:seed-content             # apply
 */

import * as fs from 'fs';
import * as path from 'path';
import { Prisma, PrismaClient } from '@prisma/client';
import {
  assertDataDir,
  loadJson,
  normalizeUrl,
  extractFilename,
  detectMimeType,
  safeParseDate,
  getOrCreateSpeaker,
  normalizeDocumentLanguages,
} from './lib/seed-utils';
import type {
  BookJson,
  PostJson,
  GalleryJson,
  ResearchJson,
  JournalJson,
  StudentJson,
  HadithJson,
  StaticPageJson,
  StoreJson,
  AudioJson,
} from './lib/seed-utils';

const DRY_RUN = process.env.DRY_RUN === '1';

// The direct (session) connection: the whole sync is one long interactive transaction.
const prisma = new PrismaClient({ datasourceUrl: process.env.DIRECT_URL ?? process.env.DATABASE_URL });

/** The transaction client every seed function writes through; set in main(). */
let db: Prisma.TransactionClient;

// ── Change log ────────────────────────────────────────────────────────────────

type Action = 'create' | 'update' | 'delete' | 'keep';
const counts = new Map<string, Record<Action, number>>();

function record(entity: string, action: Action, key: string, detail = ''): void {
  if (!counts.has(entity)) counts.set(entity, { create: 0, update: 0, delete: 0, keep: 0 });
  counts.get(entity)![action]++;
  console.log(`  [${entity}] ${action.toUpperCase()} ${key}${detail ? ` :: ${detail}` : ''}`);
}

function normForDiff(v: unknown): unknown {
  if (v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'bigint') return v.toString();
  return v;
}

function show(v: unknown): string {
  const s = JSON.stringify(normForDiff(v)) ?? 'null';
  return s.length > 140 ? `${s.slice(0, 140)}…(${s.length} chars)` : s;
}

/** The subset of `next` whose values differ from `current`. */
function changedFields<T extends Record<string, unknown>>(current: Record<string, unknown> | null, next: T): Partial<T> {
  const out: Partial<T> = {};
  for (const k of Object.keys(next) as (keyof T & string)[]) {
    if (JSON.stringify(normForDiff(current?.[k])) !== JSON.stringify(normForDiff(next[k]))) out[k] = next[k];
  }
  return out;
}

/**
 * Diff `next` against `current`; if anything changed, log it and hand the changed
 * fields to `write`. Returns whether a write happened.
 */
async function syncFields<T extends Record<string, unknown>>(
  entity: string,
  key: string,
  current: Record<string, unknown> | null,
  next: T,
  write: (patch: Partial<T>) => Promise<unknown>,
): Promise<boolean> {
  const patch = changedFields(current, next);
  const fields = Object.keys(patch);
  if (!fields.length) return false;
  record(entity, 'update', key, fields.map((f) => `${f}: ${show(current?.[f])} → ${show(patch[f])}`).join(' | '));
  await write(patch);
  return true;
}

const loose = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

// ── Media ─────────────────────────────────────────────────────────────────────

let mediaIdByUrl: Map<string, string>;

/** Find-or-create a media record by URL (URL is the natural unique key). Returns the UUID. */
async function upsertMedia(url: string, altText?: string): Promise<string> {
  const known = mediaIdByUrl.get(url);
  if (known) return known;
  const created = await db.media.create({
    data: {
      filename: extractFilename(url),
      url,
      alt_text: altText ?? null,
      mime_type: detectMimeType(url),
      file_size: BigInt(1),
    },
  });
  mediaIdByUrl.set(url, created.id);
  return created.id;
}

// ── Category Arabic-slug maps ─────────────────────────────────────────────────
// Mapping is required: unmapped Arabic names throw, so new categories surface
// loudly rather than silently producing empty slugs.

const BOOK_CAT_SLUG: Record<string, string> = {
  'الصحيفة السجادية':              'al-sahifa-al-sajjadiyya',
  'الإصدارات':                     'al-isdaraat',
  'ما كتب عن الإمام زين العابدين': 'about-imam-zain-al-abidin',
  'رسالة الحقوق':                  'risala-al-huquq',
};

const POST_CAT_SLUG: Record<string, string> = {
  'نشاطات':          'nashatat',
  'فعاليات':         'faaliyat',
  'مجالس':           'majalis',
  'العتبة الحسينية': 'al-ataba-al-husayniyya',
};

const GALLERY_CAT_SLUG: Record<string, string> = {
  'ندوات':   'nadawat',
  'نشاطات':  'nashatat',
  'اخبار':   'akhbar',
  'مسابقات': 'musabaqat',
  'مناسبات': 'munasabat',
  'فعاليات': 'faaliyat',
  'مجالس': 'majalis',
};

// The old single "رسائل جامعية" (university theses) category was split into
// three by degree level. Every existing thesis's level is recoverable from
// student.json's own translations[0].category field ("بكالوريوس"/"رسالة
// ماجستير"/"دكتوراه") — see DEGREE_LABEL_TO_CATKEY below — so nothing about
// this split is guesswork.
const ACADEMIC_CATS = [
  { key: 'conference',       ar: 'بحوث المؤتمرات العلمية', ar_slug: 'buhuth-al-mutamarat' },
  { key: 'journals',         ar: 'بحوث في دوريات علمية',   ar_slug: 'buhuth-fi-dawriyyat' },
  { key: 'thesis_bachelor',  ar: 'رسائل البكالوريوس',      ar_slug: 'rasail-bachelors' },
  { key: 'thesis_master',    ar: 'رسائل الماجستير',        ar_slug: 'rasail-master' },
  { key: 'thesis_phd',       ar: 'رسائل الدكتوراه',        ar_slug: 'rasail-phd' },
];

// ── Category helpers ──────────────────────────────────────────────────────────

/**
 * Find-or-create a category and its Arabic translation, using the Arabic slug as
 * the idempotency key. Returns the category UUID.
 */
async function findOrCreateCategory(
  tablePrefix: 'book' | 'post' | 'gallery' | 'academic_paper',
  arName: string,
  arSlug: string,
): Promise<string> {
  const translationModel = `${tablePrefix}_category_translations` as
    | 'book_category_translations'
    | 'post_category_translations'
    | 'gallery_category_translations'
    | 'academic_paper_category_translations';

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const existing = await (db[translationModel] as any).findFirst({
    where: { lang: 'ar', slug: arSlug },
  });
  if (existing) return existing.category_id as string;

  // Category + Arabic translation in ONE nested create — the relation field name
  // on each category model equals the translation model name.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cat = await (db[`${tablePrefix}_categories` as keyof typeof db] as any).create({
    data: { [translationModel]: { create: { lang: 'ar', title: arName, slug: arSlug } } },
  });
  record(`${tablePrefix}_categories`, 'create', arSlug, arName);

  return cat.id as string;
}

function requireSlug(map: Record<string, string>, arName: string, kind: string): string {
  const slug = map[arName];
  if (!slug) throw new Error(`Unmapped ${kind} category "${arName}" — add it to the ${kind} slug map in seed-content.ts`);
  return slug;
}

function categoryResolver(prefix: 'book' | 'post', map: Record<string, string>) {
  const cache = new Map<string, string>();
  return async (arName: string): Promise<string> => {
    if (!cache.has(arName)) cache.set(arName, await findOrCreateCategory(prefix, arName, requireSlug(map, arName, prefix)));
    return cache.get(arName)!;
  };
}

// ── Books ─────────────────────────────────────────────────────────────────────

/** "الإصدارات" (Publications) can appear anywhere in a book's category array, not just first — see is_publication on the schema. */
function isPublicationCategory(rawCats: string[]): boolean {
  return rawCats.some((c) => c.trim() === 'الإصدارات');
}

const bookCats = (b: BookJson) => (Array.isArray(b.category) ? b.category : b.category ? [b.category] : []);
const bookLangs = (b: BookJson) => normalizeDocumentLanguages(Array.isArray(b.language) ? b.language : [b.language]);

async function seedBooks(): Promise<void> {
  const E = 'books';
  const books = loadJson<BookJson[]>('books.json');
  const getBookCatId = categoryResolver('book', BOOK_CAT_SLUG);

  const existing = await db.books.findMany({ include: { book_translations: true, media: { select: { url: true } } } });
  const parentIds = new Set(existing.map((b) => b.parent_id).filter((id): id is string => id !== null));
  const leaves = existing.filter((b) => !parentIds.has(b.id));
  const arTr = (b: (typeof existing)[number]) => b.book_translations.find((t) => t.lang === 'ar') ?? null;

  // A "series" is a group of >= 2 JSON rows sharing the same `series` string —
  // each becomes a part linked under one parent/cover book. A group of exactly
  // 1 is NOT a series: it seeds as an ordinary standalone book.
  const seriesGroups = new Map<string, BookJson[]>();
  for (const b of books) {
    const key = b.series?.trim();
    if (!key) continue;
    if (!seriesGroups.has(key)) seriesGroups.set(key, []);
    seriesGroups.get(key)!.push(b);
  }
  const realSeriesOf = (b: BookJson) => {
    const key = b.series?.trim();
    return key && (seriesGroups.get(key)?.length ?? 0) > 1 ? key : null;
  };
  // A real part's own title is normalized to the series name — the numeric
  // part_number is the canonical way an API consumer tells parts apart.
  const expectedTitle = (b: BookJson) => realSeriesOf(b) ?? b.title ?? '';

  // Match JSON rows to leaf rows: pdf_url first (unique across the corpus and
  // never set on a series parent), then — for rows whose pdf didn't match —
  // the cover image, narrowed by title when several leaves share a cover.
  const matchOf = new Map<BookJson, (typeof existing)[number]>();
  const claimed = new Set<string>();
  for (const b of books) {
    const pdf = b.pdf?.trim() ? normalizeUrl(b.pdf) : null;
    const hit = pdf ? leaves.find((x) => !claimed.has(x.id) && x.pdf_url === pdf) : undefined;
    if (hit) { matchOf.set(b, hit); claimed.add(hit.id); }
  }
  for (const b of books) {
    if (matchOf.has(b)) continue;
    const img = normalizeUrl(b.image ?? '');
    let cands = leaves.filter((x) => !claimed.has(x.id) && x.media.url === img);
    if (cands.length > 1) cands = cands.filter((x) => loose(arTr(x)?.title) === loose(expectedTitle(b)));
    if (cands.length > 1) throw new Error(`books.json #${b.id}: ${cands.length} DB books share its cover and title — resolve by hand`);
    if (cands.length === 1) { matchOf.set(b, cands[0]); claimed.add(cands[0].id); }
  }

  // Series parents: the parent the matched parts already point at, else a
  // top-level book with the series title in the same category, else a new one.
  const parentIdBySeries = new Map<string, string>();
  for (const [seriesName, group] of seriesGroups) {
    if (group.length < 2) continue;
    const first = [...group].sort((a, b) => (a.partNumber ?? 0) - (b.partNumber ?? 0))[0]!;
    const rawCats = bookCats(first);
    const primaryCat = rawCats[0]?.trim();
    const coverUrl = normalizeUrl(first.image ?? '');
    if (!primaryCat || !coverUrl) continue;
    const categoryId = await getBookCatId(primaryCat);
    const mediaId = await upsertMedia(coverUrl, seriesName);

    const linked = new Set(group.map((b) => matchOf.get(b)?.parent_id).filter((id): id is string => !!id));
    if (linked.size > 1) throw new Error(`Series "${seriesName}": its parts point at ${linked.size} different parents`);
    let parent = linked.size
      ? existing.find((x) => x.id === [...linked][0])
      : existing.find((x) => x.parent_id === null && x.category_id === categoryId && !claimed.has(x.id) && arTr(x)?.title === seriesName);

    // No pdf_url/pages of its own — it's the series' cover entry, the actual
    // documents live on its parts.
    const fields = {
      category_id: categoryId,
      cover_image_id: mediaId,
      is_publication: isPublicationCategory(rawCats),
      document_languages: bookLangs(first),
    };
    const trFields = { title: seriesName, author: first.author?.trim() ? first.author : null, publisher: first.printHouse?.trim() ? first.printHouse : null, is_default: true };

    if (!parent) {
      const created = await db.books.create({ data: { ...fields, book_translations: { create: { lang: 'ar', ...trFields } } } });
      record(E, 'create', `series parent "${seriesName}"`);
      parentIdBySeries.set(seriesName, created.id);
      continue;
    }
    claimed.add(parent.id);
    parentIdBySeries.set(seriesName, parent.id);
    const key = `series parent "${seriesName}"`;
    await syncFields(E, key, parent, fields, (data) => db.books.update({ where: { id: parent!.id }, data }));
    await syncFields(E, `${key} (ar)`, arTr(parent), trFields, (data) =>
      db.book_translations.upsert({
        where: { book_id_lang: { book_id: parent!.id, lang: 'ar' } },
        create: { book_id: parent!.id, lang: 'ar', ...trFields },
        update: data,
      }),
    );
  }

  for (const b of books) {
    const key = `#${b.id} ${b.slug}`;
    const imageUrl = normalizeUrl(b.image ?? '');
    const primaryCat = bookCats(b)[0]?.trim();
    if (!imageUrl || !primaryCat) throw new Error(`books.json #${b.id} has no image or category`);

    const seriesKey = realSeriesOf(b);
    // A lone surviving volume (e.g. "part 2 of 2") isn't linked to anything,
    // but still records which part it is.
    const lonePart = !seriesKey && b.series?.trim() && b.partNumber && b.totalParts && b.partNumber <= b.totalParts;
    const fields = {
      category_id: await getBookCatId(primaryCat),
      cover_image_id: await upsertMedia(imageUrl, b.title),
      pages: b.pages != null ? (parseInt(String(b.pages), 10) || null) : null,
      publish_year: b.printDate != null && String(b.printDate).trim() ? String(b.printDate) : null,
      pdf_url: b.pdf?.trim() ? normalizeUrl(b.pdf) : null,
      slug: b.slug?.trim() || null,
      part_number: seriesKey ? (b.partNumber != null ? parseInt(String(b.partNumber), 10) || null : null) : lonePart ? b.partNumber! : null,
      // chk_books_parts requires part_number and parts to be both-null or
      // both-set; for a real series parts mirrors the group size.
      parts: seriesKey ? seriesGroups.get(seriesKey)!.length : lonePart ? b.totalParts! : null,
      parent_id: seriesKey ? (parentIdBySeries.get(seriesKey) ?? null) : null,
      is_publication: isPublicationCategory(bookCats(b)),
      // views intentionally NOT seeded from JSON — the legacy counts aren't
      // real usage data for this API.
      document_languages: bookLangs(b),
    };
    const trFields = {
      title: expectedTitle(b),
      author: b.author?.trim() ? b.author : null,
      publisher: b.printHouse?.trim() ? b.printHouse : null,
      series: b.series ?? null,
      is_default: true,
    };

    const d = matchOf.get(b);
    if (!d) {
      await db.books.create({ data: { ...fields, book_translations: { create: { lang: 'ar', ...trFields } } } });
      record(E, 'create', key, trFields.title);
      continue;
    }
    await syncFields(E, key, d, fields, (data) => db.books.update({ where: { id: d.id }, data }));
    await syncFields(E, `${key} (ar)`, arTr(d), trFields, (data) =>
      db.book_translations.upsert({
        where: { book_id_lang: { book_id: d.id, lang: 'ar' } },
        create: { book_id: d.id, lang: 'ar', ...trFields },
        update: data,
      }),
    );
  }

  for (const d of existing) {
    if (!claimed.has(d.id) && !d.deleted_at) record(E, 'keep', `DB-only book ${d.id}`, arTr(d)?.title ?? '');
  }
}

// ── Posts ─────────────────────────────────────────────────────────────────────

async function seedPosts(): Promise<void> {
  const E = 'posts';
  const posts = loadJson<PostJson[]>('posts.json');
  const getPostCatId = categoryResolver('post', POST_CAT_SLUG);

  const existing = await db.posts.findMany({ include: { post_translations: true, post_attachments: true } });
  const bySlug = new Map(existing.map((p) => [p.slug, p]));
  const seen = new Set<string>();

  for (const p of posts) {
    if (!p.slug) throw new Error(`posts.json #${p.id} has no slug`);
    if (seen.has(p.slug)) throw new Error(`posts.json has duplicate slug "${p.slug}"`);
    seen.add(p.slug);
    const key = `#${p.id} ${p.slug}`;

    const catName = p.category?.trim();
    if (!catName) throw new Error(`posts.json #${p.id} has no category`);
    const imgUrl = p.image ? normalizeUrl(p.image) : '';

    const fields = {
      category_id: await getPostCatId(catName),
      cover_image_id: imgUrl ? await upsertMedia(imgUrl, p.title) : null,
      published_at: safeParseDate(p.date),
      // views intentionally NOT seeded from JSON — starts at 0, same as books.
    };
    const trFields = { title: p.title, summary: p.summary ?? null, body: p.content ?? '', is_default: true };

    // display_order keeps the source array index; duplicate media within one
    // post collapse to the first occurrence (the PK is (post_id, media_id)).
    const attachments: { media_id: string; display_order: number }[] = [];
    for (let i = 0; i < (p.attachments?.length ?? 0); i++) {
      const attUrl = normalizeUrl(p.attachments![i].path);
      if (!attUrl) continue;
      const mediaId = await upsertMedia(attUrl);
      if (attachments.some((a) => a.media_id === mediaId)) continue;
      attachments.push({ media_id: mediaId, display_order: i });
    }

    const d = bySlug.get(p.slug);
    if (!d) {
      await db.posts.create({
        data: {
          ...fields,
          slug: p.slug,
          is_published: true,
          post_translations: { create: { lang: 'ar', ...trFields } },
          post_attachments: { create: attachments },
        },
      });
      record(E, 'create', key, `${p.title} (${attachments.length} attachments)`);
      continue;
    }

    await syncFields(E, key, d, fields, (data) => db.posts.update({ where: { id: d.id }, data }));
    await syncFields(E, `${key} (ar)`, d.post_translations.find((t) => t.lang === 'ar') ?? null, trFields, (data) =>
      db.post_translations.upsert({
        where: { post_id_lang: { post_id: d.id, lang: 'ar' } },
        create: { post_id: d.id, lang: 'ar', ...trFields },
        update: data,
      }),
    );
    const current = [...d.post_attachments].sort((a, b) => a.display_order - b.display_order).map((a) => ({ media_id: a.media_id, display_order: a.display_order }));
    if (JSON.stringify(current) !== JSON.stringify(attachments)) {
      record(E, 'update', `${key} attachments`, `${current.length} → ${attachments.length}`);
      await db.post_attachments.deleteMany({ where: { post_id: d.id } });
      await db.post_attachments.createMany({ data: attachments.map((a) => ({ post_id: d.id, ...a })) });
    }
  }

  for (const d of existing) if (!seen.has(d.slug) && !d.deleted_at) record(E, 'keep', `DB-only post ${d.slug}`);
}

// ── Gallery ───────────────────────────────────────────────────────────────────

async function seedGallery(): Promise<void> {
  const E = 'gallery_images';
  const images = loadJson<GalleryJson[]>('gallery.json');

  const catCache = new Map<string, string>();
  async function getGalleryCatId(arName: string): Promise<string> {
    if (!catCache.has(arName)) catCache.set(arName, await findOrCreateCategory('gallery', arName, requireSlug(GALLERY_CAT_SLUG, arName, 'gallery')));
    return catCache.get(arName)!;
  }

  const existing = await db.gallery_images.findMany({ include: { gallery_image_translations: true } });
  const byMedia = new Map(existing.map((g) => [g.media_id, g]));
  const seen = new Set<string>();

  for (const g of images) {
    const imgUrl = normalizeUrl(g.url);
    if (!imgUrl) throw new Error(`gallery.json #${g.id} has no url`);
    const key = `#${g.id} ${extractFilename(imgUrl)}`;
    const mediaId = await upsertMedia(imgUrl, g.name);
    if (seen.has(mediaId)) throw new Error(`gallery.json has duplicate url ${imgUrl}`);
    seen.add(mediaId);

    const fields = {
      taken_at: safeParseDate(g.date),
      author: g.photographer || null,
      tags: g.tags ?? [],
      locations: g.location ? [g.location] : [],
    };
    const trFields = { title: g.name ?? extractFilename(imgUrl), description: g.description ?? null };
    const catName = g.category?.trim();

    const d = byMedia.get(mediaId);
    if (!d) {
      await db.gallery_images.create({
        data: {
          media_id: mediaId,
          category_id: catName ? await getGalleryCatId(catName) : null,
          ...fields,
          gallery_image_translations: { create: { lang: 'ar', ...trFields } },
        },
      });
      record(E, 'create', key, trFields.title);
      continue;
    }

    await syncFields(E, key, d, fields, (data) => db.gallery_images.update({ where: { media_id: mediaId }, data }));
    await syncFields(E, `${key} (ar)`, d.gallery_image_translations.find((t) => t.lang === 'ar') ?? null, trFields, (data) =>
      db.gallery_image_translations.upsert({
        where: { media_id_lang: { media_id: mediaId, lang: 'ar' } },
        create: { media_id: mediaId, lang: 'ar', ...trFields },
        update: data,
      }),
    );
    // Category is operator-owned on existing images: report a difference, never overwrite it.
    if (catName && (await getGalleryCatId(catName)) !== d.category_id) record(E, 'keep', `${key} category`, `JSON says "${catName}", DB category kept`);
  }

  for (const d of existing) if (!seen.has(d.media_id) && !d.deleted_at) record(E, 'keep', `DB-only image ${d.media_id}`);
}

// ── Academic papers ───────────────────────────────────────────────────────────

async function seedAcademicCategories(): Promise<Map<string, string>> {
  const catMap = new Map<string, string>();
  for (const c of ACADEMIC_CATS) {
    catMap.set(c.key, await findOrCreateCategory('academic_paper', c.ar, c.ar_slug));
  }
  return catMap;
}

type PaperTranslation = {
  lang: string;
  title: string;
  abstract: string | null;
  authors: string[];
  publication_venue: string | null;
  page_count: number | null;
  is_default: boolean;
};

type PaperSpec = {
  key: string;
  categoryId: string;
  pdfUrl: string | null;
  arTitle: string;
  fields: { category_id: string; published_year: string | null; pdf_url: string | null; document_languages?: string[] };
  translations: PaperTranslation[];
};

/**
 * Match each spec to an existing paper in `categoryIds`, then create/update.
 * pdf_url alone is NOT unique (one journal-issue PDF can hold several
 * articles), so matching runs in passes, each only over still-unclaimed rows:
 *   1. same pdf_url + same Arabic title (whitespace-insensitive);
 *   2. same pdf_url, when exactly one spec and one row are left on that pdf
 *      (the title was edited) — several on both sides is ambiguous and aborts;
 *   3. same Arabic title, when exactly one row has it (the pdf was edited).
 * Seeded rows (uploaded_by null) no spec claims are soft-deleted: they're
 * entries the website removed. CMS-uploaded rows are kept.
 */
async function syncPapers(E: string, categoryIds: string[], specs: PaperSpec[]): Promise<void> {
  const existing = await db.academic_papers.findMany({
    where: { category_id: { in: categoryIds }, deleted_at: null },
    include: { academic_paper_translations: true },
  });
  const arTitle = (p: (typeof existing)[number]) => loose(p.academic_paper_translations.find((t) => t.lang === 'ar')?.title);
  const claimed = new Set<string>();
  const matchOf = new Map<PaperSpec, (typeof existing)[number]>();
  const free = () => existing.filter((p) => !claimed.has(p.id));
  const claim = (s: PaperSpec, p: (typeof existing)[number]) => { matchOf.set(s, p); claimed.add(p.id); };

  for (const s of specs) {
    const hit = free().find((p) => p.pdf_url === s.pdfUrl && arTitle(p) === loose(s.arTitle));
    if (hit) claim(s, hit);
  }
  const byPdf = new Map<string, PaperSpec[]>();
  for (const s of specs) if (!matchOf.has(s) && s.pdfUrl) byPdf.set(s.pdfUrl, [...(byPdf.get(s.pdfUrl) ?? []), s]);
  for (const [pdf, group] of byPdf) {
    const cands = free().filter((p) => p.pdf_url === pdf);
    if (!cands.length) continue;
    if (group.length === 1 && cands.length === 1) { claim(group[0], cands[0]); continue; }
    throw new Error(`${E}: ${group.length} JSON rows and ${cands.length} DB rows share ${pdf} with differing titles — resolve by hand`);
  }
  for (const s of specs) {
    if (matchOf.has(s)) continue;
    const cands = free().filter((p) => arTitle(p) === loose(s.arTitle));
    if (cands.length === 1) claim(s, cands[0]);
  }

  for (const s of specs) {
    const d = matchOf.get(s);
    if (!d) {
      await db.academic_papers.create({ data: { ...s.fields, academic_paper_translations: { create: s.translations } } });
      record(E, 'create', s.key);
      continue;
    }
    await syncFields(E, s.key, d, s.fields, (data) => db.academic_papers.update({ where: { id: d.id }, data }));
    for (const t of s.translations) {
      const { lang, ...trFields } = t;
      await syncFields(E, `${s.key} (${lang})`, d.academic_paper_translations.find((x) => x.lang === lang) ?? null, trFields, (data) =>
        db.academic_paper_translations.upsert({
          where: { paper_id_lang: { paper_id: d.id, lang } },
          create: { paper_id: d.id, keywords: [], ...t },
          update: data,
        }),
      );
    }
  }

  for (const d of existing) {
    if (claimed.has(d.id)) continue;
    if (d.uploaded_by) { record(E, 'keep', `CMS-added paper ${d.id}`, arTitle(d)); continue; }
    record(E, 'delete', `paper ${d.id} (no longer in JSON)`, `${arTitle(d)} | ${d.pdf_url}`);
    await db.academic_papers.update({ where: { id: d.id }, data: { deleted_at: new Date() } });
  }
}

// research.json authors are one free-text string. Most split cleanly on
// separators; these don't (a hyphenated surname, an institution's name).
const AUTHOR_OVERRIDES: Record<string, string[]> = {
  'رنا جبار عبيد الحميدي - Rana jaber Obaid Al-Hameedi': ['رنا جبار عبيد الحميدي', 'Rana jaber Obaid Al-Hameedi'],
  'قسم الشؤون الفكرية - العتبة العباسية': ['قسم الشؤون الفكرية - العتبة العباسية'],
};

function splitAuthors(raw: string | undefined): string[] {
  if (!raw) return [];
  const override = AUTHOR_OVERRIDES[raw.trim()];
  if (override) return override;
  return raw.split(/[،,–-]+/).map((a) => a.trim()).filter(Boolean);
}

async function seedResearchPapers(categoryId: string): Promise<void> {
  const papers = loadJson<ResearchJson[]>('research.json');
  const specs: PaperSpec[] = papers.map((p) => ({
    key: `#${p.id} ${(p.title ?? '').slice(0, 60)}`,
    categoryId,
    pdfUrl: p.pdfUrl ?? null,
    arTitle: p.title ?? '',
    fields: { category_id: categoryId, published_year: p.publishedYear ?? null, pdf_url: p.pdfUrl ?? null },
    translations: [{
      lang: 'ar',
      title: p.title ?? '',
      abstract: p.abstract ?? null,
      authors: splitAuthors(p.author),
      publication_venue: p.conference ?? null,
      page_count: null,
      is_default: true,
    }],
  }));
  await syncPapers('papers:conference', [categoryId], specs);
}

// journals.json / student.json encode each title variant's own language as
// `languageid`, NOT the free-text `language` field (which is the SOURCE
// DOCUMENT's language, redundantly repeated on every translation of that
// record — that's what feeds document_languages below). Only 1 and 2 occur
// in the data: 1 is always the Arabic-rendered title (used for the Arabic
// UI and as the match key), 2 — present only when the source isn't
// Arabic — is the original-language title.
const JOURNAL_LANGUAGEID_TO_LANG: Record<number, string> = { 1: 'ar', 2: 'fa' };

async function seedJournals(categoryId: string): Promise<void> {
  const journals = loadJson<JournalJson[]>('journals.json');
  const specs: PaperSpec[] = journals.map((j) => {
    const translations = j.translations ?? [];
    const primary = translations.find((t) => t.languageid === 1) ?? translations[0];
    const unknown = translations.find((t) => !JOURNAL_LANGUAGEID_TO_LANG[t.languageid]);
    if (unknown) throw new Error(`journals.json #${j.id}: unmapped languageid ${unknown.languageid}`);
    return {
      key: `#${j.id} ${(primary?.title ?? '').trim().slice(0, 60)}`,
      categoryId,
      pdfUrl: j.pdfUrl ?? null,
      arTitle: primary?.title?.trim() ?? '',
      fields: {
        category_id: categoryId,
        published_year: j.publishedYear ?? null,
        pdf_url: j.pdfUrl ?? null,
        document_languages: normalizeDocumentLanguages(translations.map((t) => t.language)),
      },
      translations: translations.map((t) => ({
        lang: JOURNAL_LANGUAGEID_TO_LANG[t.languageid],
        title: t.title?.trim() ?? '',
        abstract: null,
        authors: (t.authors ?? []).filter(Boolean),
        publication_venue: t.publicationVenue ?? null,
        page_count: t.pagenam ?? null,
        is_default: t.languageid === 1,
      })),
    };
  });
  await syncPapers('papers:journals', [categoryId], specs);
}

// Every thesis in student.json carries its own degree level in
// translations[0].category — exactly these 3 values.
const DEGREE_LABEL_TO_CATKEY: Record<string, string> = {
  'بكالوريوس': 'thesis_bachelor',
  'رسالة ماجستير': 'thesis_master',
  'دكتوراه': 'thesis_phd',
};

async function seedStudentTheses(catMap: Map<string, string>): Promise<void> {
  const theses = loadJson<StudentJson[]>('student.json');
  const specs: PaperSpec[] = theses.map((s) => {
    const t = s.translations?.[0];
    const degreeLabel = t?.category?.trim() ?? '';
    const catKey = DEGREE_LABEL_TO_CATKEY[degreeLabel];
    if (!catKey) {
      throw new Error(`Unmapped thesis degree label "${degreeLabel}" (paper id ${s.id}) — add it to DEGREE_LABEL_TO_CATKEY in seed-content.ts`);
    }
    const categoryId = catMap.get(catKey)!;
    return {
      key: `#${s.id} ${(t?.title ?? '').trim().slice(0, 60)}`,
      categoryId,
      pdfUrl: s.pdfUrl ?? null,
      arTitle: t?.title?.trim() ?? '',
      fields: {
        category_id: categoryId,
        published_year: s.publishedYear ?? null,
        pdf_url: s.pdfUrl ?? null,
        document_languages: normalizeDocumentLanguages([t?.language]),
      },
      translations: [{
        lang: 'ar',
        title: t?.title?.trim() ?? '',
        abstract: null,
        authors: (t?.authors ?? []).filter(Boolean),
        publication_venue: t?.publicationVenue ?? null,
        page_count: t?.pagenam ?? null,
        is_default: true,
      }],
    };
  });
  const thesisCats = ['thesis_bachelor', 'thesis_master', 'thesis_phd'].map((k) => catMap.get(k)!);
  await syncPapers('papers:theses', thesisCats, specs);
}

// ── Daily hadiths ─────────────────────────────────────────────────────────────

/** One hadith per Hijri day (prisma/data/daily-hadiths.json), not a legacy export. Insert-only. */
async function seedHadiths(): Promise<void> {
  const file = path.join(__dirname, 'data', 'daily-hadiths.json');
  const hadiths = JSON.parse(fs.readFileSync(file, 'utf-8')) as HadithJson[];

  for (const h of hadiths) {
    // A Hijri day that already has a live hadith keeps it.
    const existing = await db.daily_hadiths.findFirst({
      where: { hijri_month: h.hijri_month, hijri_day: h.hijri_day, deleted_at: null },
    });
    if (existing) continue;

    await db.daily_hadiths.create({
      data: {
        hijri_month: h.hijri_month,
        hijri_day: h.hijri_day,
        daily_hadith_translations: { create: { lang: 'ar', content: h.content, source: h.source } },
      },
    });
    record('daily_hadiths', 'create', `${h.hijri_month}/${h.hijri_day}`);
  }
}

// ── Static pages ──────────────────────────────────────────────────────────────

async function seedStaticPages(): Promise<void> {
  const E = 'static_pages';
  const pages = loadJson<StaticPageJson[]>('imamzain.json');
  const existing = await db.static_pages.findMany({ include: { static_page_translations: true } });

  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    if (!p.slug) throw new Error(`imamzain.json row ${i} has no slug`);
    const trFields = { title: p.title ?? '', body: p.content ?? '', is_default: true };

    const d = existing.find((x) => x.slug === p.slug);
    if (!d) {
      await db.static_pages.create({
        data: { slug: p.slug, display_order: i, is_published: true, static_page_translations: { create: { lang: 'ar', ...trFields } } },
      });
      record(E, 'create', p.slug);
      continue;
    }
    await syncFields(E, p.slug, d.static_page_translations.find((t) => t.lang === 'ar') ?? null, trFields, (data) =>
      db.static_page_translations.upsert({
        where: { page_id_lang: { page_id: d.id, lang: 'ar' } },
        create: { page_id: d.id, lang: 'ar', ...trFields },
        update: data,
      }),
    );
  }
}

// ── Stores ────────────────────────────────────────────────────────────────────

async function seedStores(): Promise<void> {
  const E = 'stores';
  const stores = loadJson<StoreJson[]>('store-locations.json');

  for (let i = 0; i < stores.length; i++) {
    const s = stores[i];
    const cityName = s.city?.trim();
    if (!cityName) throw new Error(`store-locations.json row ${i} has no city`);

    const cityTr = await db.store_translations.findFirst({ where: { lang: 'ar', city_name: cityName } });
    const storeId = cityTr
      ? cityTr.store_id
      : (await db.stores.create({ data: { display_order: i, store_translations: { create: { lang: 'ar', city_name: cityName } } } })).id;
    if (!cityTr) record(E, 'create', cityName);

    const locations = await db.store_locations.findMany({ where: { store_id: storeId }, include: { store_location_translations: true } });

    for (let j = 0; j < (s.sellpoints?.length ?? 0); j++) {
      const sp = s.sellpoints[j];
      const name = sp.name?.trim();
      if (!name) continue;
      const key = `${cityName} / ${name}`;
      const fields = { phone: sp.phone?.trim() || null, gps_embed_url: sp.gps?.trim() || null, gps_link: sp.gpsLink?.trim() || null };
      const trFields = { name, address: sp.location?.trim() ?? '' };

      const d = locations.find((l) => l.store_location_translations.some((t) => t.lang === 'ar' && t.name === name));
      if (!d) {
        await db.store_locations.create({
          data: { store_id: storeId, ...fields, display_order: j, store_location_translations: { create: { lang: 'ar', ...trFields } } },
        });
        record(E, 'create', key);
        continue;
      }
      await syncFields(E, key, d, fields, (data) => db.store_locations.update({ where: { id: d.id }, data }));
      await syncFields(E, `${key} (ar)`, d.store_location_translations.find((t) => t.lang === 'ar') ?? null, trFields, (data) =>
        db.store_location_translations.upsert({
          where: { location_id_lang: { location_id: d.id, lang: 'ar' } },
          create: { location_id: d.id, lang: 'ar', ...trFields },
          update: data,
        }),
      );
    }
  }
}

// ── Audios ──────────────────────────────────────────────────────────────────
// Each audio gets an `ar` audio_translation (title). Speaker is a first-class
// entity, deduped by its Arabic name. The key is audio_url (unique). CMS-owned
// fields (is_published, slug, deleted_at) are never touched on existing rows.

// The API caps peaks at 300 (DTO ArrayMaxSize), but the seed writes through
// Prisma and bypasses that validation. Older AudioItemAnalyzed.json exports
// carry 423–1500-point arrays; block-max downsample them to ≤300 here.
const MAX_SEED_PEAKS = 300;
function downsamplePeaks(peaks: number[] | undefined): number[] | null {
  if (!Array.isArray(peaks) || peaks.length === 0) return null;
  if (peaks.length <= MAX_SEED_PEAKS) return peaks;
  const block = peaks.length / MAX_SEED_PEAKS;
  const out: number[] = [];
  for (let i = 0; i < MAX_SEED_PEAKS; i++) {
    const start = Math.floor(i * block);
    const end = Math.floor((i + 1) * block);
    let max = 0;
    for (let j = start; j < end && j < peaks.length; j++) {
      const v = Math.abs(peaks[j]);
      if (v > max) max = v;
    }
    out.push(parseFloat(max.toFixed(4)));
  }
  return out;
}

async function seedAudios(): Promise<void> {
  const E = 'audios';
  const items = loadJson<AudioJson[]>('AudioItemAnalyzed.json');
  const speakerCache = new Map<string, string>();
  const existing = await db.audios.findMany({ include: { audio_translations: true } });
  const byUrl = new Map(existing.map((a) => [a.audio_url, a]));
  const seen = new Set<string>();
  const urlOf = (a: AudioJson) => (a.audio?.trim() ? normalizeUrl(a.audio) : '');
  // Two JSON rows sharing one mp3 are one recording: the last row wins.
  const lastRowOfUrl = new Map(items.map((a) => [urlOf(a), a]));

  for (const a of items) {
    const audioUrl = urlOf(a);
    if (!a.title?.trim() || !audioUrl) throw new Error(`AudioItemAnalyzed.json #${a.id} has no title or audio`);
    const key = `#${a.id} ${a.title.trim()}`;
    if (lastRowOfUrl.get(audioUrl) !== a) { record(E, 'keep', `${key} (same file as a later row, skipped)`); continue; }
    seen.add(audioUrl);

    const fields = {
      speaker_id: await getOrCreateSpeaker(db, speakerCache, a.speaker),
      pdf_url: a.pdf ? normalizeUrl(a.pdf) : null,
      duration_seconds: a.durationSeconds ?? null,
      size_mb: a.sizeMB ?? null,
    };
    const peaks = downsamplePeaks(a.peaks);
    const trFields = { title: a.title.trim(), is_default: true };

    const d = byUrl.get(audioUrl);
    if (!d) {
      await db.audios.create({
        data: { audio_url: audioUrl, is_published: true, ...fields, peaks: peaks ?? Prisma.DbNull, audio_translations: { create: { lang: 'ar', ...trFields } } },
      });
      record(E, 'create', key);
      continue;
    }
    await syncFields(E, key, d, fields, (data) => db.audios.update({ where: { id: d.id }, data }));
    if (JSON.stringify(d.peaks ?? null) !== JSON.stringify(peaks)) {
      record(E, 'update', `${key} peaks`);
      await db.audios.update({ where: { id: d.id }, data: { peaks: peaks ?? Prisma.DbNull } });
    }
    await syncFields(E, `${key} (ar)`, d.audio_translations.find((t) => t.lang === 'ar') ?? null, trFields, (data) =>
      db.audio_translations.upsert({
        where: { audio_id_lang: { audio_id: d.id, lang: 'ar' } },
        create: { audio_id: d.id, lang: 'ar', ...trFields },
        update: data,
      }),
    );
  }

  for (const d of existing) if (!seen.has(d.audio_url) && !d.deleted_at) record(E, 'keep', `DB-only audio ${d.audio_url}`);
}

// ── Main ──────────────────────────────────────────────────────────────────────
// Contest questions are no longer seeded by this script — operators manage the
// `qutuf_sajjadiya_contest_questions` table directly via the DB / CMS.

class DryRunRollback extends Error {}

async function main() {
  assertDataDir();
  console.log(DRY_RUN ? 'DRY RUN — every change below is rolled back at the end.\n' : 'Syncing content…\n');

  try {
    await prisma.$transaction(
      async (tx) => {
        db = tx;
        mediaIdByUrl = new Map((await db.media.findMany({ select: { id: true, url: true } })).map((m) => [m.url, m.id]));

        console.log('→ Books');
        await seedBooks();
        console.log('→ Posts');
        await seedPosts();
        console.log('→ Gallery images');
        await seedGallery();
        console.log('→ Academic papers');
        const academicCatMap = await seedAcademicCategories();
        await seedResearchPapers(academicCatMap.get('conference')!);
        await seedJournals(academicCatMap.get('journals')!);
        await seedStudentTheses(academicCatMap);
        console.log('→ Daily hadiths');
        await seedHadiths();
        console.log('→ Static pages');
        await seedStaticPages();
        console.log('→ Stores');
        await seedStores();
        console.log('→ Audios');
        await seedAudios();

        if (DRY_RUN) throw new DryRunRollback();
      },
      { maxWait: 60_000, timeout: 60 * 60_000 },
    );
  } catch (err) {
    if (!(err instanceof DryRunRollback)) throw err;
  }

  console.log('\nSummary (create / update / delete / keep):');
  for (const [entity, c] of counts) console.log(`  ${entity}: ${c.create} / ${c.update} / ${c.delete} / ${c.keep}`);
  console.log(DRY_RUN ? '\nDry run complete — nothing was written.' : '\nContent sync complete.');
}

main()
  .catch(err => {
    console.error('Content sync failed (nothing was written):', err);
    // exitCode (not exit()) so the .finally disconnect below still runs.
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
