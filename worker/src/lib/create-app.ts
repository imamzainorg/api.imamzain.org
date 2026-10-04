import { OpenAPIHono } from '@hono/zod-openapi';
import type { Context, MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { HTTPException } from 'hono/http-exception';
import { matchedRoutes } from 'hono/route';
import { closeDb } from './db';
import { cors } from './cors';
import { etag } from './etag';
import { errorHandler } from './errors';
import { language } from './i18n';
import { rateLimit } from './rate-limit';
import { secureHeaders } from './secure-headers';
import type { AppEnv } from './types';
import { zodHook } from './validation';
import './bigint';

/** Express's JSON body limit in Nest's main.ts. */
export const JSON_BODY_LIMIT = 1024 * 1024;

const setIp: MiddlewareHandler<AppEnv> = async (c, next) => {
  c.set('ip', c.req.header('cf-connecting-ip') ?? '');
  await next();
};

/**
 * True when a ported route (registered for a method, not ALL) matched. A path under a ported prefix
 * that no route serves falls through to Nest, which applies its own headers and throttle; preflights
 * are answered here, with the same headers Nest would send.
 */
const servesRoute = (c: Context<AppEnv>) =>
  c.req.method === 'OPTIONS' || matchedRoutes(c).some((r) => r.method !== 'ALL');

const onlyForRoutes =
  (mw: MiddlewareHandler<AppEnv>): MiddlewareHandler<AppEnv> =>
  (c, next) =>
    servesRoute(c) ? mw(c, next) : next();

/**
 * A router for ported routes: the shared middleware around the group's own routes, the Zod hook and
 * the error envelope. Nest's order is helmet → CORS → language → throttle guards → auth → validation.
 * The body limit sits before the throttle as body-parser did (413 wins over 429), but after CORS, so
 * a browser can read the 413. Each middleware is registered separately so an error thrown in one
 * still gets the headers of those around it.
 */
export function createApp() {
  const app = new OpenAPIHono<AppEnv>({ defaultHook: zodHook });
  const shared: MiddlewareHandler<AppEnv>[] = [
    setIp,
    closeDb,
    secureHeaders,
    cors,
    etag,
    bodyLimit({
      maxSize: JSON_BODY_LIMIT,
      onError: () => {
        throw new HTTPException(413, { message: 'request entity too large' });
      },
    }),
    language,
    rateLimit('RL_GLOBAL'),
  ];
  app.use('*', ...shared.map(onlyForRoutes));
  app.onError(errorHandler);
  return app;
}
