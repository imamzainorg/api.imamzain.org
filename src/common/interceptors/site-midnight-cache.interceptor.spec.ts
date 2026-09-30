import { ExecutionContext } from '@nestjs/common';
import { lastValueFrom, of, throwError } from 'rxjs';
import {
  clampToSiteMidnight,
  siteMidnightCacheControl,
  SiteMidnightCacheInterceptor,
} from './site-midnight-cache.interceptor';

const at = (iso: string) => new Date(iso);

// Baghdad is UTC+3 with no DST, so site midnight is 21:00:00 UTC.
describe('site-midnight cache clamp', () => {
  const originalEnv = process.env.SITE_TIMEZONE;

  beforeEach(() => {
    delete process.env.SITE_TIMEZONE;
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.SITE_TIMEZONE;
    else process.env.SITE_TIMEZONE = originalEnv;
    jest.useRealTimers();
  });

  describe('clampToSiteMidnight', () => {
    it('keeps the configured TTL when there is more day left than that', () => {
      expect(clampToSiteMidnight(900, 40_000)).toBe(900);
    });

    it('cuts the TTL short to the time left in the day', () => {
      expect(clampToSiteMidnight(3600, 1800)).toBe(1800);
    });

    it('never goes below 1, even with 0 seconds left', () => {
      expect(clampToSiteMidnight(3600, 0)).toBe(1);
      expect(clampToSiteMidnight(900, 1)).toBe(1);
    });
  });

  describe('siteMidnightCacheControl', () => {
    it('is the configured header at mid-day', () => {
      expect(siteMidnightCacheControl(900, 3600, at('2026-05-12T06:00:00.000Z'))).toBe(
        'public, max-age=900, s-maxage=3600',
      );
    });

    it('clamps only the TTLs that exceed the time left', () => {
      // 30 minutes to Baghdad midnight: browser 900 fits, CDN 3600 does not.
      expect(siteMidnightCacheControl(900, 3600, at('2026-05-12T20:30:00.000Z'))).toBe(
        'public, max-age=900, s-maxage=1800',
      );
      // 10 minutes left: both are cut.
      expect(siteMidnightCacheControl(900, 3600, at('2026-05-12T20:50:00.000Z'))).toBe(
        'public, max-age=600, s-maxage=600',
      );
    });

    it('is exactly the configured TTL again the instant the new day starts (edge: 00:00:00.000)', () => {
      expect(siteMidnightCacheControl(900, 3600, at('2026-05-12T21:00:00.000Z'))).toBe(
        'public, max-age=900, s-maxage=3600',
      );
    });

    it('is 1 second in the final second before midnight, never 0 (edge: 23:59:59.x)', () => {
      expect(siteMidnightCacheControl(900, 3600, at('2026-05-12T20:59:59.000Z'))).toBe('public, max-age=1, s-maxage=1');
      expect(siteMidnightCacheControl(900, 3600, at('2026-05-12T20:59:59.999Z'))).toBe('public, max-age=1, s-maxage=1');
    });

    it('follows SITE_TIMEZONE', () => {
      process.env.SITE_TIMEZONE = 'UTC';
      // 3h10m before UTC midnight: both TTLs fit.
      expect(siteMidnightCacheControl(900, 3600, at('2026-05-12T20:50:00.000Z'))).toBe(
        'public, max-age=900, s-maxage=3600',
      );
      expect(siteMidnightCacheControl(900, 3600, at('2026-05-12T23:50:00.000Z'))).toBe(
        'public, max-age=600, s-maxage=600',
      );
    });
  });

  describe('SiteMidnightCacheInterceptor', () => {
    const contextWith = (res: { setHeader: jest.Mock }) =>
      ({ switchToHttp: () => ({ getResponse: () => res }) }) as unknown as ExecutionContext;

    it('sets the clamped Cache-Control from the clock when the response is produced', async () => {
      jest.useFakeTimers().setSystemTime(at('2026-05-12T20:50:00.000Z'));
      const res = { setHeader: jest.fn() };
      const interceptor = new SiteMidnightCacheInterceptor(900, 3600);

      const out = await lastValueFrom(interceptor.intercept(contextWith(res), { handle: () => of({ ok: true }) }));

      expect(out).toEqual({ ok: true });
      expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'public, max-age=600, s-maxage=600');
    });

    it('leaves the header alone when the handler fails', async () => {
      const res = { setHeader: jest.fn() };
      const interceptor = new SiteMidnightCacheInterceptor(900, 3600);

      await expect(
        lastValueFrom(interceptor.intercept(contextWith(res), { handle: () => throwError(() => new Error('boom')) })),
      ).rejects.toThrow('boom');

      expect(res.setHeader).not.toHaveBeenCalled();
    });
  });
});
