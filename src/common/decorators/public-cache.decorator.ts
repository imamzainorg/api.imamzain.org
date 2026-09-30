import { applyDecorators, Header, UseInterceptors } from '@nestjs/common';
import { SiteMidnightCacheInterceptor } from '../interceptors/site-midnight-cache.interceptor';

export interface PublicCacheOptions {
  /**
   * Clamp `max-age` and `s-maxage` so the response never outlives the site's
   * calendar day. For content that changes at site midnight (hadith of the
   * day); leave off everywhere else.
   */
  untilSiteMidnight?: boolean;
}

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
 * Every 2xx JSON response carries a weak `ETag` computed by `envelopeEtag`
 * (src/common/interceptors/response.interceptor.ts), which ignores the
 * envelope `timestamp` and survives compression, so a matching
 * `If-None-Match` gets a body-less 304. Error responses are always
 * `no-store` (AllExceptionsFilter), whatever this decorator set earlier.
 *
 * Defaults: 60s browser, 300s CDN. Override per endpoint when the
 * data changes more slowly (sitemap.xml uses 900s, settings/public
 * could use longer, etc.).
 *
 * `{ untilSiteMidnight: true }` keeps the static header above as the baseline
 * and lets an interceptor replace it on success with TTLs clamped to the time
 * left in the site's calendar day. Without the option the headers are exactly
 * the static ones, unchanged.
 */
export function PublicCache(maxAgeSeconds = 60, sMaxAgeSeconds?: number, options: PublicCacheOptions = {}) {
  const sMaxAge = sMaxAgeSeconds ?? maxAgeSeconds * 5;
  const decorators = [
    Header('Cache-Control', `public, max-age=${maxAgeSeconds}, s-maxage=${sMaxAge}`),
    Header('Vary', 'Accept-Language'),
  ];
  if (options.untilSiteMidnight) {
    decorators.push(UseInterceptors(new SiteMidnightCacheInterceptor(maxAgeSeconds, sMaxAge)));
  }
  return applyDecorators(...decorators);
}
