import { describe, expect, it } from 'vitest';
import { anchorFromReading, calendarDateOn, hijriOn, mergeAnchor, needsCheck, parseSistaniHomeDate, type HijriAnchor } from '../src/lib/hijri';

// sistani.org's markup on 2026-10-21.
const page = (hijri: string, gregorian = 'Wed, 21 Oct 2026') => `<div id="logo"></div>
<div id="home-date">
<span style="margin-left:9px;">${hijri}</span>||
<span style="margin-right:9px;"></span> (النجف الأشرف)
&nbsp;&nbsp;&nbsp;||&nbsp;&nbsp;&nbsp;
${gregorian}
</div>
<div id="qrcode" style="left:0;"></div>`;

// 1 Jumada I 1448 fell on 2026-10-13 in Najaf.
const jumada1 = (extra: Partial<HijriAnchor> = {}): HijriAnchor => ({ year: 1448, month: 5, start: '2026-10-13', source: 'sistani', ...extra });

describe('reading sistani.org', () => {
  it('reads the Hijri date and the Gregorian day it belongs to', () => {
    expect(parseSistaniHomeDate(page('الأربعاء ٩- جمادى الأولى -١٤٤٨ هـ '))).toEqual({ year: 1448, month: 5, day: 9, gregorian: '2026-10-21' });
  });

  it.each([
    ['ربيع الثاني', 4],
    ['جمادى الآخرة', 6],
    ['جمادى الثانية', 6],
    ['شهر رمضان المبارك', 9],
    ['ذي الحجة', 12],
  ])('knows %s as month %i', (name, month) => {
    expect(parseSistaniHomeDate(page(`السبت ٣- ${name} -١٤٤٨ هـ`))?.month).toBe(month);
  });

  it('refuses a page it cannot read rather than guessing', () => {
    expect(parseSistaniHomeDate('<div id="other">٩ جمادى الأولى ١٤٤٨ هـ</div>')).toBeNull();
    expect(parseSistaniHomeDate(page('الأربعاء ٩- شهر مجهول -١٤٤٨ هـ'))).toBeNull();
    expect(parseSistaniHomeDate(page('الأربعاء ٩- جمادى الأولى -١٤٤٨ هـ', ''))).toBeNull();
  });
});

describe('counting from an anchor', () => {
  it('counts days within the month without asking anyone', () => {
    expect(hijriOn(jumada1(), '2026-10-21')).toEqual({ year: 1448, month: 5, day: 9, provisional: false, source: 'sistani' });
    expect(needsCheck(jumada1(), '2026-10-21')).toBe(false);
  });

  it('treats the day after the 29th as a provisional 30th until the month length is known', () => {
    expect(hijriOn(jumada1(), '2026-11-11')).toMatchObject({ month: 5, day: 30, provisional: true });
    expect(needsCheck(jumada1(), '2026-11-11')).toBe(true);
    expect(hijriOn(jumada1({ length: 30 }), '2026-11-11')).toMatchObject({ month: 5, day: 30, provisional: false });
    expect(hijriOn(jumada1({ length: 29 }), '2026-11-11')).toMatchObject({ month: 6, day: 1, provisional: false });
  });

  it('rolls past an unconfirmed month as 30 days, provisionally, and into the next year', () => {
    expect(hijriOn(jumada1(), '2026-11-13')).toMatchObject({ month: 6, day: 2, provisional: true });
    expect(hijriOn({ year: 1448, month: 12, start: '2027-05-08', length: 29, source: 'sistani' }, '2027-06-06')).toMatchObject({ year: 1449, month: 1, day: 1 });
    expect(hijriOn(jumada1(), '2026-10-12')).toBeNull();
  });

  it('always rechecks an Umm al-Qura stand-in', () => {
    expect(needsCheck({ ...jumada1(), source: 'calendar' }, '2026-10-21')).toBe(true);
    expect(calendarDateOn('2026-10-12')).toEqual({ year: 1448, month: 5, day: 1 });
  });
});

describe('storing a reading', () => {
  it('learns the month length from a 30th, and keeps it when the same month is read again', () => {
    const thirtieth = anchorFromReading({ year: 1448, month: 5, day: 30, gregorian: '2026-11-11' }, 'sistani');
    expect(thirtieth).toEqual(jumada1({ length: 30 }));

    const reread = anchorFromReading({ year: 1448, month: 5, day: 30, gregorian: '2026-11-11' }, 'sistani');
    expect(mergeAnchor(thirtieth, { ...reread, length: undefined })).toEqual(jumada1({ length: 30 }));
  });

  it('starts the next month on the day sistani.org shows its 1st', () => {
    const first = anchorFromReading({ year: 1448, month: 6, day: 1, gregorian: '2026-11-11' }, 'sistani');
    expect(mergeAnchor(jumada1(), first)).toEqual({ year: 1448, month: 6, start: '2026-11-11', source: 'sistani' });
    expect(hijriOn(first, '2026-11-11')).toMatchObject({ month: 6, day: 1, provisional: false });
  });

  it('never moves the calendar back for a stale page, but a hand-set date always wins', () => {
    const june = { year: 1448, month: 6, start: '2026-11-11', source: 'sistani' } as const;
    const stale = anchorFromReading({ year: 1448, month: 5, day: 29, gregorian: '2026-11-10' }, 'sistani');
    expect(mergeAnchor(june, stale)).toBe(june);
    expect(mergeAnchor(june, { ...stale, source: 'manual' })).toEqual({ ...stale, source: 'manual' });
  });
});
