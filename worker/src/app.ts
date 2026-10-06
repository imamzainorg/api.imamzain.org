import { Hono } from 'hono';
import { postCategories } from './features/post-categories/routes';
import { proxyToOrigin } from './lib/proxy';
import type { AppEnv } from './lib/types';
import './lib/bigint';

/**
 * Ported-group table: path prefix → router built with `createApp()` (lib/create-app.ts). Any other
 * path falls through to ORIGIN_URL. Add an entry in the same PR that ports the group.
 */
export const ported: Record<string, Hono<AppEnv>> = {
  '/api/v1/post-categories': postCategories,
};

export const app = new Hono<AppEnv>();

for (const [prefix, router] of Object.entries(ported)) app.route(prefix, router);

// Anything no ported router answered goes to the Nest origin.
app.all('*', proxyToOrigin);
