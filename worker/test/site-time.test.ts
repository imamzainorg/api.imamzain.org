import { describe, expect, it } from 'vitest';
import { clampToSiteMidnight, secondsUntilSiteMidnight, siteDate, siteTimezone } from '../src/lib/site-time';

describe('site time', () => {
  it('reads the editors’ calendar day, not the UTC day', () => {
    // 22:00 UTC is already 01:00 the next day in Baghdad (UTC+3).
    expect(siteDate('Asia/Baghdad', new Date('2026-05-15T22:00:00Z'))).toBe('2026-05-16');
    expect(siteDate('Asia/Baghdad', new Date('2026-05-15T20:59:59Z'))).toBe('2026-05-15');
  });

  it('counts down to the next local midnight, including a 25 h DST day', () => {
    expect(secondsUntilSiteMidnight('Asia/Baghdad', new Date('2026-05-15T20:59:00Z'))).toBe(60);
    // New York's clocks go back on 2026-11-01: that local day lasts 25 h.
    expect(secondsUntilSiteMidnight('America/New_York', new Date('2026-11-01T04:00:00Z'))).toBe(25 * 3600);
  });

  it('never lets a cache lifetime reach 0, and falls back to Baghdad for a bad zone', () => {
    expect(clampToSiteMidnight(3600, 0)).toBe(1);
    expect(clampToSiteMidnight(3600, 90)).toBe(90);
    expect(siteTimezone('Not/AZone')).toBe('Asia/Baghdad');
    expect(siteTimezone(undefined)).toBe('Asia/Baghdad');
  });
});
