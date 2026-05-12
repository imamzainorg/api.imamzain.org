import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { readingTimeMinutes } from '../common/utils/reading-time.util';
import { resolveTranslation } from '../common/utils/translation.util';

const DEFAULT_FEATURED_LIMIT = 5;
const DEFAULT_POPULAR_LIMIT = 5;
const DEFAULT_RECENT_LIMIT = 10;
const MAX_LIMIT_PER_BUCKET = 20;

type HomepageQuery = {
  featured_limit?: number;
  popular_limit?: number;
  recent_limit?: number;
};

/**
 * Composite endpoint for the public homepage. Replaces the previous
 * fan-out where the front-end had to call `/posts?featured=true`,
 * `/posts?sort=views`, and `/posts?sort=newest` separately — three
 * separate origin requests on the most-trafficked route on the site.
 *
 * Three buckets run in parallel as a single Promise.all so total wall
 * time is max(individual query), not the sum. Card shape is
 * deliberately slim — no body, no attachments — because homepage cards
 * never render the body.
 *
 * Response is CDN-cacheable via the controller's @PublicCache(60),
 * so under normal traffic the database is hit at most once per minute
 * per language per CDN edge.
 */
@Injectable()
export class HomepageService {
  constructor(private readonly prisma: PrismaService) {}

  async getHomepage(query: HomepageQuery, lang: string | null) {
    const featuredLimit = clamp(query.featured_limit, DEFAULT_FEATURED_LIMIT);
    const popularLimit = clamp(query.popular_limit, DEFAULT_POPULAR_LIMIT);
    const recentLimit = clamp(query.recent_limit, DEFAULT_RECENT_LIMIT);

    const baseWhere = { deleted_at: null, is_published: true };
    const include = {
      post_translations: {
        select: {
          lang: true,
          title: true,
          summary: true,
          slug: true,
          is_default: true,
          meta_title: true,
          meta_description: true,
        },
      },
      post_categories: {
        include: { post_category_translations: { select: { lang: true, title: true, slug: true } } },
      },
      media: true,
    } as const;

    const [featured, popular, recent] = await Promise.all([
      featuredLimit > 0
        ? this.prisma.posts.findMany({
            where: { ...baseWhere, is_featured: true },
            include,
            orderBy: [{ published_at: 'desc' }, { id: 'asc' }],
            take: featuredLimit,
          })
        : Promise.resolve([]),
      popularLimit > 0
        ? this.prisma.posts.findMany({
            where: baseWhere,
            include,
            orderBy: [{ views: 'desc' }, { id: 'asc' }],
            take: popularLimit,
          })
        : Promise.resolve([]),
      recentLimit > 0
        ? this.prisma.posts.findMany({
            where: baseWhere,
            include,
            orderBy: [{ published_at: 'desc' }, { created_at: 'desc' }, { id: 'asc' }],
            take: recentLimit,
          })
        : Promise.resolve([]),
    ]);

    return {
      message: 'Homepage fetched',
      data: {
        featured: featured.map((p) => slim(p, lang)),
        popular: popular.map((p) => slim(p, lang)),
        recent: recent.map((p) => slim(p, lang)),
      },
    };
  }
}

function clamp(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value) || value < 0) return fallback;
  return Math.min(value, MAX_LIMIT_PER_BUCKET);
}

/**
 * Reduce a post row to the shape a homepage card needs. We strip the body
 * out — homepage cards never render the body — but keep enough for the
 * translation fallback, cover image, and a server-computed read time on
 * each translation. The reading time is derived from `summary` here since
 * the body isn't fetched; cards typically show summary alongside the
 * minute estimate anyway.
 */
function slim(post: any, lang: string | null) {
  const decoratedTranslations = post.post_translations.map((t: any) => ({
    lang: t.lang,
    title: t.title,
    summary: t.summary,
    slug: t.slug,
    is_default: t.is_default,
    meta_title: t.meta_title,
    meta_description: t.meta_description,
    reading_time_minutes: readingTimeMinutes(t.summary ?? ''),
  }));
  return {
    id: post.id,
    category_id: post.category_id,
    is_featured: post.is_featured,
    published_at: post.published_at,
    views: post.views,
    cover_image: post.media
      ? { id: post.media.id, url: post.media.url, alt_text: post.media.alt_text }
      : null,
    post_translations: decoratedTranslations,
    translation: resolveTranslation(decoratedTranslations, lang),
    category: post.post_categories
      ? {
          id: post.post_categories.id,
          translations: post.post_categories.post_category_translations,
        }
      : null,
  };
}
