import {
  anchorFromReading,
  calendarDateOn,
  hijriOn,
  mergeAnchor,
  needsCheck,
  parseAnchor,
  parseSistaniHomeDate,
  type HijriAnchor,
  type HijriDate,
  type HijriReading,
  type HijriToday,
} from '../../lib/hijri';
import type { AppBindings } from '../../lib/types';

// One key in the HIJRI_DATE_ANCHOR namespace: the month today falls in. KV, not the Cache API, because a
// cache entry is per Cloudflare location and can be evicted any time; a miss there would mean one more
// read of sistani.org per location.
const ANCHOR_KEY = 'anchor';
const DEFAULT_SOURCE_URL = 'https://www.sistani.org/';
const FETCH_TIMEOUT_MS = 5000;

export async function readAnchor(env: AppBindings): Promise<HijriAnchor | null> {
  try {
    return parseAnchor(await env.HIJRI_DATE_ANCHOR.get(ANCHOR_KEY, 'json'));
  } catch (err) {
    console.warn(`Could not read the Hijri anchor: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

async function writeAnchor(env: AppBindings, anchor: HijriAnchor): Promise<void> {
  await env.HIJRI_DATE_ANCHOR.put(ANCHOR_KEY, JSON.stringify(anchor));
}

/** sistani.org's date, or null (logged) when it can't be fetched or the page no longer reads as one. */
export async function fetchSistaniDate(env: AppBindings): Promise<HijriReading | null> {
  const url = env.HIJRI_SOURCE_URL?.trim() || DEFAULT_SOURCE_URL;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; imamzain-api; +https://imamzain.org)' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.warn(`Hijri date: ${url} answered ${res.status}`);
      return null;
    }
    const reading = parseSistaniHomeDate(await res.text());
    if (!reading) console.error(`Hijri date: no date found in ${url}'s #home-date; has the page changed?`);
    return reading;
  } catch (err) {
    console.warn(`Hijri date: could not fetch ${url}: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/**
 * Reads sistani.org and stores what it learned. If it can't be read, an existing anchor is kept, and with
 * none a provisional Umm al-Qura one is stored so later requests don't each try again: the hourly check
 * replaces it.
 */
export async function refreshAnchor(env: AppBindings, existing: HijriAnchor | null, today: string): Promise<HijriAnchor> {
  const reading = await fetchSistaniDate(env);
  const next = reading ? anchorFromReading(reading, 'sistani') : (existing ?? calendarAnchor(today));
  const merged = mergeAnchor(existing, next);
  if (JSON.stringify(merged) !== JSON.stringify(existing)) {
    try {
      await writeAnchor(env, merged);
    } catch (err) {
      console.warn(`Could not store the Hijri anchor: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return merged;
}

/** The Hijri date on the site day `today`; reads sistani.org only when no anchor covers it. */
export async function hijriToday(env: AppBindings, today: string): Promise<HijriToday> {
  const anchor = await readAnchor(env);
  const known = anchor ? hijriOn(anchor, today) : null;
  if (known) return known;
  const fresh = await refreshAnchor(env, anchor, today);
  // A page already on tomorrow (its clock ahead of the site's at midnight) starts after today.
  return hijriOn(fresh, today) ?? hijriOn(calendarAnchor(today), today)!;
}

/** Sets today's Hijri date by hand, for when Najaf's announcement and sistani.org disagree. */
export async function setHijriToday(env: AppBindings, today: string, date: HijriDate): Promise<HijriAnchor> {
  const anchor = anchorFromReading({ ...date, gregorian: today }, 'manual');
  await writeAnchor(env, anchor);
  return anchor;
}

/** The hourly job: reads sistani.org only when today's date is unknown or provisional. */
export async function checkHijriDate(env: AppBindings, today: string): Promise<void> {
  const anchor = await readAnchor(env);
  if (!needsCheck(anchor, today)) return;
  const fresh = await refreshAnchor(env, anchor, today);
  const hijri = hijriOn(fresh, today);
  console.log(`Hijri date checked: ${hijri ? `${hijri.day}/${hijri.month}/${hijri.year}` : 'none'} (${fresh.source}${hijri?.provisional ? ', provisional' : ''})`);
}

function calendarAnchor(today: string): HijriAnchor {
  return anchorFromReading({ ...calendarDateOn(today), gregorian: today }, 'calendar');
}
