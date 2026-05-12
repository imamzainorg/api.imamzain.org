import { applyDecorators, Header } from '@nestjs/common';

/**
 * Mark a controller method as cacheable by intermediate caches (the CDN
 * in front of the API). Sets two response headers:
 *
 *   Cache-Control: public, max-age=<browser>, s-maxage=<cdn>
 *   Vary: Accept-Language
 *
 * `max-age` is the browser cache TTL; `s-maxage` is the shared-cache /
 * CDN TTL. We set them separately so the CDN can hold responses longer
 * than browsers — the CDN sits closer to the database, and it's the
 * one we're protecting from request fan-out.
 *
 * `Vary: Accept-Language` is critical: every cached endpoint that
 * resolves translations against the request's `Accept-Language` header
 * must vary by that header, or a CDN edge will serve an Arabic body to
 * an English visitor (or vice versa).
 *
 * Only apply to endpoints that are:
 *   - GET requests
 *   - Anonymous / public (no `Authorization` header expected — auth'd
 *     responses must NOT be CDN-cached or they'd leak between users)
 *   - Returning data that is identical for every caller modulo
 *     `Accept-Language`
 *
 * NestJS / Express already emit `ETag: W/"<hash>"` on every JSON
 * response. The CDN automatically honours `If-None-Match` and serves
 * 304s — no extra work required here.
 *
 * Defaults: 60s browser, 300s CDN. Override per endpoint when the
 * data changes more slowly (sitemap.xml uses 900s, settings/public
 * could use longer, etc.).
 */
export function PublicCache(maxAgeSeconds = 60, sMaxAgeSeconds?: number) {
  const sMaxAge = sMaxAgeSeconds ?? maxAgeSeconds * 5;
  return applyDecorators(
    Header('Cache-Control', `public, max-age=${maxAgeSeconds}, s-maxage=${sMaxAge}`),
    Header('Vary', 'Accept-Language'),
  );
}
