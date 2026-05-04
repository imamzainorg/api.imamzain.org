/**
 * Diagnostic script — reports which items from the source JSON files
 * were skipped during seeding, and why.
 *
 * Usage:
 *   ts-node -P tsconfig.base.json prisma/seed-diagnose.ts
 */

import { PrismaClient } from '@prisma/client';
import * as path from 'path';
import * as fs from 'fs';

const prisma = new PrismaClient();
const DATA_DIR = path.join(__dirname, '../../../Web/imamzain-website/src/data');

function loadJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf-8')) as T;
}

function normalizeUrl(url: string): string {
  if (!url?.trim()) return '';
  const u = url.trim();
  if (u.startsWith('http')) return u;
  if (u.startsWith('//')) return `https:${u}`;
  if (u.startsWith('/')) return `https://cdn.imamzain.org${u}`;
  return `https://cdn.imamzain.org/${u}`;
}

type BookJson   = { id: number; slug: string; title?: string; image?: string; category?: string | string[]; printDate?: string | number; pages?: string | number };
type PostJson   = { id: number; slug: string; title?: string; category?: string };
type GalleryJson = { id: number; url: string; name?: string };
type JournalJson = { id: string; pdfUrl?: string; translations?: { title?: string }[] };

async function diagnoseBooks() {
  const books = loadJson<BookJson[]>('books.json');
  console.log(`\n── Books (${books.length} total) ─────────────────────────`);

  const noImage: typeof books = [];
  const noCat:   typeof books = [];
  const already: typeof books = [];

  for (const b of books) {
    const imageUrl = normalizeUrl(b.image ?? '');
    if (!imageUrl) { noImage.push(b); continue; }

    const rawCats = Array.isArray(b.category) ? b.category : b.category ? [b.category] : [];
    if (!rawCats[0]?.trim()) { noCat.push(b); continue; }

    // Check DB
    const existingMedia = await prisma.media.findUnique({ where: { url: imageUrl } });
    if (existingMedia) {
      const existingBook = await prisma.books.findFirst({ where: { cover_image_id: existingMedia.id } });
      if (existingBook) { already.push(b); continue; }
    }
  }

  const total = noImage.length + noCat.length + already.length;
  console.log(`  Skipped: ${total}`);

  if (noImage.length) {
    console.log(`\n  No image URL (${noImage.length}):`);
    noImage.forEach(b => console.log(`    [id=${b.id}] ${b.title ?? b.slug}`));
  }
  if (noCat.length) {
    console.log(`\n  No category (${noCat.length}):`);
    noCat.forEach(b => console.log(`    [id=${b.id}] ${b.title ?? b.slug}`));
  }
  if (already.length) {
    console.log(`\n  Already in DB (${already.length}):`);
    already.forEach(b => console.log(`    [id=${b.id}] ${b.title ?? b.slug}`));
  }
  if (total === 0) console.log('  None — all books accounted for.');
}

async function diagnosePosts() {
  const posts = loadJson<PostJson[]>('posts.json');
  console.log(`\n── Posts (${posts.length} total) ─────────────────────────`);

  const noSlug:    typeof posts = [];
  const noCat:     typeof posts = [];
  const already:   typeof posts = [];

  for (const p of posts) {
    if (!p.slug) { noSlug.push(p); continue; }

    const existing = await prisma.post_translations.findFirst({ where: { lang: 'ar', slug: p.slug } });
    if (existing) { already.push(p); continue; }

    if (!p.category?.trim()) { noCat.push(p); continue; }
  }

  const total = noSlug.length + noCat.length + already.length;
  console.log(`  Skipped: ${total}`);

  if (noSlug.length) {
    console.log(`\n  No slug (${noSlug.length}):`);
    noSlug.forEach(p => console.log(`    [id=${p.id}] ${p.title ?? '(no title)'}`));
  }
  if (noCat.length) {
    console.log(`\n  No category (${noCat.length}):`);
    noCat.forEach(p => console.log(`    [id=${p.id}] slug="${p.slug}"`));
  }
  if (already.length) {
    console.log(`\n  Already in DB (${already.length}):`);
    already.forEach(p => console.log(`    [id=${p.id}] slug="${p.slug}"`));
  }
  if (total === 0) console.log('  None — all posts accounted for.');
}

async function diagnoseGallery() {
  const images = loadJson<GalleryJson[]>('gallery.json');
  console.log(`\n── Gallery (${images.length} total) ──────────────────────`);

  const noUrl:   typeof images = [];
  const already: typeof images = [];

  for (const g of images) {
    const imgUrl = normalizeUrl(g.url);
    if (!imgUrl) { noUrl.push(g); continue; }

    const media = await prisma.media.findUnique({ where: { url: imgUrl } });
    if (media) {
      const gi = await prisma.gallery_images.findUnique({ where: { media_id: media.id } });
      if (gi) { already.push(g); continue; }
    }
  }

  const total = noUrl.length + already.length;
  console.log(`  Skipped: ${total}`);

  if (noUrl.length) {
    console.log(`\n  No URL (${noUrl.length}):`);
    noUrl.forEach(g => console.log(`    [id=${g.id}] ${g.name ?? '(no name)'}`));
  }
  if (already.length) {
    console.log(`\n  Already in DB (${already.length}):`);
    already.forEach(g => console.log(`    [id=${g.id}] ${g.url}`));
  }
  if (total === 0) console.log('  None — all gallery images accounted for.');
}

async function diagnoseJournals() {
  const journals = loadJson<JournalJson[]>('journals.json');
  console.log(`\n── Journals (${journals.length} total) ───────────────────`);

  // Find academic paper category for journals
  const catTranslation = await prisma.academic_paper_category_translations.findFirst({
    where: { lang: 'en', slug: 'academic-journal-articles' },
  });
  if (!catTranslation) { console.log('  ⚠ Journals category not found in DB'); return; }

  const noPdf:   typeof journals = [];
  const already: typeof journals = [];

  for (const j of journals) {
    if (!j.pdfUrl) { noPdf.push(j); continue; }
    const existing = await prisma.academic_papers.findFirst({
      where: { pdf_url: j.pdfUrl, category_id: catTranslation.category_id },
    });
    if (existing) { already.push(j); continue; }
  }

  const total = noPdf.length + already.length;
  console.log(`  Skipped: ${total}`);

  if (noPdf.length) {
    console.log(`\n  No PDF URL (${noPdf.length}):`);
    noPdf.forEach(j => console.log(`    [id=${j.id}] ${j.translations?.[0]?.title ?? '(no title)'}`));
  }
  if (already.length) {
    console.log(`\n  Already in DB (${already.length}):`);
    already.forEach(j => console.log(`    [id=${j.id}] ${j.pdfUrl}`));
  }
  if (total === 0) console.log('  None — all journals accounted for.');
}

async function main() {
  console.log('Diagnosing skipped seed items…');
  await diagnoseBooks();
  await diagnosePosts();
  await diagnoseGallery();
  await diagnoseJournals();
  console.log('\nDone.');
}

main()
  .catch(err => { console.error(err); process.exit(1); })
  .finally(() => prisma.$disconnect());
