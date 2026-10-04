import { createMiddleware } from 'hono/factory';
import type { AppEnv } from './types';

// Development default (ALLOWED_ORIGINS unset): any localhost / 127.0.0.1 origin, as in Nest's main.ts.
const LOCAL_ORIGIN = /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/;

export function isAllowedOrigin(origin: string, allowed: string | undefined): boolean {
  if (allowed) {
    return allowed
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean)
      .includes(origin);
  }
  return LOCAL_ORIGIN.test(origin);
}

/**
 * Same behaviour as Nest's `enableCors({ origin: ALLOWED_ORIGINS, credentials: true, optionsSuccessStatus: 200 })`
 * (express `cors`): the origin is echoed only when listed, `Vary: Origin` always, preflights answered
 * 200 with the requested headers reflected. Not hono/cors because that answers preflights 204.
 */
export const cors = createMiddleware<AppEnv>(async (c, next) => {
  const origin = c.req.header('origin');
  const ok = !!origin && isAllowedOrigin(origin, c.env.ALLOWED_ORIGINS);

  if (c.req.method === 'OPTIONS') {
    const headers = new Headers({ Vary: 'Origin, Access-Control-Request-Headers' });
    if (ok) {
      headers.set('Access-Control-Allow-Origin', origin);
      headers.set('Access-Control-Allow-Credentials', 'true');
      headers.set('Access-Control-Allow-Methods', 'GET,HEAD,PUT,PATCH,POST,DELETE');
      const requested = c.req.header('access-control-request-headers');
      if (requested) headers.set('Access-Control-Allow-Headers', requested);
    }
    headers.set('Content-Length', '0');
    return new Response(null, { status: 200, headers });
  }

  await next();
  c.header('Vary', 'Origin', { append: true });
  if (ok) {
    c.header('Access-Control-Allow-Origin', origin);
    c.header('Access-Control-Allow-Credentials', 'true');
  }
});
