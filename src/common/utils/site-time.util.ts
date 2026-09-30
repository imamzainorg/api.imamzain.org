import { Logger } from '@nestjs/common';

/**
 * The time zone the editorial team works in. A hadith's `display_date` is the
 * calendar day an editor picked, so "today" has to be that same day -- not the
 * UTC day, which starts three hours late for Baghdad.
 */
export const DEFAULT_SITE_TIMEZONE = 'Asia/Baghdad';

const logger = new Logger('SiteTime');

const MS_PER_SECOND = 1000;
// The longest a local calendar day can last is 25 h (a DST fall-back day); one
// extra hour keeps the binary search's upper bound safely past any midnight.
const SEARCH_WINDOW_MS = 26 * 60 * 60 * MS_PER_SECOND;

const dateFormatters = new Map<string, Intl.DateTimeFormat>();

/** Throws RangeError for a name that is not a valid IANA zone. */
function dateFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = dateFormatters.get(timeZone);
  if (!formatter) {
    // Fixed locale + calendar + digits: the parts are read by type, but a
    // Hijri/Arabic-Indic default must never leak in through the host locale.
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      calendar: 'gregory',
      numberingSystem: 'latn',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    dateFormatters.set(timeZone, formatter);
  }
  return formatter;
}

function isValidTimeZone(timeZone: string): boolean {
  try {
    dateFormatter(timeZone);
    return true;
  } catch {
    return false;
  }
}

let resolved: { raw: string | undefined; timeZone: string } | undefined;

/**
 * The site time zone from `SITE_TIMEZONE` (IANA name). Unset, blank or invalid
 * falls back to Asia/Baghdad; an invalid value is logged once, not per call.
 * Resolution is memoised per raw value, so it stays cheap on the request path.
 */
export function getSiteTimezone(): string {
  const raw = process.env.SITE_TIMEZONE?.trim() || undefined;
  if (resolved && resolved.raw === raw) return resolved.timeZone;

  let timeZone = DEFAULT_SITE_TIMEZONE;
  if (raw !== undefined) {
    if (isValidTimeZone(raw)) {
      timeZone = raw;
    } else {
      logger.warn(`SITE_TIMEZONE="${raw}" is not a valid IANA time zone name; falling back to ${DEFAULT_SITE_TIMEZONE}`);
    }
  }
  resolved = { raw, timeZone };
  return timeZone;
}

/** The calendar date (`YYYY-MM-DD`) at `now` in the site time zone. */
export function siteDate(now: Date = new Date(), timeZone: string = getSiteTimezone()): string {
  let year = '';
  let month = '';
  let day = '';
  for (const part of dateFormatter(timeZone).formatToParts(now)) {
    if (part.type === 'year') year = part.value;
    else if (part.type === 'month') month = part.value;
    else if (part.type === 'day') day = part.value;
  }
  return `${year.padStart(4, '0')}-${month}-${day}`;
}

/**
 * Whole seconds from `now` until the site calendar date next changes. Exactly
 * at midnight the new day has just started, so the answer is a full day (not
 * 0); in the last second before midnight it is 0 (callers that need a positive
 * TTL clamp it themselves).
 *
 * Found by searching for the instant `siteDate` flips rather than doing clock
 * arithmetic, so a zone with DST gets its 23 h / 25 h days right.
 */
export function secondsUntilSiteMidnight(now: Date = new Date(), timeZone: string = getSiteTimezone()): number {
  const start = now.getTime();
  const today = siteDate(now, timeZone);

  let lo = start; // siteDate(lo) === today
  let hi = start + SEARCH_WINDOW_MS; // siteDate(hi) !== today
  while (hi - lo > 1) {
    const mid = lo + Math.floor((hi - lo) / 2);
    if (siteDate(new Date(mid), timeZone) === today) lo = mid;
    else hi = mid;
  }
  return Math.floor((hi - start) / MS_PER_SECOND);
}
