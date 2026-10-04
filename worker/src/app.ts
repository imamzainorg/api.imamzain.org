import { Hono } from 'hono';
import { proxyToOrigin } from './lib/proxy';
import type { AppEnv } from './lib/types';
import './lib/bigint';

/**
 * Ported-group table: path prefix → router built with `createApp()` (lib/create-app.ts).
 * Empty until the first group is ported, so every request falls through to ORIGIN_URL.
 * Add an entry in the same PR that ports the group, e.g. `'/api/v1/book-categories': bookCategories`.
 */
export const ported: Record<string, Hono<AppEnv>> = {};

export const app = new Hono<AppEnv>();

for (const [prefix, router] of Object.entries(ported)) app.route(prefix, router);

// Anything no ported router answered goes to the Nest origin.
app.all('*', proxyToOrigin);
