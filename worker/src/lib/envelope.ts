import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { AppEnv } from './types';

/**
 * Success envelope, same shape and key order as Nest's ResponseInterceptor: the handler's own
 * object (`{ message, data, ... }`) with `success` and `timestamp` appended. `timestamp` must stay
 * the last key: the ETag hash strips it (see etag.ts).
 */
export function envelope(body: unknown): Record<string, unknown> {
  const timestamp = new Date().toISOString();
  if (body !== null && typeof body === 'object' && !Array.isArray(body)) {
    return { ...(body as Record<string, unknown>), success: true, timestamp };
  }
  return { data: body, success: true, timestamp };
}

export function respond(c: Context<AppEnv>, body: unknown, status: ContentfulStatusCode = 200): Response {
  return c.json(envelope(body), status);
}

/**
 * `@PublicCache(maxAge, sMaxAge)`: public GETs the CDN may hold; `Vary: Accept-Language` is mandatory
 * for anything that resolves translations. Defaults match Nest (s-maxage = 5 × max-age).
 */
export function publicCache(c: Context<AppEnv>, maxAgeSeconds = 60, sMaxAgeSeconds = maxAgeSeconds * 5): void {
  c.header('Cache-Control', `public, max-age=${maxAgeSeconds}, s-maxage=${sMaxAgeSeconds}`);
  c.header('Vary', 'Accept-Language');
}
