import { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import type { Response } from 'express';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { secondsUntilSiteMidnight } from '../utils/site-time.util';

/**
 * A TTL that never outlives the site's calendar day: the configured value, cut
 * short to the time left until site midnight, and never below 1 (a `0` would
 * read as "do not cache" on some intermediaries and lose the day-boundary
 * revalidation the ETag gives us).
 */
export function clampToSiteMidnight(configuredSeconds: number, secondsLeft: number): number {
  return Math.max(1, Math.min(configuredSeconds, secondsLeft));
}

export function siteMidnightCacheControl(maxAgeSeconds: number, sMaxAgeSeconds: number, now: Date = new Date()): string {
  const secondsLeft = secondsUntilSiteMidnight(now);
  return `public, max-age=${clampToSiteMidnight(maxAgeSeconds, secondsLeft)}, s-maxage=${clampToSiteMidnight(sMaxAgeSeconds, secondsLeft)}`;
}

/**
 * For responses whose content flips at site midnight (the hadith of the day):
 * a fixed `s-maxage` lets a CDN keep yesterday's answer for up to an hour into
 * the new day. Sets `Cache-Control` on success only, from the clock at the
 * moment the response is produced, so an error never gets a fresh public TTL.
 */
export class SiteMidnightCacheInterceptor implements NestInterceptor {
  constructor(
    private readonly maxAgeSeconds: number,
    private readonly sMaxAgeSeconds: number,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const res = context.switchToHttp().getResponse<Response>();
    return next
      .handle()
      .pipe(tap(() => res.setHeader('Cache-Control', siteMidnightCacheControl(this.maxAgeSeconds, this.sMaxAgeSeconds))));
  }
}
