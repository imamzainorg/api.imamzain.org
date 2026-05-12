import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { resolveTranslation } from '../common/utils/translation.util';
import { DailyHadithsService } from '../daily-hadiths/daily-hadiths.service';
import { YoutubeService } from '../youtube/youtube.service';

const NEWS_COUNT = 4;
const PUBLICATIONS_COUNT = 10;
const GALLERY_SLIDER_COUNT = 10;
const VIDEOS_COUNT = 7;

/**
 * Composite endpoint for the public homepage. Returns exactly the shape
 * the front-end's `src/app/page.tsx` reads — every field listed here is
 * actually used by one of the homepage components. Anything the
 * underlying tables expose but the front-end doesn't render is stripped
 * server-side; the response is consequently much smaller than the
 * per-resource list endpoints and cheaper to ship through the CDN.
 *
 * All seven buckets fan out as a single Promise.all so total wall time
 * is max(individual queries). Most are indexed; the daily hadith pick
 * is cheap (max one row lookup + one rotation scan).
 *
 * The response is identical for every visitor on the same UTC date in
 * a given language, so it caches well at the CDN — see the controller
 * for the Cache-Control settings.
 */
@Injectable()
export class HomepageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly hadiths: DailyHadithsService,
    private readonly youtube: YoutubeService,
  ) {}

  async getHomepage(lang: string | null) {
    const [hadith, news, publications, videos, gallerySlider, galleryCategories] = await Promise.all([
      this.hadithOfDay(lang),
      this.news(lang),
      this.publications(lang),
      this.videos(),
      this.gallerySlider(),
      this.galleryCategories(lang),
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

  // ── Hadith ─────────────────────────────────────────────────────────────

  private async hadithOfDay(lang: string | null) {
    const res = await this.hadiths.getToday(lang);
    return res.data;
  }

  // ── News (4 most relevant published posts) ─────────────────────────────

  /**
   * Prefer up to 4 featured posts, newest first. If fewer than 4 featured
   * exist, fill the remainder with the most-recent non-featured published
   * posts so the homepage block is never short. Posts already returned as
   * featured are excluded from the fallback to avoid duplicates.
   */
  private async news(lang: string | null) {
    const featured = await this.prisma.posts.findMany({
      where: { deleted_at: null, is_published: true, is_featured: true },
      include: { post_translations: true, media: true },
      orderBy: [{ published_at: 'desc' }, { id: 'asc' }],
      take: NEWS_COUNT,
    });

    let combined = featured;
    if (featured.length < NEWS_COUNT) {
      const featuredIds = new Set(featured.map((p) => p.id));
      const fallback = await this.prisma.posts.findMany({
        where: {
          deleted_at: null,
          is_published: true,
          id: featuredIds.size > 0 ? { notIn: Array.from(featuredIds) } : undefined,
        },
        include: { post_translations: true, media: true },
        orderBy: [{ published_at: 'desc' }, { id: 'asc' }],
        take: NEWS_COUNT - featured.length,
      });
      combined = [...featured, ...fallback];
    }

    return combined.map((post) => {
      const t = resolveTranslation(post.post_translations, lang);
      return {
        slug: t?.slug ?? null,
        image: post.media?.url ?? null,
        summary: t?.summary ?? null,
        title: t?.title ?? null,
      };
    });
  }

  // ── Publications (latest 10 books) ─────────────────────────────────────

  private async publications(lang: string | null) {
    const books = await this.prisma.books.findMany({
      where: { deleted_at: null },
      include: { book_translations: true, media: true },
      orderBy: [{ created_at: 'desc' }, { id: 'asc' }],
      take: PUBLICATIONS_COUNT,
    });

    return books.map((book) => {
      const t = resolveTranslation(book.book_translations, lang);
      return {
        id: book.id,
        slug: book.id, // Books are addressed by UUID; the front-end consumes this as a slug.
        title: t?.title ?? null,
        image: book.media?.url ?? null,
        pages: book.pages,
        views: Number(book.views),
      };
    });
  }

  // ── Videos (most recent 7 from local mirror) ───────────────────────────

  /**
   * Reads from the local YouTube mirror so the homepage stays fast and
   * survives YouTube outages. The mirror is refreshed every 6 hours by
   * `YoutubeSyncService`. Front-end-friendly field shape: `url` is the
   * 11-char video ID (front-end builds the embed URL itself), `date` is
   * ISO 8601, `desc` is the description first sentence-ish, capped.
   */
  private async videos() {
    const rows = await this.youtube.findRecentVideos(VIDEOS_COUNT);
    return rows.map((v) => ({
      title: v.title,
      url: v.video_id,
      desc: shortenDescription(v.description),
      thumbnail: v.thumbnail_url,
      date: v.published_at?.toISOString() ?? null,
    }));
  }

  // ── Gallery slider (latest 10 gallery images) ──────────────────────────

  private async gallerySlider() {
    const images = await this.prisma.gallery_images.findMany({
      where: { deleted_at: null },
      include: { media: true },
      orderBy: [{ created_at: 'desc' }, { media_id: 'asc' }],
      take: GALLERY_SLIDER_COUNT,
    });

    return images.map((img) => ({
      id: img.media_id,
      path: img.media?.url ?? null,
    }));
  }

  // ── Gallery categories (all, slim) ─────────────────────────────────────

  private async galleryCategories(lang: string | null) {
    const categories = await this.prisma.gallery_categories.findMany({
      where: { deleted_at: null },
      include: { gallery_category_translations: true },
      orderBy: { created_at: 'asc' },
    });

    return categories.map((cat) => {
      const t = resolveTranslation(cat.gallery_category_translations, lang);
      return {
        id: cat.id,
        name: t?.title ?? null,
      };
    });
  }
}

function shortenDescription(description: string | null | undefined, max = 280): string | null {
  if (!description) return null;
  const trimmed = description.replace(/\s+/g, ' ').trim();
  if (trimmed.length <= max) return trimmed;
  return trimmed.slice(0, max - 1).trimEnd() + '…';
}
