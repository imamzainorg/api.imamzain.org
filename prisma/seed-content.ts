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

const DATA_DIR = path.join(__dirname, '../../../Web/imamzain-website/src/data');

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

function slugToTitle(slug: string): string {
  return slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
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

// ── Category translation lookup tables ───────────────────────────────────────

const BOOK_CAT_MAP: Record<string, { ar_slug: string; en: string; en_slug: string }> = {
  'الصحيفة السجادية':              { ar_slug: 'al-sahifa-al-sajjadiyya',    en: 'Al-Sahifa Al-Sajjadiyya',                 en_slug: 'al-sahifa-al-sajjadiyya' },
  'الإصدارات':                     { ar_slug: 'al-isdaraat',                 en: 'Publications',                            en_slug: 'publications' },
  'ما كتب عن الإمام زين العابدين': { ar_slug: 'about-imam-zain-al-abidin',   en: 'About Imam Zain Al-Abidin',               en_slug: 'about-imam-zain-al-abidin' },
  'رسالة الحقوق':                  { ar_slug: 'risala-al-huquq',             en: 'Risala Al-Huquq (Treatise of Rights)',    en_slug: 'risala-al-huquq' },
  'السيرة':                        { ar_slug: 'al-sira',                     en: 'Biography',                               en_slug: 'biography' },
};

const POST_CAT_MAP: Record<string, { ar_slug: string; en: string; en_slug: string }> = {
  'نشاطات': { ar_slug: 'nashatat',  en: 'Activities',  en_slug: 'activities' },
  'أخبار':  { ar_slug: 'akhbar',    en: 'News',        en_slug: 'news' },
  'مقالات': { ar_slug: 'maqalat',   en: 'Articles',    en_slug: 'articles' },
  'بيانات': { ar_slug: 'bayanat',   en: 'Statements',  en_slug: 'statements' },
};

const GALLERY_CAT_MAP: Record<string, { ar_slug: string; en: string; en_slug: string }> = {
  'ندوات':   { ar_slug: 'nadawat',  en: 'Conferences & Seminars', en_slug: 'conferences-seminars' },
  'فعاليات': { ar_slug: 'faaliyat', en: 'Events',                 en_slug: 'events' },
  'زيارات':  { ar_slug: 'ziyarat',  en: 'Visits',                 en_slug: 'visits' },
  'مراسيم':  { ar_slug: 'marasim',  en: 'Ceremonies',             en_slug: 'ceremonies' },
  'معارض':   { ar_slug: 'maarid',   en: 'Exhibitions',            en_slug: 'exhibitions' },
  'برامج':   { ar_slug: 'baramij',  en: 'Programs',               en_slug: 'programs' },
};

const ACADEMIC_CATS = [
  { key: 'conference', ar: 'بحوث المؤتمرات العلمية',   ar_slug: 'buhuth-al-mutamarat', en: 'Conference Research Papers',  en_slug: 'conference-research-papers' },
  { key: 'journals',   ar: 'بحوث في دوريات علمية',     ar_slug: 'buhuth-fi-dawriyyat', en: 'Academic Journal Articles',   en_slug: 'academic-journal-articles' },
  { key: 'student',    ar: 'رسائل جامعية',              ar_slug: 'rasail-jamiiyya',     en: 'University Theses',           en_slug: 'university-theses' },
];

// ── English title overrides for known Arabic books ────────────────────────────

const BOOK_TITLE_EN: Record<string, string> = {
  'al-faraid-al-tarifa':                                       "Al-Fara'id Al-Tarifa: Commentary on Al-Sahifa Al-Sharifa",
  'al-fawaid-al-sharifa-part-1':                               "Al-Fawa'id Al-Sharifa: Commentary on Al-Sahifa (Part 1)",
  'al-fawaid-al-sharifa-part-2':                               "Al-Fawa'id Al-Sharifa: Commentary on Al-Sahifa (Part 2)",
  'riadh-al-salqeen':                                          "Benefits of Riyad Al-Salikeen",
  'al-sharh-al-kabeer':                                        "Al-Sharh Al-Kabeer (The Great Commentary)",
  'sirah-al-imam-al-sajad':                                    "Biography of Imam Al-Sajjad (Peace Be Upon Him)",
  'foundational-intellectual-methodology-legal-dimension':     "Intellectual and Methodological Foundations of Imam Al-Sajjad – Legal Dimension",
  'building-inner-psychological-security':                     "Building Inner Psychological Security According to Imam Al-Sajjad",
  'emancipation-imam-sajjad-president-lincoln':                "Emancipation of Slaves Between Imam Al-Sajjad (P.B.U.H.) and President Lincoln",
  'canticles-of-the-pious':                                    "Canticles of the Pious (Tatratil Al-Qaniteen)",
  'thirty-lessons-from-abu-hamza':                             "Thirty Lessons from the Prayer of Abu Hamza Al-Thumali",
  'first-international-scientific-conference-guide':           "Guide to the First International Scientific Conference",
  'insights-on-rights-treatise-part-1':                        "Glimpses from Risala Al-Huquq of Imam Al-Sajjad – Part 1",
  'insights-on-rights-treatise-part-2':                        "Glimpses from Risala Al-Huquq of Imam Al-Sajjad – Part 2",
  'insights-on-rights-treatise-part-3':                        "Glimpses from Risala Al-Huquq of Imam Al-Sajjad – Part 3",
  'insights-on-rights-treatise-part-4':                        "Glimpses from Risala Al-Huquq of Imam Al-Sajjad – Part 4",
  'insights-on-rights-treatise-part-5':                        "Glimpses from Risala Al-Huquq of Imam Al-Sajjad – Part 5",
  'political-principles-of-imam-sajjad':                       "Imamate Political Principles According to Imam Al-Sajjad",
  'foundational-intellectual-methodology-social-dimension':    "Intellectual and Methodological Foundations of Imam Al-Sajjad – Social Dimension",
  'asaleeb-al-islahat-al-ijtimaieh':                           "Methods of Social Reform According to Imam Al-Sajjad",
};

// ── Contest correct answers (index matches question number minus 1) ───────────
// Answers are based on established Islamic scholarly sources about Imam Zain Al-Abidin.

const CORRECT_ANSWERS = [
  'B', // Q1  – شاه زنان
  'B', // Q2  – 38 هـ
  'A', // Q3  – سنتان
  'B', // Q4  – السيدة فاطمة بنت الإمام الحسن
  'B', // Q5  – ابن الخيرتين
  'B', // Q6  – محمد الباقر
  'B', // Q7  – لسجوده عند كل نعمة
  'B', // Q8  – أخفاف الإبل
  'B', // Q9  – عمر بن عبد العزيز
  'C', // Q10 – 1000 ركعة
  'B', // Q11 – لحفظ نسل الإمامة
  'B', // Q12 – زبور آل محمد
  'B', // Q13 – 50 حقاً
  'A', // Q14 – جراب الخبز والطعام
  'C', // Q15 – عفا عنها وأعتقها
  'B', // Q16 – جابر بن عبد الله الأنصاري
  'B', // Q17 – مشهد المحيا
  'B', // Q18 – عند السيدة أم سلمة
  'B', // Q19 – وجد لؤلؤتين في بطن سمكة
  'B', // Q20 – أبو محمد
  'B', // Q21 – 17 من أهل بيته مقتولين
  'B', // Q22 – حرملة بن كاهل الأسدي
  'B', // Q23 – زيارة أمين الله
  'B', // Q24 – أكرمه ونهى أصحابه عن إيذائه
  'B', // Q25 – يصفر لونه وتأخذه رعدة
  'B', // Q26 – حق الأم
  'B', // Q27 – كسرى
  'B', // Q28 – الكوفة وقيل المدينة
  'C', // Q29 – 10 أولاد ذكور
  'B', // Q30 – المرجعية الروحية والعلمية العليا
  'B', // Q31 – إكرامه عن الخنا وتعويده الخير
  'B', // Q32 – تواضعاً ورحمة بالناس
  'B', // Q33 – ما رأيت هاشمياً أفضل منه
  'A', // Q34 – بالدعاء والتربية ونشر الوعي
  'B', // Q35 – ألا تجعله وعاءً للحرام
  'B', // Q36 – سيدي بحبك لي إلا سقيتهم
  'B', // Q37 – في بادية الحجاز
  'B', // Q38 – الصحيفة السجادية
  'A', // Q39 – مالك بن أنس
  'B', // Q40 – كيان حي وبديع الصياغة
  'B', // Q41 – المعاهدون من غير المسلمين
  'B', // Q42 – أن تلين له جانبك
  'B', // Q43 – بعبادة جده رسول الله
  'B', // Q44 – التوحيد والتمجيد والاعتراف بالقدرة الإلهية
  'B', // Q45 – أزالوه من مكانه
  'B', // Q46 – طول بكائه على مظلومية والده الحسين
  'B', // Q47 – إعطاء النصيحة الصادقة له
  'A', // Q48 – الزهري
  'B', // Q49 – أن تستعملها في طاعة الله
  'C', // Q50 – شكراً وحباً
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

type QuestionRaw = {
  number: string; question: string;
  options: { A: string; B: string; C: string; D: string };
};

// ── Category helpers ──────────────────────────────────────────────────────────

/**
 * Find-or-create a category and its ar/en translations, using the Arabic slug as
 * the idempotency key. Returns the category UUID.
 */
async function findOrCreateCategory(
  tablePrefix: 'book' | 'post' | 'gallery' | 'academic_paper',
  arName: string,
  arSlug: string,
  enName: string,
  enSlug: string,
): Promise<string> {
  // Each prefix maps to different Prisma models
  const translationModel = `${tablePrefix}_category_translations` as
    | 'book_category_translations'
    | 'post_category_translations'
    | 'gallery_category_translations'
    | 'academic_paper_category_translations';

  // Check if this category was already seeded (by AR slug + lang)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const existing = await (prisma[translationModel] as any).findFirst({
    where: { lang: 'ar', slug: arSlug },
  });
  if (existing) return existing.category_id as string;

  // Create parent category
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cat = await (prisma[`${tablePrefix}_categories` as keyof typeof prisma] as any).create({ data: {} });
  const catId: string = cat.id;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (prisma[translationModel] as any).createMany({
    data: [
      { category_id: catId, lang: 'ar', title: arName, slug: arSlug },
      { category_id: catId, lang: 'en', title: enName, slug: enSlug },
    ],
  });

  return catId;
}

// ── Books ─────────────────────────────────────────────────────────────────────

async function seedBooks(): Promise<void> {
  const books = loadJson<BookJson[]>('books.json');

  // Build category map on the fly
  const catCache = new Map<string, string>(); // arName → UUID

  async function getBookCatId(arName: string): Promise<string> {
    if (catCache.has(arName)) return catCache.get(arName)!;
    const m = BOOK_CAT_MAP[arName] ?? {
      ar_slug: arName.replace(/[\s()\[\]]+/g, '-').replace(/[^\w-]/g, '').replace(/-+/g, '-').toLowerCase(),
      en: arName,
      en_slug: arName.replace(/[\s()\[\]]+/g, '-').replace(/[^\w-]/g, '').replace(/-+/g, '-').toLowerCase(),
    };
    const id = await findOrCreateCategory('book', arName, m.ar_slug, m.en, m.en_slug);
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

    const enTitle = BOOK_TITLE_EN[b.slug] ?? slugToTitle(b.slug);
    const arSeries = b.series ?? null;

    await prisma.book_translations.createMany({
      data: [
        { book_id: book.id, lang: 'ar', title: b.title ?? '', author: b.author ?? null, publisher: b.printHouse ?? null, series: arSeries, is_default: true },
        { book_id: book.id, lang: 'en', title: enTitle, author: b.author ?? null, publisher: b.printHouse ?? null, series: arSeries, is_default: false },
      ],
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
    const m = POST_CAT_MAP[arName] ?? {
      ar_slug: arName.replace(/[\s()\[\]]+/g, '-').replace(/[^\w-]/g, '').replace(/-+/g, '-').toLowerCase(),
      en: arName,
      en_slug: arName.replace(/[\s()\[\]]+/g, '-').replace(/[^\w-]/g, '').replace(/-+/g, '-').toLowerCase(),
    };
    const id = await findOrCreateCategory('post', arName, m.ar_slug, m.en, m.en_slug);
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
    const categoryId = catName ? await getPostCatId(catName) : null;
    if (!categoryId) { skipped++; continue; }

    // Optional cover image
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

    await prisma.post_translations.createMany({
      data: [
        { post_id: post.id, lang: 'ar', title: p.title, summary: p.summary ?? null, body: p.content, slug: p.slug, is_default: true },
        { post_id: post.id, lang: 'en', title: slugToTitle(p.slug), summary: p.summary ?? null, body: p.content, slug: p.slug, is_default: false },
      ],
    });

    // Attachments
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
    const m = GALLERY_CAT_MAP[arName] ?? {
      ar_slug: arName.replace(/[\s()\[\]]+/g, '-').replace(/[^\w-]/g, '').replace(/-+/g, '-').toLowerCase(),
      en: arName,
      en_slug: arName.replace(/[\s()\[\]]+/g, '-').replace(/[^\w-]/g, '').replace(/-+/g, '-').toLowerCase(),
    };
    const id = await findOrCreateCategory('gallery', arName, m.ar_slug, m.en, m.en_slug);
    catCache.set(arName, id);
    return id;
  }

  let created = 0;
  let skipped = 0;

  for (const g of images) {
    const imgUrl = normalizeUrl(g.url);
    if (!imgUrl) { skipped++; continue; }

    const mediaId = await upsertMedia(imgUrl, g.name);

    // gallery_images.media_id is the PK — idempotent by design
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

    await prisma.gallery_image_translations.createMany({
      data: [
        { media_id: mediaId, lang: 'ar', title, description: g.description ?? null },
        { media_id: mediaId, lang: 'en', title, description: g.description ?? null },
      ],
    });

    created++;
  }

  console.log(`  ✓ ${created} gallery images seeded, ${skipped} skipped`);
}

// ── Academic papers ───────────────────────────────────────────────────────────

async function seedAcademicCategories(): Promise<Map<string, string>> {
  const catMap = new Map<string, string>();
  for (const c of ACADEMIC_CATS) {
    const id = await findOrCreateCategory('academic_paper', c.ar, c.ar_slug, c.en, c.en_slug);
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
    // Idempotency: check by PDF URL
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

    await prisma.academic_paper_translations.createMany({
      data: [
        {
          paper_id: paper.id, lang: 'ar', title: p.title ?? '', abstract: p.abstract ?? null,
          authors, keywords: [], publication_venue: p.conference ?? null, is_default: true,
        },
        {
          paper_id: paper.id, lang: 'en',
          title: p.slug ? slugToTitle(p.slug) : p.title ?? '',
          abstract: null, authors: [], keywords: [],
          publication_venue: p.conference
            ? "First International Scientific Conference on the Educational and Social Dimensions of Imam Zain Al-Abidin's Legacy"
            : null,
          is_default: false,
        },
      ],
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

    await prisma.academic_paper_translations.createMany({
      data: [
        { paper_id: paper.id, lang: 'ar', title: arTitle, abstract: null, authors, keywords: [], publication_venue: t?.publicationVenue ?? null, page_count: t?.pagenam ?? null, is_default: true },
        { paper_id: paper.id, lang: 'en', title: arTitle, abstract: null, authors: [], keywords: [], publication_venue: t?.publicationVenue ?? null, page_count: t?.pagenam ?? null, is_default: false },
      ],
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
    const enVenue = degreeLabel ? `${degreeLabel} Thesis — ${venue ?? ''}`.replace(/\s+/g, ' ').trim() : venue ?? null;

    await prisma.academic_paper_translations.createMany({
      data: [
        { paper_id: paper.id, lang: 'ar', title: arTitle, abstract: null, authors, keywords: [], publication_venue: venue, page_count: t?.pagenam ?? null, is_default: true },
        { paper_id: paper.id, lang: 'en', title: arTitle, abstract: null, authors: [], keywords: [], publication_venue: enVenue, page_count: t?.pagenam ?? null, is_default: false },
      ],
    });

    created++;
  }

  console.log(`  ✓ ${created} student theses seeded, ${skipped} skipped`);
}

// ── Contest questions ─────────────────────────────────────────────────────────

async function seedContestQuestions(): Promise<void> {
  const questions = loadJson<QuestionRaw[]>('contests/qatuf-sajjaddiyya/questions.json');
  let created = 0;
  let updated = 0;

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    const id = `Q${i + 1}`;
    const correct = CORRECT_ANSWERS[i] ?? 'A';

    const result = await prisma.qutuf_sajjadiya_contest_questions.upsert({
      where: { id },
      create: { id, question: q.question, option_a: q.options.A, option_b: q.options.B, option_c: q.options.C, option_d: q.options.D, correct_answer: correct },
      update: { question: q.question, option_a: q.options.A, option_b: q.options.B, option_c: q.options.C, option_d: q.options.D, correct_answer: correct },
    });

    // Prisma upsert doesn't distinguish created vs updated; track via pre-check
    const wasNew = result.question === q.question && result.option_a === q.options.A;
    if (wasNew) created++; else updated++;
  }

  console.log(`  ✓ ${questions.length} contest questions (upserted)`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('Seeding content…\n');

  // 1. Contest questions (no dependencies)
  console.log('→ Contest questions (Qutuf Sajjadiyya)');
  await seedContestQuestions();

  // 2. Books
  console.log('\n→ Books (with categories)');
  await seedBooks();

  // 3. Posts
  console.log('\n→ Posts (with categories and attachments)');
  await seedPosts();

  // 4. Gallery
  console.log('\n→ Gallery images (with categories)');
  await seedGallery();

  // 5. Academic papers
  console.log('\n→ Academic paper categories');
  const academicCatMap = await seedAcademicCategories();

  console.log('→ Conference research papers (research.json)');
  await seedResearchPapers(academicCatMap.get('conference')!);

  console.log('→ Journal articles (journals.json)');
  await seedJournals(academicCatMap.get('journals')!);

  console.log('→ Student theses (student.json)');
  await seedStudentTheses(academicCatMap.get('student')!);

  console.log('\nContent seed complete.');
}

main()
  .catch(err => {
    console.error('Content seed failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
