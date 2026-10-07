import { Hono } from 'hono';
import { academicPaperCategories } from './features/academic-paper-categories/routes';
import { academicPapers } from './features/academic-papers/routes';
import { auditLogs } from './features/audit-logs/routes';
import { audios } from './features/audios/routes';
import { bookCategories } from './features/book-categories/routes';
import { books } from './features/books/routes';
import { dailyHadiths } from './features/daily-hadiths/routes';
import { homepage, rss, sitemap } from './features/feeds/routes';
import { dashboard } from './features/dashboard/routes';
import { gallery } from './features/gallery/routes';
import { galleryCategories } from './features/gallery-categories/routes';
import { health } from './features/health/routes';
import { languages } from './features/languages/routes';
import { search } from './features/search/routes';
import { settings } from './features/settings/routes';
import { speakers } from './features/speakers/routes';
import { staticPages } from './features/static-pages/routes';
import { stores } from './features/stores/routes';
import { youtube } from './features/youtube/routes';
import { postCategories } from './features/post-categories/routes';
import { posts } from './features/posts/routes';
import { proxyToOrigin } from './lib/proxy';
import type { AppEnv } from './lib/types';
import './lib/bigint';

/**
 * Ported-group table: path prefix → router built with `createApp()` (lib/create-app.ts). Any other
 * path falls through to ORIGIN_URL. Add an entry in the same PR that ports the group.
 */
export const ported: Record<string, Hono<AppEnv>> = {
  '/api/v1/academic-paper-categories': academicPaperCategories,
  '/api/v1/academic-papers': academicPapers,
  '/api/v1/audios': audios,
  '/api/v1/audit-logs': auditLogs,
  '/api/v1/dashboard': dashboard,
  '/api/v1/health': health,
  '/api/v1/book-categories': bookCategories,
  '/api/v1/books': books,
  '/api/v1/gallery': gallery,
  '/api/v1/homepage': homepage,
  '/api/v1/rss': rss,
  '/api/v1/search': search,
  '/api/v1/sitemap.xml': sitemap,
  '/api/v1/youtube': youtube,
  '/api/v1/daily-hadiths': dailyHadiths,
  '/api/v1/gallery-categories': galleryCategories,
  '/api/v1/post-categories': postCategories,
  '/api/v1/posts': posts,
  '/api/v1/languages': languages,
  '/api/v1/settings': settings,
  '/api/v1/speakers': speakers,
  '/api/v1/static-pages': staticPages,
  '/api/v1/stores': stores,
};

export const app = new Hono<AppEnv>();

for (const [prefix, router] of Object.entries(ported)) app.route(prefix, router);

// Anything no ported router answered goes to the Nest origin.
app.all('*', proxyToOrigin);
