import type { Context } from 'hono';
import { getDb } from '../../lib/db';
import { loadActiveLanguages, resolveTranslation } from '../../lib/i18n';
import { MEDIA_URL_WITH_VARIANTS_SELECT } from '../../lib/media-selects';
import type { AppEnv } from '../../lib/types';
import { getToday } from '../daily-hadiths/service';
import { findRecentVideos } from '../youtube/service';

type Ctx = Context<AppEnv>;
type Active = ReadonlySet<string>;

const NEWS_COUNT = 4;
const PUBLICATIONS_COUNT = 10;
const GALLERY_SLIDER_COUNT = 10;
const VIDEOS_COUNT = 7;

// An item whose only translation is in a retired language has nothing to show; it is left out in
// the query (not after it) so the block stays full.
const HAS_LIVE_LANGUAGE = { languages: { is_active: true, deleted_at: null } };

/**
 * The public homepage's composite payload: exactly the fields the site's components render, every
 * image with its `<field>_variants` renditions. Identical for every visitor on the same site day and
 * language, so it is CDN-cacheable (see routes).
 */
export async function getHomepage(c: Ctx, lang: string | null) {
  const active = await loadActiveLanguages(getDb(c));
  const [hadith, news, publications, videos, gallerySlider, galleryCategories] = await Promise.all([
    getToday(c, lang).then((res) => res.data),
    getNews(c, lang, active),
    getPublications(c, lang, active),
    getVideos(c),
    getGallerySlider(c),
    getGalleryCategories(c, lang, active),
  ]);

  return {
    message: 'Homepage fetched',
    data: {
      hadith_of_day: hadith,
      news,
      publications,
      videos,
      gallery: { slider: gallerySlider, categories: galleryCategories },
    },
  };
}

/** Up to 4 posts, featured first then newest: one query yields the featured-then-recent fill. */
async function getNews(c: Ctx, lang: string | null, active: Active) {
  const posts = await getDb(c).posts.findMany({
    where: { deleted_at: null, is_published: true, post_translations: { some: HAS_LIVE_LANGUAGE } },
    select: {
      slug: true,
      // Not the heavy body: the mapper only needs these.
      post_translations: { select: { lang: true, is_default: true, summary: true, title: true } },
      media: { select: MEDIA_URL_WITH_VARIANTS_SELECT },
    },
    orderBy: [{ is_featured: 'desc' }, { published_at: 'desc' }, { id: 'asc' }],
    take: NEWS_COUNT,
  });

  return posts.map((post) => {
    const t = resolveTranslation(post.post_translations, lang, { active });
    return {
      slug: post.slug ?? null,
      image: post.media?.url ?? null,
      image_variants: post.media?.media_variants ?? [],
      summary: t?.summary ?? null,
      title: t?.title ?? null,
    };
  });
}

async function getPublications(c: Ctx, lang: string | null, active: Active) {
  const books = await getDb(c).books.findMany({
    // Parts are hidden: a 12-part series must not fill "latest 10" with one title.
    where: {
      deleted_at: null,
      is_published: true,
      parent_id: null,
      book_translations: { some: HAS_LIVE_LANGUAGE },
    },
    select: {
      id: true,
      slug: true,
      pages: true,
      views: true,
      book_translations: { select: { lang: true, is_default: true, title: true } },
      media: { select: MEDIA_URL_WITH_VARIANTS_SELECT },
    },
    orderBy: [{ created_at: 'desc' }, { id: 'asc' }],
    take: PUBLICATIONS_COUNT,
  });

  return books.map((book) => {
    const t = resolveTranslation(book.book_translations, lang, { active });
    return {
      id: book.id,
      // The editor slug for a friendly URL; the UUID for books without one.
      slug: book.slug ?? book.id,
      title: t?.title ?? null,
      image: book.media?.url ?? null,
      image_variants: book.media?.media_variants ?? [],
      pages: book.pages,
      views: Number(book.views),
    };
  });
}

/** From the local YouTube mirror, so the homepage survives YouTube outages. `url` is the 11-char video id. */
async function getVideos(c: Ctx) {
  const rows = await findRecentVideos(c, VIDEOS_COUNT);
  return rows.map((v) => ({
    title: v.title,
    url: v.video_id,
    desc: shortenDescription(v.description),
    thumbnail: v.thumbnail_url,
    date: v.published_at?.toISOString() ?? null,
  }));
}

async function getGallerySlider(c: Ctx) {
  const images = await getDb(c).gallery_images.findMany({
    where: { deleted_at: null, is_published: true },
    include: { media: { select: MEDIA_URL_WITH_VARIANTS_SELECT } },
    orderBy: [{ created_at: 'desc' }, { media_id: 'asc' }],
    take: GALLERY_SLIDER_COUNT,
  });

  return images.map((img) => ({
    id: img.media_id,
    path: img.media?.url ?? null,
    path_variants: img.media?.media_variants ?? [],
  }));
}

async function getGalleryCategories(c: Ctx, lang: string | null, active: Active) {
  const categories = await getDb(c).gallery_categories.findMany({
    where: { deleted_at: null, gallery_category_translations: { some: HAS_LIVE_LANGUAGE } },
    // No is_default column on this translation table: resolveTranslation falls back to the site language.
    include: { gallery_category_translations: { select: { lang: true, title: true } } },
    orderBy: { created_at: 'asc' },
  });

  return categories.map((cat) => ({
    id: cat.id,
    name: resolveTranslation(cat.gallery_category_translations, lang, { active })?.title ?? null,
  }));
}

function shortenDescription(description: string | null | undefined, max = 280): string | null {
  if (!description) return null;
  const trimmed = description.replace(/\s+/g, ' ').trim();
  if (trimmed.length <= max) return trimmed;
  return trimmed.slice(0, max - 1).trimEnd() + '…';
}
