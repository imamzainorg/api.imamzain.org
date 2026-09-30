import { Logger } from '@nestjs/common';
import { DEFAULT_SITE_TIMEZONE, getSiteTimezone, secondsUntilSiteMidnight, siteDate } from './site-time.util';

const at = (iso: string) => new Date(iso);

describe('site-time.util', () => {
  const originalEnv = process.env.SITE_TIMEZONE;

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.SITE_TIMEZONE;
    else process.env.SITE_TIMEZONE = originalEnv;
    jest.restoreAllMocks();
  });

  describe('getSiteTimezone', () => {
    it('defaults to Asia/Baghdad when SITE_TIMEZONE is unset or blank', () => {
      delete process.env.SITE_TIMEZONE;
      expect(getSiteTimezone()).toBe('Asia/Baghdad');
      expect(DEFAULT_SITE_TIMEZONE).toBe('Asia/Baghdad');

      process.env.SITE_TIMEZONE = '   ';
      expect(getSiteTimezone()).toBe('Asia/Baghdad');
    });

    it('uses a valid IANA name from SITE_TIMEZONE', () => {
      process.env.SITE_TIMEZONE = 'Europe/London';
      expect(getSiteTimezone()).toBe('Europe/London');
    });

    it('falls back to the default on an invalid name and warns exactly once, not per call', () => {
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      process.env.SITE_TIMEZONE = 'Mars/Olympus_Mons';

      expect(getSiteTimezone()).toBe('Asia/Baghdad');
      expect(getSiteTimezone()).toBe('Asia/Baghdad');
      expect(getSiteTimezone()).toBe('Asia/Baghdad');

      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0])).toContain('Mars/Olympus_Mons');
    });
  });

  describe('siteDate', () => {
    it('is the Baghdad calendar day by default, flipping at 21:00 UTC (UTC+3, no DST)', () => {
      delete process.env.SITE_TIMEZONE;
      expect(siteDate(at('2026-05-12T20:59:59.999Z'))).toBe('2026-05-12');
      expect(siteDate(at('2026-05-12T21:00:00.000Z'))).toBe('2026-05-13');
    });

    it('is ahead of the UTC date for the first three hours of the UTC day', () => {
      delete process.env.SITE_TIMEZONE;
      // 02:00 UTC on the 13th is 05:00 in Baghdad -- the same day either way,
      // but 22:00 UTC on the 12th is already the 13th in Baghdad.
      expect(siteDate(at('2026-05-13T02:00:00.000Z'))).toBe('2026-05-13');
      expect(siteDate(at('2026-05-12T22:00:00.000Z'))).toBe('2026-05-13');
    });

    it('rolls over month, year and leap-day boundaries', () => {
      delete process.env.SITE_TIMEZONE;
      expect(siteDate(at('2026-12-31T21:00:00.000Z'))).toBe('2027-01-01');
      expect(siteDate(at('2028-02-28T21:00:00.000Z'))).toBe('2028-02-29');
      expect(siteDate(at('2028-02-29T21:00:00.000Z'))).toBe('2028-03-01');
    });

    it('honours SITE_TIMEZONE and an explicit zone argument', () => {
      process.env.SITE_TIMEZONE = 'America/New_York';
      expect(siteDate(at('2026-07-01T03:59:59.000Z'))).toBe('2026-06-30'); // 23:59:59 EDT
      expect(siteDate(at('2026-07-01T04:00:00.000Z'))).toBe('2026-07-01');
      expect(siteDate(at('2026-07-01T03:59:59.000Z'), 'UTC')).toBe('2026-07-01');
    });
  });

  describe('secondsUntilSiteMidnight', () => {
    beforeEach(() => {
      delete process.env.SITE_TIMEZONE;
    });

    it('counts down to 21:00 UTC (Baghdad midnight)', () => {
      expect(secondsUntilSiteMidnight(at('2026-05-12T20:00:00.000Z'))).toBe(3600);
      expect(secondsUntilSiteMidnight(at('2026-05-12T20:50:00.000Z'))).toBe(600);
      expect(secondsUntilSiteMidnight(at('2026-05-12T06:00:00.000Z'))).toBe(15 * 3600);
    });

    it('is a full day at exactly midnight, not 0: the new day has only just begun', () => {
      expect(secondsUntilSiteMidnight(at('2026-05-12T21:00:00.000Z'))).toBe(86400);
    });

    it('is 1 in the last whole second and 0 in the final fraction of it', () => {
      expect(secondsUntilSiteMidnight(at('2026-05-12T20:59:59.000Z'))).toBe(1);
      expect(secondsUntilSiteMidnight(at('2026-05-12T20:59:59.500Z'))).toBe(0);
      expect(secondsUntilSiteMidnight(at('2026-05-12T20:59:59.999Z'))).toBe(0);
    });

    it('crosses a year boundary', () => {
      expect(secondsUntilSiteMidnight(at('2026-12-31T20:00:00.000Z'))).toBe(3600);
    });

    it('gets a 23-hour spring-forward day right (America/New_York, 2026-03-08)', () => {
      // Local midnight 2026-03-08 00:00 EST is 05:00 UTC; the day ends at 04:00 UTC (EDT).
      expect(secondsUntilSiteMidnight(at('2026-03-08T05:00:00.000Z'), 'America/New_York')).toBe(23 * 3600);
      expect(secondsUntilSiteMidnight(at('2026-03-09T03:59:59.000Z'), 'America/New_York')).toBe(1);
    });

    it('gets a 25-hour fall-back day right (America/New_York, 2026-11-01)', () => {
      // Local midnight 2026-11-01 00:00 EDT is 04:00 UTC; the day ends at 05:00 UTC on the 2nd (EST).
      expect(secondsUntilSiteMidnight(at('2026-11-01T04:00:00.000Z'), 'America/New_York')).toBe(25 * 3600);
    });
  });
});
