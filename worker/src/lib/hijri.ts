// The Hijri date as Najaf announces it (sistani.org), not a computed one. A month has 29 or 30 days
// depending on the moon sighting, so the only open question each month is whether the day after the
// 29th is the 30th or the 1st of the next month. An anchor (the Gregorian day a month began on)
// answers every other day by counting, and sistani.org is read only while that question is open.

export const HIJRI_MONTHS = [
  'محرم',
  'صفر',
  'ربيع الأول',
  'ربيع الآخر',
  'جمادى الأولى',
  'جمادى الآخرة',
  'رجب',
  'شعبان',
  'شهر رمضان',
  'شوال',
  'ذو القعدة',
  'ذو الحجة',
] as const;

/** `calendar`: Umm al-Qura, used only until sistani.org can be read; it is always provisional. */
export type HijriSource = 'sistani' | 'manual' | 'calendar';

export interface HijriAnchor {
  year: number;
  month: number;
  /** The Gregorian site date (`YYYY-MM-DD`) of the month's 1st. */
  start: string;
  /** Known once the 30th has been seen, or set by hand. */
  length?: 29 | 30;
  source: HijriSource;
}

export interface HijriDate {
  year: number;
  month: number;
  day: number;
}

export interface HijriToday extends HijriDate {
  /** The day depends on a month length nobody has confirmed yet. */
  provisional: boolean;
  source: HijriSource;
}

/** A date read from sistani.org, with the Gregorian date the page printed beside it. */
export interface HijriReading extends HijriDate {
  gregorian: string;
}

const MS_PER_DAY = 86_400_000;

const toUtc = (dateOnly: string) => Date.parse(`${dateOnly}T00:00:00.000Z`);

export function addDays(dateOnly: string, days: number): string {
  return new Date(toUtc(dateOnly) + days * MS_PER_DAY).toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string): number {
  return Math.round((toUtc(to) - toUtc(from)) / MS_PER_DAY);
}

/** The Hijri date on `date` counted from `anchor`; null if the anchor starts after it. */
export function hijriOn(anchor: HijriAnchor, date: string): HijriToday | null {
  let offset = daysBetween(anchor.start, date);
  if (offset < 0) return null;
  let { year, month } = anchor;
  let length = anchor.length;
  let provisional = anchor.source === 'calendar';
  while (offset >= 29) {
    // Day 30 of a month that has (or may have) one.
    if (offset === 29 && length !== 29) {
      if (length === undefined) provisional = true;
      break;
    }
    // Past the end of the month: an unconfirmed month is counted as 30 days until sistani.org says otherwise.
    if (length === undefined) provisional = true;
    offset -= length ?? 30;
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
    length = undefined;
  }
  return { year, month, day: offset + 1, provisional, source: anchor.source };
}

/** True when the date on `today` is unknown or provisional: the only time sistani.org needs reading. */
export function needsCheck(anchor: HijriAnchor | null, today: string): boolean {
  if (!anchor) return true;
  const hijri = hijriOn(anchor, today);
  return hijri === null || hijri.provisional;
}

/** A 30th proves the month has 30 days; any other day leaves the length open. */
export function anchorFromReading(reading: HijriReading, source: HijriSource): HijriAnchor {
  return {
    year: reading.year,
    month: reading.month,
    start: addDays(reading.gregorian, 1 - reading.day),
    ...(reading.day === 30 ? { length: 30 as const } : {}),
    source,
  };
}

const monthIndex = (a: { year: number; month: number }) => a.year * 12 + a.month;

/**
 * The anchor to keep after a new reading. A page still showing an earlier month (a stale cache) never
 * moves the calendar back; the same month read again keeps a length already confirmed.
 */
export function mergeAnchor(existing: HijriAnchor | null, next: HijriAnchor): HijriAnchor {
  if (!existing || existing.source === 'calendar' || next.source === 'manual') return next;
  if (monthIndex(next) < monthIndex(existing)) return existing;
  if (monthIndex(next) === monthIndex(existing) && next.start === existing.start) {
    const length = next.length ?? existing.length;
    return { ...next, ...(length ? { length } : {}) };
  }
  return next;
}

/** A stored anchor, checked: KV can be edited by hand (`wrangler kv key put`). */
export function parseAnchor(value: unknown): HijriAnchor | null {
  if (!value || typeof value !== 'object') return null;
  const a = value as Record<string, unknown>;
  const int = (v: unknown, min: number, max: number) => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
  if (!int(a.year, 1300, 1700) || !int(a.month, 1, 12)) return null;
  if (typeof a.start !== 'string' || !isDateOnly(a.start)) return null;
  if (a.length !== undefined && a.length !== 29 && a.length !== 30) return null;
  if (a.source !== 'sistani' && a.source !== 'manual' && a.source !== 'calendar') return null;
  return {
    year: a.year as number,
    month: a.month as number,
    start: a.start,
    ...(a.length ? { length: a.length as 29 | 30 } : {}),
    source: a.source,
  };
}

function isDateOnly(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(toUtc(s)) && new Date(toUtc(s)).toISOString().startsWith(s);
}

let umalqura: Intl.DateTimeFormat | undefined;

/** Umm al-Qura's date for `date`: the fallback while sistani.org has never been read. */
export function calendarDateOn(date: string): HijriDate {
  umalqura ??= new Intl.DateTimeFormat('en-u-ca-islamic-umalqura-nu-latn', { timeZone: 'UTC', year: 'numeric', month: 'numeric', day: 'numeric' });
  const parts = umalqura.formatToParts(new Date(toUtc(date)));
  const part = (type: string) => Number.parseInt(parts.find((p) => p.type === type)?.value ?? '', 10);
  return { year: part('year'), month: part('month'), day: part('day') };
}

// ── sistani.org ────────────────────────────────────────────────────────

/** Folds the spellings a month name is written in: hamza forms, ى/ي, ة/ه, harakat, tatweel. */
function normalizeArabic(s: string): string {
  return s
    .replace(/[ً-ٰٟـ]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^شهر /, '');
}

const MONTH_ALIASES: [string, number][] = (
  [
    ['محرم', 1],
    ['صفر', 2],
    ['ربيع الاول', 3],
    ['ربيع الاخر', 4],
    ['ربيع الثاني', 4],
    ['جمادي الاولي', 5],
    ['جمادي الاول', 5],
    ['جمادي الاخره', 6],
    ['جمادي الاخر', 6],
    ['جمادي الثانيه', 6],
    ['جمادي الثاني', 6],
    ['رجب', 7],
    ['شعبان', 8],
    ['رمضان', 9],
    ['شوال', 10],
    ['ذو القعده', 11],
    ['ذي القعده', 11],
    ['ذو الحجه', 12],
    ['ذي الحجه', 12],
  ] as [string, number][]
).sort((a, b) => b[0].length - a[0].length);

export function hijriMonthNumber(name: string): number | null {
  const n = normalizeArabic(name);
  // Also matches a name with an honorific after it (شعبان المعظم, رمضان المبارك).
  const hit = MONTH_ALIASES.find(([alias]) => n === alias || n.startsWith(`${alias} `));
  return hit ? hit[1] : null;
}

const GREGORIAN_MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

const toLatinDigits = (s: string) =>
  s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));

/**
 * The date in sistani.org's `#home-date` block, e.g.
 * `الأربعاء ٩- جمادى الأولى -١٤٤٨ هـ || (النجف الأشرف) || Wed, 21 Oct 2026`. Null when the block is
 * missing or reads as anything else, so a redesign of the page is noticed instead of misread.
 */
export function parseSistaniHomeDate(html: string): HijriReading | null {
  const block = /id=["']home-date["'][^>]*>([\s\S]*?)<\/div>/i.exec(html)?.[1];
  if (!block) return null;
  const text = toLatinDigits(block.replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&#160;/gi, ' ')).replace(/\s+/g, ' ');

  const hijri = /(\d{1,2})\s*-?\s*([^\d|-]+?)\s*-?\s*(\d{4})\s*هـ/.exec(text);
  const gregorian = /(\d{1,2})\s+([A-Za-z]{3})[A-Za-z]*\.?,?\s+(\d{4})/.exec(text);
  if (!hijri || !gregorian) return null;

  const day = Number(hijri[1]);
  const month = hijriMonthNumber(hijri[2]!);
  const year = Number(hijri[3]);
  const gMonth = GREGORIAN_MONTHS.indexOf(gregorian[2]!.toLowerCase());
  if (month === null || day < 1 || day > 30 || year < 1300 || year > 1700 || gMonth < 0) return null;

  const date = `${gregorian[3]}-${String(gMonth + 1).padStart(2, '0')}-${gregorian[1]!.padStart(2, '0')}`;
  if (!isDateOnly(date)) return null;
  return { year, month, day, gregorian: date };
}
