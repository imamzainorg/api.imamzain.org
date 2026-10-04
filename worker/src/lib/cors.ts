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
 * Same headers as Nest's `enableCors({ origin: ALLOWED_ORIGINS, credentials: true, optionsSuccessStatus: 200 })`
 * (express `cors`): the origin is echoed only when listed; credentials, `Vary` and, on preflights, the
 * methods and the reflected request headers are sent whatever the origin. Preflights end here with 200.
 * Not hono/cors because that answers preflights 204.
 */
export const cors = createMiddleware<AppEnv>(async (c, next) => {
  const origin = c.req.header('origin');
  const ok = !!origin && isAllowedOrigin(origin, c.env.ALLOWED_ORIGINS);

  if (c.req.method === 'OPTIONS') {
    const headers = new Headers();
    if (ok) headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Vary', 'Origin, Access-Control-Request-Headers');
    headers.set('Access-Control-Allow-Credentials', 'true');
    headers.set('Access-Control-Allow-Methods', 'GET,HEAD,PUT,PATCH,POST,DELETE');
    const requested = c.req.header('access-control-request-headers');
    if (requested) headers.set('Access-Control-Allow-Headers', requested);
    headers.set('Content-Length', '0');
    return new Response(null, { status: 200, headers });
  }

  await next();
  if (ok) c.header('Access-Control-Allow-Origin', origin);
  c.header('Vary', 'Origin', { append: true });
  c.header('Access-Control-Allow-Credentials', 'true');
});
