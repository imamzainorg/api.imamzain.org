import type { Context } from 'hono';
import { publicCache } from './envelope';
import type { AppEnv } from './types';

// The editors' time zone: a hadith's display_date is the calendar day they picked, not the UTC day.
export const DEFAULT_SITE_TIMEZONE = 'Asia/Baghdad';

const MS_PER_SECOND = 1000;
// A local day is at most 25 h (DST fall-back); one more hour keeps the search's upper bound past any midnight.
const SEARCH_WINDOW_MS = 26 * 60 * 60 * MS_PER_SECOND;

const formatters = new Map<string, Intl.DateTimeFormat>();

/** Throws RangeError for a name that is not a valid IANA zone. */
function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    // Fixed locale, calendar and digits: a Hijri / Arabic-Indic default must never leak in.
    f = new Intl.DateTimeFormat('en-US', { timeZone, calendar: 'gregory', numberingSystem: 'latn', year: 'numeric', month: '2-digit', day: '2-digit' });
    formatters.set(timeZone, f);
  }
  return f;
}

/** `SITE_TIMEZONE` (IANA name); unset, blank or invalid falls back to Asia/Baghdad. */
export function siteTimezone(raw: string | undefined): string {
  const name = raw?.trim();
  if (!name) return DEFAULT_SITE_TIMEZONE;
  try {
    formatter(name);
    return name;
  } catch {
    console.warn(`SITE_TIMEZONE="${name}" is not a valid IANA time zone name; falling back to ${DEFAULT_SITE_TIMEZONE}`);
    return DEFAULT_SITE_TIMEZONE;
  }
}

/** The calendar date (`YYYY-MM-DD`) at `now` in `timeZone`. */
export function siteDate(timeZone: string, now: Date = new Date()): string {
  const part = (type: string) => formatter(timeZone).formatToParts(now).find((p) => p.type === type)?.value ?? '';
  return `${part('year').padStart(4, '0')}-${part('month')}-${part('day')}`;
}

/**
 * Whole seconds until the site date next changes (a full day exactly at midnight, 0 in the last
 * second). Found by searching for the instant `siteDate` flips, so a DST zone gets its 23 h / 25 h days right.
 */
export function secondsUntilSiteMidnight(timeZone: string, now: Date = new Date()): number {
  const start = now.getTime();
  const today = siteDate(timeZone, now);
  let lo = start;
  let hi = start + SEARCH_WINDOW_MS;
  while (hi - lo > 1) {
    const mid = lo + Math.floor((hi - lo) / 2);
    if (siteDate(timeZone, new Date(mid)) === today) lo = mid;
    else hi = mid;
  }
  return Math.floor((hi - start) / MS_PER_SECOND);
}

/** A TTL never below 1: a `0` reads as "do not cache" on some intermediaries. */
export function clampToSiteMidnight(configuredSeconds: number, secondsLeft: number): number {
  return Math.max(1, Math.min(configuredSeconds, secondsLeft));
}

/** `@PublicCache(a, b, { untilSiteMidnight: true })`: call after the handler's work, on success only. */
export function publicCacheUntilSiteMidnight(c: Context<AppEnv>, maxAgeSeconds: number, sMaxAgeSeconds: number): void {
  const left = secondsUntilSiteMidnight(siteTimezone(c.env.SITE_TIMEZONE));
  publicCache(c, clampToSiteMidnight(maxAgeSeconds, left), clampToSiteMidnight(sMaxAgeSeconds, left));
}
