/**
 * Content seeder — loads legacy JSON data files and seeds them into the database.
 * Run after the base seed (prisma:seed) which handles languages, roles, and the admin user.
 *
 * Idempotent: safe to run multiple times. Each entity type checks for existing records
 * before inserting.
 *
 * Usage:
 *   npm run prisma:seed-content
 */

import { PrismaClient } from '@prisma/client';
import * as path from 'path';
import * as fs from 'fs';

const prisma = new PrismaClient();

const DATA_DIR = path.join(__dirname, '../../imamzain.org/src/data');

// ── Helpers ───────────────────────────────────────────────────────────────────

function loadJson<T>(file: string): T {
  const fullPath = path.join(DATA_DIR, file);
  return JSON.parse(fs.readFileSync(fullPath, 'utf-8')) as T;
}

function extractFilename(url: string): string {
  const decoded = decodeURIComponent(url.split('?')[0]);
  return decoded.split('/').pop() || 'unknown';
}

function detectMimeType(url: string): string {
  const ext = url.split('?')[0].split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
    gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
    pdf: 'application/pdf',
  };
  return map[ext] ?? 'application/octet-stream';
}

function normalizeUrl(url: string): string {
  if (!url || !url.trim()) return '';
  const u = url.trim();
  if (u.startsWith('http')) return u;
  if (u.startsWith('//')) return `https:${u}`;
  if (u.startsWith('/')) return `https://cdn.imamzain.org${u}`;
  return `https://cdn.imamzain.org/${u}`;
}

function safeParseDate(dateStr: string | null | undefined): Date | null {
  if (!dateStr) return null;
  const cleaned = dateStr.trim().replace(/\s+/g, '');
  const d = new Date(cleaned);
  return isNaN(d.getTime()) ? null : d;
}

/** Upsert a media record by URL (URL is the natural unique key). Returns the UUID. */
async function upsertMedia(url: string, altText?: string): Promise<string> {
  const existing = await prisma.media.findUnique({ where: { url } });
  if (existing) return existing.id;
  const created = await prisma.media.create({
    data: {
      filename: extractFilename(url),
      url,
      alt_text: altText ?? null,
      mime_type: detectMimeType(url),
      file_size: BigInt(1),
    },
  });
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
};

const ACADEMIC_CATS = [
  { key: 'conference', ar: 'بحوث المؤتمرات العلمية', ar_slug: 'buhuth-al-mutamarat' },
  { key: 'journals',   ar: 'بحوث في دوريات علمية',   ar_slug: 'buhuth-fi-dawriyyat' },
  { key: 'student',    ar: 'رسائل جامعية',           ar_slug: 'rasail-jamiiyya' },
];

// ── JSON types ────────────────────────────────────────────────────────────────

type BookJson = {
  id: number; slug: string; title: string; author?: string;
  printHouse?: string; printDate?: string;
  language?: string | string[]; pages?: number;
  parts?: number; views?: number; image?: string; pdf?: string;
  series?: string | null; partNumber?: number | null; totalParts?: number | null;
  category?: string | string[];
};

type PostJson = {
  id: number; slug: string; image?: string; title: string;
  summary?: string; content: string; views?: number;
  date?: string; last_update?: string; category?: string;
  attachments?: { id: number; path: string }[];
};

type GalleryJson = {
  id: number; name?: string; description?: string; date?: string;
  tags?: string[]; url: string; location?: string;
  photographer?: string; category?: string;
};

type ResearchJson = {
  id: string; slug?: string; title: string; abstract?: string;
  author?: string; publishedYear?: string; pdfUrl?: string; conference?: string;
};

type JournalJson = {
  id: string;
  translations?: { languageid: number; title: string; authors?: string[]; publicationVenue?: string; pagenam?: number }[];
  publishedYear?: string; pdfUrl?: string;
};

type StudentJson = {
  id: string;
  translations?: { languageid: number; title: string; authors?: string[]; publicationVenue?: string; category?: string; pagenam?: number }[];
  publishedYear?: string; pdfUrl?: string;
};

type HadithJson = { id: number; content: string };

type StaticPageJson = { title: string; slug: string; content: string };

type StoreJson = {
  city: string;
  sellpoints: {
    id: number;
    name: string;
    location: string;
    phone?: string;
    gps?: string;
    gpsLink?: string;
  }[];
};

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
  const existing = await (prisma[translationModel] as any).findFirst({
    where: { lang: 'ar', slug: arSlug },
  });
  if (existing) return existing.category_id as string;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cat = await (prisma[`${tablePrefix}_categories` as keyof typeof prisma] as any).create({ data: {} });
  const catId: string = cat.id;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (prisma[translationModel] as any).create({
    data: { category_id: catId, lang: 'ar', title: arName, slug: arSlug },
  });

  return catId;
}

function requireSlug(map: Record<string, string>, arName: string, kind: string): string {
  const slug = map[arName];
  if (!slug) throw new Error(`Unmapped ${kind} category "${arName}" — add it to the ${kind} slug map in seed-content.ts`);
  return slug;
}

// ── Books ─────────────────────────────────────────────────────────────────────

async function seedBooks(): Promise<void> {
  const books = loadJson<BookJson[]>('books.json');

  const catCache = new Map<string, string>();
  async function getBookCatId(arName: string): Promise<string> {
    if (catCache.has(arName)) return catCache.get(arName)!;
    const id = await findOrCreateCategory('book', arName, requireSlug(BOOK_CAT_SLUG, arName, 'book'));
    catCache.set(arName, id);
    return id;
  }

  let created = 0;
  let skipped = 0;

  for (const b of books) {
    const imageUrl = normalizeUrl(b.image ?? '');
    if (!imageUrl) { skipped++; continue; }

    // Idempotency: if a media record for this URL already has a linked book, skip
    const existingMedia = await prisma.media.findUnique({ where: { url: imageUrl } });
    if (existingMedia) {
      const existingBook = await prisma.books.findFirst({ where: { cover_image_id: existingMedia.id } });
      if (existingBook) { skipped++; continue; }
    }

    const rawCats = Array.isArray(b.category) ? b.category : b.category ? [b.category] : [];
    const primaryCat = rawCats[0]?.trim();
    if (!primaryCat) { skipped++; continue; }

    const categoryId = await getBookCatId(primaryCat);
    const mediaId = await upsertMedia(imageUrl, b.title);

    const book = await prisma.books.create({
      data: {
        category_id: categoryId,
        cover_image_id: mediaId,
        pages: b.pages != null ? (parseInt(String(b.pages), 10) || null) : null,
        publish_year: b.printDate != null ? String(b.printDate) : null,
        part_number: b.partNumber != null ? (parseInt(String(b.partNumber), 10) || null) : null,
        parts: b.totalParts != null ? (parseInt(String(b.totalParts), 10) || null) : null,
        views: BigInt(b.views ?? 0),
      },
    });

    await prisma.book_translations.create({
      data: {
        book_id: book.id,
        lang: 'ar',
        title: b.title ?? '',
        author: b.author ?? null,
        publisher: b.printHouse ?? null,
        series: b.series ?? null,
        is_default: true,
      },
    });

    created++;
  }

  console.log(`  ✓ ${created} books seeded, ${skipped} skipped`);
}

// ── Posts ─────────────────────────────────────────────────────────────────────

async function seedPosts(): Promise<void> {
  const posts = loadJson<PostJson[]>('posts.json');

  const catCache = new Map<string, string>();
  async function getPostCatId(arName: string): Promise<string> {
    if (catCache.has(arName)) return catCache.get(arName)!;
    const id = await findOrCreateCategory('post', arName, requireSlug(POST_CAT_SLUG, arName, 'post'));
    catCache.set(arName, id);
    return id;
  }

  let created = 0;
  let skipped = 0;

  for (const p of posts) {
    if (!p.slug) { skipped++; continue; }

    // Idempotency: check if a post translation with this slug already exists
    const existingTranslation = await prisma.post_translations.findFirst({
      where: { lang: 'ar', slug: p.slug },
    });
    if (existingTranslation) { skipped++; continue; }

    const catName = p.category?.trim() ?? '';
    if (!catName) { skipped++; continue; }
    const categoryId = await getPostCatId(catName);

    let coverId: string | null = null;
    if (p.image) {
      const imgUrl = normalizeUrl(p.image);
      if (imgUrl) coverId = await upsertMedia(imgUrl, p.title);
    }

    const post = await prisma.posts.create({
      data: {
        category_id: categoryId,
        cover_image_id: coverId,
        published_at: safeParseDate(p.date),
        is_published: true,
        views: BigInt(p.views ?? 0),
      },
    });

    await prisma.post_translations.create({
      data: {
        post_id: post.id,
        lang: 'ar',
        title: p.title,
        summary: p.summary ?? null,
        body: p.content,
        slug: p.slug,
        is_default: true,
      },
    });

    for (let i = 0; i < (p.attachments?.length ?? 0); i++) {
      const att = p.attachments![i];
      const attUrl = normalizeUrl(att.path);
      if (!attUrl) continue;
      const mediaId = await upsertMedia(attUrl);
      await prisma.post_attachments.upsert({
        where: { post_id_media_id: { post_id: post.id, media_id: mediaId } },
        create: { post_id: post.id, media_id: mediaId, display_order: i },
        update: {},
      });
    }

    created++;
  }

  console.log(`  ✓ ${created} posts seeded, ${skipped} skipped`);
}

// ── Gallery ───────────────────────────────────────────────────────────────────

async function seedGallery(): Promise<void> {
  const images = loadJson<GalleryJson[]>('gallery.json');

  const catCache = new Map<string, string>();
  async function getGalleryCatId(arName: string): Promise<string> {
    if (catCache.has(arName)) return catCache.get(arName)!;
    const id = await findOrCreateCategory('gallery', arName, requireSlug(GALLERY_CAT_SLUG, arName, 'gallery'));
    catCache.set(arName, id);
    return id;
  }

  let created = 0;
  let skipped = 0;

  for (const g of images) {
    const imgUrl = normalizeUrl(g.url);
    if (!imgUrl) { skipped++; continue; }

    const mediaId = await upsertMedia(imgUrl, g.name);

    const existingGalleryImage = await prisma.gallery_images.findUnique({ where: { media_id: mediaId } });
    if (existingGalleryImage) { skipped++; continue; }

    const catId = g.category?.trim() ? await getGalleryCatId(g.category.trim()) : null;

    await prisma.gallery_images.create({
      data: {
        media_id: mediaId,
        category_id: catId,
        taken_at: safeParseDate(g.date),
        author: g.photographer || null,
        tags: g.tags ?? [],
        locations: g.location ? [g.location] : [],
      },
    });

    const title = g.name ?? extractFilename(imgUrl);

    await prisma.gallery_image_translations.create({
      data: { media_id: mediaId, lang: 'ar', title, description: g.description ?? null },
    });

    created++;
  }

  console.log(`  ✓ ${created} gallery images seeded, ${skipped} skipped`);
}

// ── Academic papers ───────────────────────────────────────────────────────────

async function seedAcademicCategories(): Promise<Map<string, string>> {
  const catMap = new Map<string, string>();
  for (const c of ACADEMIC_CATS) {
    const id = await findOrCreateCategory('academic_paper', c.ar, c.ar_slug);
    catMap.set(c.key, id);
  }
  console.log(`  ✓ ${ACADEMIC_CATS.length} academic paper categories`);
  return catMap;
}

async function seedResearchPapers(categoryId: string): Promise<void> {
  const papers = loadJson<ResearchJson[]>('research.json');
  let created = 0;
  let skipped = 0;

  for (const p of papers) {
    if (p.pdfUrl) {
      const existing = await prisma.academic_papers.findFirst({ where: { pdf_url: p.pdfUrl, category_id: categoryId } });
      if (existing) { skipped++; continue; }
    }

    const paper = await prisma.academic_papers.create({
      data: { category_id: categoryId, published_year: p.publishedYear ?? null, pdf_url: p.pdfUrl ?? null },
    });

    const authors = p.author
      ? p.author.split(/[،,–-]+/).map(a => a.trim()).filter(Boolean)
      : [];

    await prisma.academic_paper_translations.create({
      data: {
        paper_id: paper.id,
        lang: 'ar',
        title: p.title ?? '',
        abstract: p.abstract ?? null,
        authors,
        keywords: [],
        publication_venue: p.conference ?? null,
        is_default: true,
      },
    });

    created++;
  }

  console.log(`  ✓ ${created} conference papers seeded, ${skipped} skipped`);
}

async function seedJournals(categoryId: string): Promise<void> {
  const journals = loadJson<JournalJson[]>('journals.json');
  let created = 0;
  let skipped = 0;

  for (const j of journals) {
    if (j.pdfUrl) {
      const existing = await prisma.academic_papers.findFirst({ where: { pdf_url: j.pdfUrl, category_id: categoryId } });
      if (existing) { skipped++; continue; }
    }

    const t = j.translations?.[0];
    const paper = await prisma.academic_papers.create({
      data: { category_id: categoryId, published_year: j.publishedYear ?? null, pdf_url: j.pdfUrl ?? null },
    });

    const arTitle = t?.title?.trim() ?? '';
    const authors = (t?.authors ?? []).filter(Boolean);

    await prisma.academic_paper_translations.create({
      data: {
        paper_id: paper.id,
        lang: 'ar',
        title: arTitle,
        abstract: null,
        authors,
        keywords: [],
        publication_venue: t?.publicationVenue ?? null,
        page_count: t?.pagenam ?? null,
        is_default: true,
      },
    });

    created++;
  }

  console.log(`  ✓ ${created} journal articles seeded, ${skipped} skipped`);
}

async function seedStudentTheses(categoryId: string): Promise<void> {
  const theses = loadJson<StudentJson[]>('student.json');
  let created = 0;
  let skipped = 0;

  for (const s of theses) {
    if (s.pdfUrl) {
      const existing = await prisma.academic_papers.findFirst({ where: { pdf_url: s.pdfUrl, category_id: categoryId } });
      if (existing) { skipped++; continue; }
    }

    const t = s.translations?.[0];
    const paper = await prisma.academic_papers.create({
      data: { category_id: categoryId, published_year: s.publishedYear ?? null, pdf_url: s.pdfUrl ?? null },
    });

    const arTitle = t?.title?.trim() ?? '';
    const authors = (t?.authors ?? []).filter(Boolean);
    const degreeLabel = t?.category ?? null; // e.g. "بكالوريوس", "دكتوراه"
    const venue = t?.publicationVenue ?? null;
    const arVenue = degreeLabel ? `${degreeLabel} — ${venue ?? ''}`.replace(/\s+/g, ' ').trim() : venue ?? null;

    await prisma.academic_paper_translations.create({
      data: {
        paper_id: paper.id,
        lang: 'ar',
        title: arTitle,
        abstract: null,
        authors,
        keywords: [],
        publication_venue: arVenue,
        page_count: t?.pagenam ?? null,
        is_default: true,
      },
    });

    created++;
  }

  console.log(`  ✓ ${created} student theses seeded, ${skipped} skipped`);
}

// ── Daily hadiths ─────────────────────────────────────────────────────────────

async function seedHadiths(): Promise<void> {
  const hadiths = loadJson<HadithJson[]>('hadiths.json');
  let created = 0;
  let skipped = 0;

  for (let i = 0; i < hadiths.length; i++) {
    const h = hadiths[i];
    const content = h.content?.trim();
    if (!content) { skipped++; continue; }

    // Idempotency: skip if any hadith already has this exact Arabic content
    const existing = await prisma.daily_hadith_translations.findFirst({
      where: { lang: 'ar', content },
    });
    if (existing) { skipped++; continue; }

    const hadith = await prisma.daily_hadiths.create({
      data: { display_order: i, is_active: true },
    });

    await prisma.daily_hadith_translations.create({
      data: { hadith_id: hadith.id, lang: 'ar', content, is_default: true },
    });

    created++;
  }

  console.log(`  ✓ ${created} hadiths seeded, ${skipped} skipped`);
}

// ── Static pages ──────────────────────────────────────────────────────────────

async function seedStaticPages(): Promise<void> {
  const pages = loadJson<StaticPageJson[]>('imamzain.json');
  let created = 0;
  let skipped = 0;

  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    if (!p.slug) { skipped++; continue; }

    // Idempotency: Arabic slug is the natural key
    const existing = await prisma.static_page_translations.findFirst({
      where: { lang: 'ar', slug: p.slug },
    });
    if (existing) { skipped++; continue; }

    const page = await prisma.static_pages.create({
      data: { display_order: i, is_published: true },
    });

    await prisma.static_page_translations.create({
      data: {
        page_id: page.id,
        lang: 'ar',
        title: p.title ?? '',
        slug: p.slug,
        body: p.content ?? '',
        is_default: true,
      },
    });

    created++;
  }

  console.log(`  ✓ ${created} static pages seeded, ${skipped} skipped`);
}

// ── Stores ────────────────────────────────────────────────────────────────────

async function seedStores(): Promise<void> {
  const stores = loadJson<StoreJson[]>('store-locations.json');
  let created = 0;
  let skipped = 0;
  let createdLocations = 0;

  for (let i = 0; i < stores.length; i++) {
    const s = stores[i];
    const cityName = s.city?.trim();
    if (!cityName) { skipped++; continue; }

    // Idempotency: skip the entire store if this Arabic city name already exists
    const existing = await prisma.store_translations.findFirst({
      where: { lang: 'ar', city_name: cityName },
    });
    if (existing) { skipped++; continue; }

    const store = await prisma.stores.create({ data: { display_order: i } });
    await prisma.store_translations.create({
      data: { store_id: store.id, lang: 'ar', city_name: cityName },
    });

    for (let j = 0; j < (s.sellpoints?.length ?? 0); j++) {
      const sp = s.sellpoints[j];
      const name = sp.name?.trim();
      if (!name) continue;

      const loc = await prisma.store_locations.create({
        data: {
          store_id: store.id,
          phone: sp.phone?.trim() || null,
          gps_embed_url: sp.gps?.trim() || null,
          gps_link: sp.gpsLink?.trim() || null,
          display_order: j,
        },
      });
      await prisma.store_location_translations.create({
        data: {
          location_id: loc.id,
          lang: 'ar',
          name,
          address: sp.location?.trim() ?? '',
        },
      });
      createdLocations++;
    }

    created++;
  }

  console.log(`  ✓ ${created} stores (${createdLocations} locations) seeded, ${skipped} skipped`);
}

// ── Audios ──────────────────────────────────────────────────────────────────
// i18n: each audio gets an `ar` audio_translation (title). Speaker is a
// first-class entity, deduped by its Arabic name (an `ar` speaker_translation).
// Idempotency key for audios: audio_url (unique) — re-running updates the
// language-agnostic analysis fields in place and never duplicates. On update we
// deliberately leave CMS-owned fields (is_published, slug, deleted_at) untouched
// so operator edits persist across re-seeds.

type AudioJson = {
  id: number;
  title: string;
  speaker: string;
  audio: string; // mp3 CDN url -> audio_url
  pdf?: string; // -> pdf_url (absent in the current export)
  durationSeconds?: number; // -> duration_seconds
  sizeMB?: number; // -> size_mb
  peaks?: number[]; // 300 floats -> peaks (jsonb)
};

// The API caps peaks at 300 (DTO ArrayMaxSize), but the seed writes through
// Prisma and bypasses that validation. Older AudioItemAnalyzed.json exports
// carry 423–1500-point arrays; block-max downsample them to ≤300 here so seeded
// rows honour the same contract the detail endpoint advertises. Arrays already
// ≤300 (the current extractor emits exactly 300) pass through untouched.
const MAX_SEED_PEAKS = 300;
function downsamplePeaks(peaks: number[] | undefined): number[] | undefined {
  if (!Array.isArray(peaks) || peaks.length === 0) return undefined;
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

/**
 * Find or create a speaker by its Arabic name. Caches within a run so the same
 * lecturer across many audios resolves to one row. Exact-name match only —
 * near-duplicate spellings produce distinct speakers an admin can merge later.
 */
async function getOrCreateSpeaker(cache: Map<string, string>, rawName: string): Promise<string | null> {
  const name = rawName?.trim();
  if (!name) return null;
  const cached = cache.get(name);
  if (cached) return cached;

  const existing = await prisma.speaker_translations.findFirst({
    where: { lang: 'ar', name, speakers: { deleted_at: null } },
    select: { speaker_id: true },
  });
  if (existing) {
    cache.set(name, existing.speaker_id);
    return existing.speaker_id;
  }

  const speaker = await prisma.speakers.create({
    data: { speaker_translations: { create: { lang: 'ar', name, is_default: true } } },
  });
  cache.set(name, speaker.id);
  return speaker.id;
}

async function seedAudios(): Promise<void> {
  const items = loadJson<AudioJson[]>('AudioItemAnalyzed.json');
  const speakerCache = new Map<string, string>();
  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const a of items) {
    if (!a.title?.trim() || !a.audio?.trim()) {
      skipped++;
      continue;
    }
    const audioUrl = normalizeUrl(a.audio);
    if (!audioUrl) {
      skipped++;
      continue;
    }

    const speakerId = await getOrCreateSpeaker(speakerCache, a.speaker);
    const title = a.title.trim();

    // Language-agnostic columns refreshed on every re-seed. audio_url is the
    // idempotency key (unique) — re-running updates in place, never duplicates.
    const analysis = {
      speaker_id: speakerId,
      pdf_url: a.pdf ? normalizeUrl(a.pdf) : null,
      duration_seconds: a.durationSeconds ?? null,
      size_mb: a.sizeMB ?? null,
      peaks: downsamplePeaks(a.peaks), // jsonb; ≤300 points (undefined => null)
    };

    const existing = await prisma.audios.findUnique({ where: { audio_url: audioUrl }, select: { id: true } });

    if (existing) {
      await prisma.audios.update({ where: { id: existing.id }, data: analysis });
      // Refresh the Arabic title but never clobber an editor-set slug.
      await prisma.audio_translations.upsert({
        where: { audio_id_lang: { audio_id: existing.id, lang: 'ar' } },
        create: { audio_id: existing.id, lang: 'ar', title, is_default: true },
        update: { title },
      });
      updated++;
    } else {
      await prisma.audios.create({
        data: {
          audio_url: audioUrl,
          is_published: true,
          ...analysis,
          audio_translations: { create: { lang: 'ar', title, is_default: true } },
        },
      });
      created++;
    }
  }

  console.log(`  ✓ ${created} audios seeded, ${updated} updated, ${skipped} skipped (${speakerCache.size} speakers)`);
}

// ── Main ──────────────────────────────────────────────────────────────────────
// Contest questions are no longer seeded by this script — operators manage the
// `qutuf_sajjadiya_contest_questions` table directly via the DB / CMS.

async function main() {
  console.log('Seeding content…\n');

  console.log('→ Books (with categories)');
  await seedBooks();

  console.log('\n→ Posts (with categories and attachments)');
  await seedPosts();

  console.log('\n→ Gallery images (with categories)');
  await seedGallery();

  console.log('\n→ Academic paper categories');
  const academicCatMap = await seedAcademicCategories();

  console.log('→ Conference research papers (research.json)');
  await seedResearchPapers(academicCatMap.get('conference')!);

  console.log('→ Journal articles (journals.json)');
  await seedJournals(academicCatMap.get('journals')!);

  console.log('→ Student theses (student.json)');
  await seedStudentTheses(academicCatMap.get('student')!);

  console.log('\n→ Daily hadiths');
  await seedHadiths();

  console.log('\n→ Static pages (imamzain.json)');
  await seedStaticPages();

  console.log('\n→ Stores (store-locations.json)');
  await seedStores();

  console.log('\n→ Audios (AudioItemAnalyzed.json)');
  await seedAudios();

  console.log('\nContent seed complete.');
}

main()
  .catch(err => {
    console.error('Content seed failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
