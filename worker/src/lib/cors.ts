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
 * Website pages that are not the real site: a PR preview (`https://pr-<N>-imamzain-org.<host>`, where
 * <host> is PREVIEW_ORIGIN_HOST, the account's workers.dev subdomain) and local development. They read
 * public data and count views, so they get the origin echoed but never credentials: a preview is built
 * from an unmerged branch and must not act with an editor's session.
 */
export function isPublicOrigin(origin: string, previewHost: string | undefined): boolean {
  if (LOCAL_ORIGIN.test(origin)) return true;
  if (!previewHost) return false;
  const match = /^https:\/\/pr-\d+-imamzain-org\.(.+)$/.exec(origin);
  return match?.[1] === previewHost;
}

/**
 * Same headers as Nest's `enableCors({ origin: ALLOWED_ORIGINS, credentials: true, optionsSuccessStatus: 200 })`
 * (express `cors`): the origin is echoed only when listed; credentials, `Vary` and, on preflights, the
 * methods and the reflected request headers are sent whatever the origin. Preflights end here with 200.
 * Not hono/cors because that answers preflights 204. A public origin (isPublicOrigin) is echoed too, but
 * without `Access-Control-Allow-Credentials`, so the browser refuses it any credentialed request.
 */
export const cors = createMiddleware<AppEnv>(async (c, next) => {
  const origin = c.req.header('origin');
  const listed = !!origin && isAllowedOrigin(origin, c.env.ALLOWED_ORIGINS);
  const open = !listed && !!origin && isPublicOrigin(origin, c.env.PREVIEW_ORIGIN_HOST);

  if (c.req.method === 'OPTIONS') {
    const headers = new Headers();
    if (listed || open) headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Vary', 'Origin, Access-Control-Request-Headers');
    if (!open) headers.set('Access-Control-Allow-Credentials', 'true');
    headers.set('Access-Control-Allow-Methods', 'GET,HEAD,PUT,PATCH,POST,DELETE');
    const requested = c.req.header('access-control-request-headers');
    if (requested) headers.set('Access-Control-Allow-Headers', requested);
    headers.set('Content-Length', '0');
    return new Response(null, { status: 200, headers });
  }

  await next();
  if (listed || open) c.header('Access-Control-Allow-Origin', origin);
  c.header('Vary', 'Origin', { append: true });
  if (!open) c.header('Access-Control-Allow-Credentials', 'true');
});
