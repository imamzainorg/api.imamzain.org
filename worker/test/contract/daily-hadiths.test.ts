import { describe, expect, it } from 'vitest';
import { adminToken, api, expectError, expectSuccess, ISO_DATE, tokenWith, withDb } from './support/http';

const BASE = '/api/v1/daily-hadiths';
const MISSING = '00000000-0000-4000-8000-000000000000';

const uid = () => `dh-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
const ar = (content: string, source?: string) => ({ lang: 'ar', content, ...(source ? { source } : {}) });
const en = (content: string, source?: string) => ({ lang: 'en', content, ...(source ? { source } : {}) });
const errorsOf = (res: { body: { errors?: string[] } }) => res.body.errors;
const idsOf = (res: { body: { data: { items: { id: string }[] } } }) => res.body.data.items.map((i) => i.id);

/** The site day (SITE_TIMEZONE defaults to Asia/Baghdad). */
const siteToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Baghdad' }).format(new Date());

type Day = { hijri_month: number; hijri_day: number };
/** A random Hijri day, freed first: there are only 360 and the unique index allows one live hadith each. */
async function freeDay(): Promise<Day> {
  const day = { hijri_month: 1 + Math.floor(Math.random() * 12), hijri_day: 1 + Math.floor(Math.random() * 30) };
  await clearDay(day);
  return day;
}
const clearDay = ({ hijri_month, hijri_day }: Day) =>
  withDb((q) => q(`UPDATE daily_hadiths SET deleted_at = now() WHERE hijri_month = $1 AND hijri_day = $2 AND deleted_at IS NULL`, [hijri_month, hijri_day]));

const post = async (body: unknown) => api(BASE, { method: 'POST', token: await adminToken(), body });
const patch = async (id: string, body: unknown) => api(`${BASE}/${id}`, { method: 'PATCH', token: await adminToken(), body });
const del = async (id: string) => api(`${BASE}/${id}`, { method: 'DELETE', token: await adminToken() });
const restore = async (id: string) => api(`${BASE}/${id}/restore`, { method: 'POST', token: await adminToken() });
const admin = async (path: string, lang?: string) => api(`${BASE}${path}`, { token: await adminToken(), lang });
const setHijri = async (body: unknown) => api(`${BASE}/hijri-date`, { method: 'PUT', token: await adminToken(), body });

async function create(body: Record<string, unknown> = {}) {
  const res = await post({ translations: [ar(`${uid()}-ar`)], ...body });
  expectSuccess(res, 201);
  return res.body.data as { id: string; hijri_month: number | null; hijri_day: number | null };
}

const adminRow = async (id: string) => (await admin(`/admin/${id}`)).body.data;
const today = (lang?: string) => api(`${BASE}/today`, { lang });

/** Today's Hijri date as Umm al-Qura counts it: the harness's sistani.org address is unreachable. */
function calendarToday() {
  const parts = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura-nu-latn', { timeZone: 'UTC', year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(
    new Date(`${siteToday()}T00:00:00Z`),
  );
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { year: part('year'), month: part('month'), day: part('day') };
}

// First in the file: the harness starts with an empty KV namespace, and nothing else sets the date before this.
describe('GET /daily-hadiths/hijri-date', () => {
  it('falls back to Umm al-Qura, provisionally and briefly cached, while sistani.org cannot be read', async () => {
    const res = await api(`${BASE}/hijri-date`);
    expectSuccess(res);
    expect(res.body.message).toBe('Hijri date fetched');
    expect(res.body.data).toMatchObject({ date: siteToday(), ...calendarToday(), provisional: true, source: 'calendar' });
    const [, maxAge, sMaxAge] = /^public, max-age=(\d+), s-maxage=(\d+)$/.exec(res.headers.get('cache-control') ?? '') ?? [];
    expect(Number(maxAge)).toBeLessThanOrEqual(300);
    expect(Number(sMaxAge)).toBeLessThanOrEqual(300);
  });

  it('serves a date set by hand, with the month name, until the next one', async () => {
    expectSuccess(await setHijri({ year: 1448, month: 9, day: 30 }));
    const res = await api(`${BASE}/hijri-date`);
    expect(res.body.data).toEqual({ date: siteToday(), year: 1448, month: 9, day: 30, month_name: 'شهر رمضان', provisional: false, source: 'manual' });
    expect(res.headers.get('cache-control')).toMatch(/^public, max-age=\d+, s-maxage=\d+$/);
  });
});

describe('PUT /daily-hadiths/hijri-date', () => {
  it('answers with the date it set', async () => {
    const res = await setHijri({ year: 1448, month: 5, day: 9 });
    expectSuccess(res);
    expect(res.body).toMatchObject({ message: 'Hijri date set', data: { date: siteToday(), year: 1448, month: 5, day: 9, month_name: 'جمادى الأولى', source: 'manual' } });
  });

  it('validates the date, and needs daily-hadiths:update', async () => {
    const res = await setHijri({ year: 1448, month: 13, day: 0 });
    expectError(res, 400, 'VALIDATION_FAILED');
    expect(errorsOf(res)).toEqual(['month must not be greater than 12', 'day must not be less than 1']);
    const body = { year: 1448, month: 1, day: 1 };
    expectError(await api(`${BASE}/hijri-date`, { method: 'PUT', body }), 401, 'UNAUTHORIZED');
    expectError(await api(`${BASE}/hijri-date`, { method: 'PUT', token: await tokenWith(['daily-hadiths:create']), body }), 403, 'FORBIDDEN');
  });
});

describe('GET /daily-hadiths/today', () => {
  it('serves the hadith for today’s Hijri day, in the requested language, cached no later than site midnight', async () => {
    const day = await freeDay();
    await setHijri({ year: 1448, month: day.hijri_month, day: day.hijri_day });
    const h = await create({ ...day, translations: [ar('today-ar', 'src-ar'), en('today-en')] });
    await create({ ...(await freeDay()) });

    const res = await today('en');
    expectSuccess(res);
    expect(res.body).toMatchObject({
      message: "Today's hadith",
      data: { id: h.id, content: 'today-en', source: null, lang: 'en' },
      meta: { date: siteToday(), hijri: { year: 1448, month: day.hijri_month, day: day.hijri_day, provisional: false, source: 'manual' }, source: 'scheduled' },
    });
    expect((await today('fa')).body.data).toEqual({ id: h.id, content: 'today-ar', source: 'src-ar', lang: 'ar' });

    const [, maxAge, sMaxAge] = /^public, max-age=(\d+), s-maxage=(\d+)$/.exec(res.headers.get('cache-control') ?? '') ?? [];
    expect(Number(maxAge)).toBeGreaterThanOrEqual(1);
    expect(Number(maxAge)).toBeLessThanOrEqual(900);
    expect(Number(sMaxAge)).toBeLessThanOrEqual(3600);
    const now = new Date();
    const baghdadSeconds = ((now.getUTCHours() + 3) % 24) * 3600 + now.getUTCMinutes() * 60 + now.getUTCSeconds();
    expect(Number(sMaxAge)).toBeLessThanOrEqual(86400 - baghdadSeconds + 2);
    expect(res.headers.get('vary')).toContain('Accept-Language');
  });

  it('answers data: null for a day with no hadith (never another day’s), and stops showing a trashed one', async () => {
    const day = await freeDay();
    await setHijri({ year: 1448, month: day.hijri_month, day: day.hijri_day });
    await create({ translations: [ar('no-day')] });

    const empty = await today();
    expectSuccess(empty);
    expect(empty.body).toMatchObject({ data: null, meta: { source: 'empty' } });

    const h = await create(day);
    expect((await today()).body.data.id).toBe(h.id);
    await del(h.id);
    expect((await today()).body.data).toBeNull();
  });
});

describe('POST /daily-hadiths', () => {
  it('creates a hadith on a Hijri day and answers 201 with the bare row, not the translations', async () => {
    const day = await freeDay();
    const res = await post({ ...day, translations: [ar(`${uid()}-ar`, 'الصحيفة السجادية'), en(`${uid()}-en`)] });

    expectSuccess(res, 201);
    expect(res.body.message).toBe('Hadith created');
    expect(res.body.data).toMatchObject({ id: expect.any(String), ...day, created_at: expect.stringMatching(ISO_DATE), deleted_at: null });
    expect(res.body.data).not.toHaveProperty('daily_hadith_translations');

    const row = await adminRow(res.body.data.id);
    expect(row).toMatchObject(day);
    expect(row.daily_hadith_translations).toEqual([
      expect.objectContaining({ lang: 'ar', source: 'الصحيفة السجادية' }),
      expect.objectContaining({ lang: 'en', source: null }),
    ]);
  });

  it('leaves the hadith without a day when none is given', async () => {
    const data = await create();
    expect(data).toMatchObject({ hijri_month: null, hijri_day: null });
  });

  it('409s when another live hadith already holds the day', async () => {
    const day = await freeDay();
    await create(day);
    expectError(await post({ ...day, translations: [ar(uid())] }), 409, 'CONFLICT', 'Another hadith is already scheduled to that date');
  });

  it('refuses half a date', async () => {
    expectError(await post({ hijri_month: 3, translations: [ar(uid())] }), 400, 'BAD_REQUEST', 'hijri_month and hijri_day must be provided together');
    expectError(await post({ hijri_month: null, hijri_day: 4, translations: [ar(uid())] }), 400, 'BAD_REQUEST', 'hijri_month and hijri_day must be provided together');
  });

  it('refuses a language listed twice (case-insensitively) before touching the DB', async () => {
    const res = await post({ translations: [ar(uid()), { ...ar(uid()), lang: 'AR' }] });
    expectError(res, 400, 'DUPLICATE_TRANSLATION_LANG', 'translations lists the same language more than once (ar); send one entry per language');
  });

  it('refuses a language that is not in the languages table', async () => {
    expectError(await post({ translations: [{ lang: 'zz', content: uid() }] }), 400, 'FK_CONSTRAINT_VIOLATION');
  });

  describe('validation', () => {
    const t = () => ar(uid());
    const cases: [string, () => unknown, string[]][] = [
      ['a month past 12', () => ({ hijri_month: 13, hijri_day: 1, translations: [t()] }), ['hijri_month must not be greater than 12']],
      ['a day 0', () => ({ hijri_month: 1, hijri_day: 0, translations: [t()] }), ['hijri_day must not be less than 1']],
      ['a fractional day', () => ({ hijri_month: 1, hijri_day: 1.5, translations: [t()] }), ['hijri_day must be an integer number']],
      ['an empty list', () => ({ translations: [] }), ['translations must contain at least 1 elements']],
      ['empty content', () => ({ translations: [{ ...t(), content: '' }] }), ['translations.0.content must be longer than or equal to 1 characters']],
      ['an unknown translation key', () => ({ translations: [{ ...t(), extra: 1 }] }), ['translations.0.property extra should not exist']],
      ['an unknown key', () => ({ translations: [t()], extra: 1 }), ['property extra should not exist']],
    ];

    it.each(cases)('rejects %s', async (_name, body, errors) => {
      const res = await post(body());
      expectError(res, 400, 'VALIDATION_FAILED', 'Validation failed');
      expect(errorsOf(res)).toEqual(errors);
    });
  });

  it('401s without a token and 403s without daily-hadiths:create', async () => {
    const body = { translations: [ar(uid())] };
    expectError(await api(BASE, { method: 'POST', body }), 401, 'UNAUTHORIZED');
    expectError(await api(BASE, { method: 'POST', token: await tokenWith(['daily-hadiths:read']), body }), 403, 'FORBIDDEN');
  });
});

describe('PATCH /daily-hadiths/:id', () => {
  it('upserts translations: replaces the language it names, adds a new one, leaves the rest', async () => {
    const h = await create({ translations: [ar('old-ar', 'old source'), en('old-en')] });
    const res = await patch(h.id, { translations: [ar('new-ar'), { lang: 'fa', content: 'new-fa' }] });

    expectSuccess(res);
    expect(res.body).toMatchObject({ message: 'Hadith updated', data: null });
    const rows = (await adminRow(h.id)).daily_hadith_translations;
    expect(rows).toEqual([
      expect.objectContaining({ lang: 'ar', content: 'new-ar', source: null }),
      expect.objectContaining({ lang: 'en', content: 'old-en' }),
      expect.objectContaining({ lang: 'fa', content: 'new-fa' }),
    ]);
  });

  it('moves a hadith to a day, and nulls take it off the calendar', async () => {
    const h = await create();
    const day = await freeDay();
    expectSuccess(await patch(h.id, day));
    expect(await adminRow(h.id)).toMatchObject(day);

    expectSuccess(await patch(h.id, { hijri_month: null, hijri_day: null }));
    expect(await adminRow(h.id)).toMatchObject({ hijri_month: null, hijri_day: null });
  });

  it('refuses half a date, and leaves the day alone when neither field is sent', async () => {
    const day = await freeDay();
    const h = await create(day);
    expectError(await patch(h.id, { hijri_day: 2 }), 400, 'BAD_REQUEST', 'hijri_month and hijri_day must be provided together');
    expectSuccess(await patch(h.id, { translations: [ar('only-text')] }));
    expect(await adminRow(h.id)).toMatchObject(day);
  });

  it('409s when the new day belongs to another hadith, and changes nothing', async () => {
    const day = await freeDay();
    await create(day);
    const h = await create({ translations: [ar('keep')] });

    expectError(await patch(h.id, { ...day, translations: [ar('lost')] }), 409, 'CONFLICT', 'Another hadith is already scheduled to that date');
    const row = await adminRow(h.id);
    expect(row.hijri_month).toBeNull();
    expect(row.daily_hadith_translations[0].content).toBe('keep');
  });

  it('404s for an unknown or trashed hadith', async () => {
    expectError(await patch(MISSING, {}), 404, 'NOT_FOUND', 'Hadith not found');
    const h = await create();
    expectSuccess(await del(h.id));
    expectError(await patch(h.id, {}), 404, 'NOT_FOUND', 'Hadith not found');
  });

  it('refuses a language listed twice, and a malformed id', async () => {
    const h = await create();
    expectError(await patch(h.id, { translations: [en(uid()), en(uid())] }), 400, 'DUPLICATE_TRANSLATION_LANG');
    expectError(await patch('not-a-uuid', {}), 400, 'INVALID_IDENTIFIER', 'Invalid identifier format');
  });

  it('401s without a token and 403s without daily-hadiths:update', async () => {
    expectError(await api(`${BASE}/${MISSING}`, { method: 'PATCH', body: {} }), 401, 'UNAUTHORIZED');
    expectError(await api(`${BASE}/${MISSING}`, { method: 'PATCH', token: await tokenWith(['daily-hadiths:read']), body: {} }), 403, 'FORBIDDEN');
  });
});

describe('DELETE, trash and restore', () => {
  it('soft-deletes: leaves the admin list, shows in the trash, frees its day', async () => {
    const day = await freeDay();
    const h = await create(day);

    const res = await del(h.id);
    expectSuccess(res);
    expect(res.body).toMatchObject({ message: 'Hadith deleted', data: null });
    expectError(await del(h.id), 404, 'NOT_FOUND', 'Hadith not found');
    expect(idsOf(await admin('/admin?limit=100'))).not.toContain(h.id);

    const trash = await admin('/trash?limit=100');
    expectSuccess(trash);
    expect(trash.body.message).toBe('Trash fetched');
    expect(idsOf(trash)).toContain(h.id);

    await create(day);
  });

  it('restores a hadith with its day', async () => {
    const day = await freeDay();
    const h = await create(day);
    await del(h.id);

    const res = await restore(h.id);
    expectSuccess(res, 200);
    expect(res.body).toMatchObject({ message: 'Hadith restored', data: null, meta: { unscheduled: false, previous_hijri_month: null, previous_hijri_day: null } });
    expect(await adminRow(h.id)).toMatchObject(day);
  });

  it('restores without a day, and says so, when its day was taken while it sat in the trash', async () => {
    await clearDay({ hijri_month: 5, hijri_day: 9 });
    const h = await create({ hijri_month: 5, hijri_day: 9 });
    await del(h.id);
    const taker = await create({ hijri_month: 5, hijri_day: 9 });

    const res = await restore(h.id);
    expectSuccess(res, 200);
    expect(res.body.message).toBe('Hadith restored without its schedule: 9 جمادى الأولى is now taken by another hadith');
    expect(res.body.meta).toEqual({ unscheduled: true, previous_hijri_month: 5, previous_hijri_day: 9 });
    expect(await adminRow(h.id)).toMatchObject({ hijri_month: null, hijri_day: null });
    expect(await adminRow(taker.id)).toMatchObject({ hijri_month: 5, hijri_day: 9 });
  });

  it('404s restoring a live or unknown hadith', async () => {
    const h = await create();
    expectError(await restore(h.id), 404, 'NOT_FOUND', 'Deleted hadith not found');
    expectError(await restore(MISSING), 404, 'NOT_FOUND', 'Deleted hadith not found');
  });

  it('needs daily-hadiths:delete for delete, restore and the trash', async () => {
    const token = await tokenWith(['daily-hadiths:read', 'daily-hadiths:update']);
    expectError(await api(`${BASE}/${MISSING}`, { method: 'DELETE', token }), 403, 'FORBIDDEN');
    expectError(await api(`${BASE}/${MISSING}/restore`, { method: 'POST', token }), 403, 'FORBIDDEN');
    expectError(await api(`${BASE}/trash`, { token }), 403, 'FORBIDDEN');
    expectError(await api(`${BASE}/trash`), 401, 'UNAUTHORIZED');
  });
});

describe('GET /daily-hadiths/admin', () => {
  it('lists live hadiths newest first with their Hijri day and the resolved translation', async () => {
    const day = await freeDay();
    const older = await create({ ...day, translations: [ar('ar-text'), en('en-text')] });
    const newer = await create();
    const gone = await create();
    await del(gone.id);

    const res = await admin('/admin?limit=100', 'en');
    expectSuccess(res);
    expect(res.body.message).toBe('Hadiths fetched');
    const ids = idsOf(res);
    expect(ids).not.toContain(gone.id);
    expect(ids.indexOf(newer.id)).toBeLessThan(ids.indexOf(older.id));
    const item = res.body.data.items.find((i: { id: string }) => i.id === older.id);
    expect(item).toMatchObject({ ...day, translation: { lang: 'en', content: 'en-text' } });
    expect(item.daily_hadith_translations).toHaveLength(2);
    expect(res.body.data.pagination).toMatchObject({ page: 1, limit: 100, total: expect.any(Number), pages: expect.any(Number) });
  });

  it('falls back to Arabic when the requested language has no translation', async () => {
    const h = await create({ translations: [ar('only-ar'), en('en-too')] });
    const res = await admin(`/admin/${h.id}`, 'fa');
    expectSuccess(res);
    expect(res.body.message).toBe('Hadith fetched');
    expect(res.body.data.translation).toMatchObject({ lang: 'ar', content: 'only-ar' });
  });

  it('404s an unknown or trashed id and 400s a malformed one', async () => {
    expectError(await admin(`/admin/${MISSING}`), 404, 'NOT_FOUND', 'Hadith not found');
    const h = await create();
    await del(h.id);
    expectError(await admin(`/admin/${h.id}`), 404, 'NOT_FOUND', 'Hadith not found');
    expectError(await admin('/admin/nope'), 400, 'INVALID_IDENTIFIER');
  });

  it('validates pagination, and needs daily-hadiths:read', async () => {
    const res = await admin('/admin?page=0&limit=101');
    expectError(res, 400, 'VALIDATION_FAILED');
    expect(errorsOf(res)).toEqual(['page must not be less than 1', 'limit must not be greater than 100']);
    expectError(await api(`${BASE}/admin`), 401, 'UNAUTHORIZED');
    expectError(await api(`${BASE}/admin`, { token: await tokenWith(['daily-hadiths:create']) }), 403, 'FORBIDDEN');
    expectError(await api(`${BASE}/admin/${MISSING}`, { token: await tokenWith(['daily-hadiths:create']) }), 403, 'FORBIDDEN');
  });
});

describe('GET /daily-hadiths (public)', () => {
  it('lists a Hijri month in calendar order, filters by day, and is CDN-cacheable', async () => {
    const month = 1 + Math.floor(Math.random() * 12);
    for (const d of [3, 10, 20]) await clearDay({ hijri_month: month, hijri_day: d });
    const h20 = await create({ hijri_month: month, hijri_day: 20, translations: [ar('ar-20'), en('en-20')] });
    const h3 = await create({ hijri_month: month, hijri_day: 3 });
    const h10 = await create({ hijri_month: month, hijri_day: 10 });

    const res = await api(`${BASE}?hijri_month=${month}&limit=100`, { lang: 'en' });
    expectSuccess(res);
    expect(res.body.message).toBe('Hadiths fetched');
    expect(res.headers.get('cache-control')).toBe('public, max-age=300, s-maxage=1800');
    expect(res.headers.get('vary')).toContain('Accept-Language');
    const ids = idsOf(res);
    expect(ids.indexOf(h3.id)).toBeLessThan(ids.indexOf(h10.id));
    expect(ids.indexOf(h10.id)).toBeLessThan(ids.indexOf(h20.id));
    expect(res.body.data.items.find((i: { id: string }) => i.id === h20.id)).toEqual({ id: h20.id, hijri_month: month, hijri_day: 20, content: 'en-20', source: null, lang: 'en' });

    expect(idsOf(await api(`${BASE}?hijri_month=${month}&hijri_day=10`))).toEqual([h10.id]);
  });

  it('400s a day without a month, and validates the numbers and pagination', async () => {
    expectError(await api(`${BASE}?hijri_day=4`), 400, 'BAD_REQUEST', 'hijri_day requires hijri_month');
    const res = await api(`${BASE}?hijri_month=13&hijri_day=x&limit=0`);
    expectError(res, 400, 'VALIDATION_FAILED');
    expect(errorsOf(res)).toEqual(['hijri_month must not be greater than 12', 'hijri_day must be a number conforming to the specified constraints', 'limit must not be less than 1']);
  });

  it('keeps a hadith out of the page and the total when its only translation is in a retired language', async () => {
    const day = await freeDay();
    const h = await create({ ...day, translations: [en(uid())] });
    const query = `${BASE}?hijri_month=${day.hijri_month}&hijri_day=${day.hijri_day}`;
    expect(idsOf(await api(query))).toEqual([h.id]);

    await withDb((q) => q(`UPDATE languages SET is_active = false WHERE code = 'en'`));
    try {
      const res = await api(query);
      expectSuccess(res);
      expect(res.body.data.items).toEqual([]);
      expect(res.body.data.pagination.total).toBe(0);
    } finally {
      await withDb((q) => q(`UPDATE languages SET is_active = true WHERE code = 'en'`));
    }
  });
});
