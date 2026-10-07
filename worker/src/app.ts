import { Hono } from 'hono';
import { academicPaperCategories } from './features/academic-paper-categories/routes';
import { bookCategories } from './features/book-categories/routes';
import { gallery } from './features/gallery/routes';
import { galleryCategories } from './features/gallery-categories/routes';
import { languages } from './features/languages/routes';
import { settings } from './features/settings/routes';
import { speakers } from './features/speakers/routes';
import { staticPages } from './features/static-pages/routes';
import { stores } from './features/stores/routes';
import { postCategories } from './features/post-categories/routes';
import { proxyToOrigin } from './lib/proxy';
import type { AppEnv } from './lib/types';
import './lib/bigint';

/**
 * Ported-group table: path prefix → router built with `createApp()` (lib/create-app.ts). Any other
 * path falls through to ORIGIN_URL. Add an entry in the same PR that ports the group.
 */
export const ported: Record<string, Hono<AppEnv>> = {
  '/api/v1/academic-paper-categories': academicPaperCategories,
  '/api/v1/book-categories': bookCategories,
  '/api/v1/gallery': gallery,
  '/api/v1/gallery-categories': galleryCategories,
  '/api/v1/post-categories': postCategories,
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
