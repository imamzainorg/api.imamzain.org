import { Hono } from 'hono';
import { academicPaperCategories } from './features/academic-paper-categories/routes';
import { academicPapers } from './features/academic-papers/routes';
import { auditLogs } from './features/audit-logs/routes';
import { auth } from './features/auth/routes';
import { audios } from './features/audios/routes';
import { bookCategories } from './features/book-categories/routes';
import { books } from './features/books/routes';
import { dailyHadiths } from './features/daily-hadiths/routes';
import { homepage, rss, sitemap } from './features/feeds/routes';
import { forms } from './features/forms/routes';
import { dashboard } from './features/dashboard/routes';
import { gallery } from './features/gallery/routes';
import { galleryCategories } from './features/gallery-categories/routes';
import { health } from './features/health/routes';
import { languages } from './features/languages/routes';
import { media } from './features/media/routes';
import { newsletter } from './features/newsletter/routes';
import { search } from './features/search/routes';
import { settings } from './features/settings/routes';
import { speakers } from './features/speakers/routes';
import { staticPages } from './features/static-pages/routes';
import { stores } from './features/stores/routes';
import { youtube } from './features/youtube/routes';
import { postCategories } from './features/post-categories/routes';
import { posts } from './features/posts/routes';
import { roles } from './features/roles/routes';
import { users } from './features/users/routes';
import { errorHandler, notFound } from './lib/errors';
import type { AppEnv } from './lib/types';
import './lib/bigint';

/**
 * Route table: path prefix → router built with `createApp()` (lib/create-app.ts). Any other path is a 404.
 */
export const routes: Record<string, Hono<AppEnv>> = {
  '/api/v1/academic-paper-categories': academicPaperCategories,
  '/api/v1/academic-papers': academicPapers,
  '/api/v1/audios': audios,
  '/api/v1/audit-logs': auditLogs,
  '/api/v1/auth': auth,
  '/api/v1/dashboard': dashboard,
  '/api/v1/health': health,
  '/api/v1/book-categories': bookCategories,
  '/api/v1/books': books,
  '/api/v1/forms': forms,
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
  '/api/v1/roles': roles,
  '/api/v1/users': users,
  '/api/v1/languages': languages,
  '/api/v1/media': media,
  '/api/v1/newsletter': newsletter,
  '/api/v1/settings': settings,
  '/api/v1/speakers': speakers,
  '/api/v1/static-pages': staticPages,
  '/api/v1/stores': stores,
};

export const app = new Hono<AppEnv>();

for (const [prefix, router] of Object.entries(routes)) app.route(prefix, router);

// Same text and envelope as Nest's unknown-route 404.
app.notFound((c) =>
  errorHandler(notFound(`Cannot ${c.req.method} ${new URL(c.req.url).pathname}`), c),
);
