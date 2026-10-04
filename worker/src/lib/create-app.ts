import { OpenAPIHono } from '@hono/zod-openapi';
import { bodyLimit } from 'hono/body-limit';
import { HTTPException } from 'hono/http-exception';
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

/**
 * A router for ported routes: the shared middleware in Nest's order (helmet → CORS → global
 * throttle → body limit → language) around the group's own routes, Zod hook and error envelope.
 * Not applied to fallthrough traffic, which the origin already handles.
 */
export function createApp() {
  const app = new OpenAPIHono<AppEnv>({ defaultHook: zodHook });
  app.use('*', async (c, next) => {
    c.set('ip', c.req.header('cf-connecting-ip') ?? '');
    await next();
  });
  app.use('*', closeDb, secureHeaders, cors, etag, rateLimit('RL_GLOBAL'), language);
  app.use(
    '*',
    bodyLimit({
      maxSize: JSON_BODY_LIMIT,
      onError: () => {
        throw new HTTPException(413, { message: 'request entity too large' });
      },
    }),
  );
  app.onError(errorHandler);
  return app;
}
