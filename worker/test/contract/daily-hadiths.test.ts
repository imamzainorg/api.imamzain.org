import { describe, expect, it } from 'vitest';
import { adminToken, api, expectError, expectSuccess, ISO_DATE, tokenWith, withDb } from './support/http';

const BASE = '/api/v1/daily-hadiths';
const MISSING = '00000000-0000-4000-8000-000000000000';

const uid = () => `dh-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
const ar = (content: string, source?: string) => ({ lang: 'ar', content, ...(source ? { source } : {}) });
const en = (content: string, source?: string) => ({ lang: 'en', content, ...(source ? { source } : {}) });
const errorsOf = (res: { body: { errors?: string[] } }) => res.body.errors;
const idsOf = (res: { body: { data: { items: { id: string }[] } } }) => res.body.data.items.map((i) => i.id);

/** The site day (SITE_TIMEZONE defaults to Asia/Baghdad on both targets). */
const siteToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Baghdad' }).format(new Date());

/** A date no earlier run or real hadith uses: the display_date index is unique and the suite runs twice on one DB. */
const farDate = () => `${2200 + Math.floor(Math.random() * 790)}-${String(1 + Math.floor(Math.random() * 12)).padStart(2, '0')}-${String(1 + Math.floor(Math.random() * 28)).padStart(2, '0')}`;

const post = async (body: unknown) => api(BASE, { method: 'POST', token: await adminToken(), body });
const patch = async (id: string, body: unknown) => api(`${BASE}/${id}`, { method: 'PATCH', token: await adminToken(), body });
const del = async (id: string) => api(`${BASE}/${id}`, { method: 'DELETE', token: await adminToken() });
const restore = async (id: string) => api(`${BASE}/${id}/restore`, { method: 'POST', token: await adminToken() });
const admin = async (path: string, lang?: string) => api(`${BASE}${path}`, { token: await adminToken(), lang });

async function create(body: Record<string, unknown> = {}) {
  const res = await post({ translations: [ar(`${uid()}-ar`)], ...body });
  expectSuccess(res, 201);
  return res.body.data as { id: string; display_date: string | null };
}

const adminRow = async (id: string) => (await admin(`/admin/${id}`)).body.data;

/** Removes every live hadith scheduled to `date` (setup the API can't do for rows that aren't ours). */
const clearDate = (date: string) =>
  withDb((q) => q(`UPDATE daily_hadiths SET deleted_at = now() WHERE display_date = $1 AND deleted_at IS NULL`, [date]));

const clearTodayLock = () => withDb((q) => q(`DELETE FROM daily_hadith_random_picks WHERE pick_date = $1`, [siteToday()]));

/** Runs `fn` with no live unscheduled hadith and no lock for today, then puts the trashed ones back. */
async function withEmptyPool<T>(fn: () => Promise<T>): Promise<T> {
  const trashed = await withDb((q) => q(`UPDATE daily_hadiths SET deleted_at = now() WHERE display_date IS NULL AND deleted_at IS NULL RETURNING id`));
  await clearDate(siteToday());
  await clearTodayLock();
  try {
    return await fn();
  } finally {
    await clearTodayLock();
    await withDb((q) => q(`UPDATE daily_hadiths SET deleted_at = NULL WHERE id = ANY($1::uuid[])`, [trashed.map((r) => r.id)]));
  }
}

const today = (lang?: string) => api(`${BASE}/today`, { lang });

describe('POST /daily-hadiths', () => {
  it('creates a scheduled hadith and answers 201 with the bare row, not the translations', async () => {
    const date = farDate();
    const res = await post({ display_date: date, translations: [ar(`${uid()}-ar`, 'الصحيفة السجادية'), en(`${uid()}-en`)] });

    expectSuccess(res, 201);
    expect(res.body.message).toBe('Hadith created');
    expect(res.body.data).toMatchObject({ id: expect.any(String), display_date: `${date}T00:00:00.000Z`, created_at: expect.stringMatching(ISO_DATE), deleted_at: null });
    expect(res.body.data).not.toHaveProperty('daily_hadith_translations');

    const row = await adminRow(res.body.data.id);
    expect(row.display_date).toBe(date);
    expect(row.daily_hadith_translations).toEqual([
      expect.objectContaining({ lang: 'ar', source: 'الصحيفة السجادية' }),
      expect.objectContaining({ lang: 'en', source: null }),
    ]);
  });

  it('leaves the hadith unscheduled when no date is given', async () => {
    const data = await create();
    expect(data.display_date).toBeNull();
    expect((await adminRow(data.id)).display_date).toBeNull();
  });

  it('409s when another live hadith already holds the date', async () => {
    const date = farDate();
    await create({ display_date: date });
    expectError(await post({ display_date: date, translations: [ar(uid())] }), 409, 'CONFLICT', 'Another hadith is already scheduled to that date');
  });

  it('refuses a language listed twice (case-insensitively) before touching the DB', async () => {
    const res = await post({ translations: [ar(uid()), { ...ar(uid()), lang: 'AR' }] });
    expectError(res, 400, 'DUPLICATE_TRANSLATION_LANG', 'translations lists the same language more than once (ar); send one entry per language');
  });

  it('refuses a calendar date that does not exist even though it matches the shape', async () => {
    expectError(await post({ display_date: '2026-02-30', translations: [ar(uid())] }), 400, 'BAD_REQUEST', 'display_date is not a valid calendar date');
  });

  it('refuses a language that is not in the languages table', async () => {
    expectError(await post({ translations: [{ lang: 'zz', content: uid() }] }), 400, 'FK_CONSTRAINT_VIOLATION');
  });

  describe('validation', () => {
    const t = () => ar(uid());
    const cases: [string, () => unknown, string[]][] = [
      ['a malformed date', () => ({ display_date: '15/05/2026', translations: [t()] }), ['display_date must be YYYY-MM-DD']],
      ['an empty list', () => ({ translations: [] }), ['translations must contain at least 1 elements']],
      ['a 51-item list', () => ({ translations: Array.from({ length: 51 }, t) }), ['translations must contain no more than 50 elements']],
      ['a three-letter lang', () => ({ translations: [{ ...t(), lang: 'abc' }] }), ['translations.0.lang must be shorter than or equal to 2 characters']],
      ['empty content', () => ({ translations: [{ ...t(), content: '' }] }), ['translations.0.content must be longer than or equal to 1 characters']],
      ['4001-char content', () => ({ translations: [{ ...t(), content: 'x'.repeat(4001) }] }), ['translations.0.content must be shorter than or equal to 4000 characters']],
      ['a 501-char source', () => ({ translations: [{ ...t(), source: 'x'.repeat(501) }] }), ['translations.0.source must be shorter than or equal to 500 characters']],
      ['an unknown translation key', () => ({ translations: [{ ...t(), extra: 1 }] }), ['translations.0.property extra should not exist']],
      ['an unknown key', () => ({ translations: [t()], extra: 1 }), ['property extra should not exist']],
    ];

    it.each(cases)('rejects %s with Nest’s messages', async (_name, body, errors) => {
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

  it('schedules a hadith, and null returns it to the unscheduled pool', async () => {
    const h = await create();
    const date = farDate();
    expectSuccess(await patch(h.id, { display_date: date }));
    expect((await adminRow(h.id)).display_date).toBe(date);

    expectSuccess(await patch(h.id, { display_date: null }));
    expect((await adminRow(h.id)).display_date).toBeNull();
  });

  it('409s when the new date belongs to another hadith, and changes nothing', async () => {
    const date = farDate();
    await create({ display_date: date });
    const h = await create({ translations: [ar('keep')] });

    expectError(await patch(h.id, { display_date: date, translations: [ar('lost')] }), 409, 'CONFLICT', 'Another hadith is already scheduled to that date');
    const row = await adminRow(h.id);
    expect(row.display_date).toBeNull();
    expect(row.daily_hadith_translations[0].content).toBe('keep');
  });

  it('404s for an unknown or trashed hadith', async () => {
    expectError(await patch(MISSING, { display_date: null }), 404, 'NOT_FOUND', 'Hadith not found');
    const h = await create();
    expectSuccess(await del(h.id));
    expectError(await patch(h.id, { display_date: null }), 404, 'NOT_FOUND', 'Hadith not found');
  });

  it('refuses a language listed twice, and a malformed id', async () => {
    const h = await create();
    expectError(await patch(h.id, { translations: [en(uid()), en(uid())] }), 400, 'DUPLICATE_TRANSLATION_LANG');
    expectError(await patch('not-a-uuid', { display_date: null }), 400, 'INVALID_IDENTIFIER', 'Invalid identifier format');
  });

  it.each([
    ['a malformed date', { display_date: '2026-5-1' }],
    ['a non-string date', { display_date: 20260501 }],
  ])('rejects %s with the date message only', async (_name, body) => {
    const h = await create();
    const res = await patch(h.id, body);
    expectError(res, 400, 'VALIDATION_FAILED', 'Validation failed');
    expect(errorsOf(res)).toEqual(['display_date must be YYYY-MM-DD']);
  });

  it('401s without a token and 403s without daily-hadiths:update', async () => {
    expectError(await api(`${BASE}/${MISSING}`, { method: 'PATCH', body: {} }), 401, 'UNAUTHORIZED');
    expectError(await api(`${BASE}/${MISSING}`, { method: 'PATCH', token: await tokenWith(['daily-hadiths:read']), body: {} }), 403, 'FORBIDDEN');
  });
});

describe('DELETE, trash and restore', () => {
  it('soft-deletes: leaves the admin list, shows in the trash, frees its date', async () => {
    const date = farDate();
    const h = await create({ display_date: date });

    const res = await del(h.id);
    expectSuccess(res);
    expect(res.body).toMatchObject({ message: 'Hadith deleted', data: null });
    expectError(await del(h.id), 404, 'NOT_FOUND', 'Hadith not found');
    expect(idsOf(await admin('/admin?limit=100'))).not.toContain(h.id);

    const trash = await admin('/trash?limit=100');
    expectSuccess(trash);
    expect(trash.body.message).toBe('Trash fetched');
    expect(idsOf(trash)).toContain(h.id);

    await create({ display_date: date });
  });

  it('restores a hadith with its date', async () => {
    const date = farDate();
    const h = await create({ display_date: date });
    await del(h.id);

    const res = await restore(h.id);
    expectSuccess(res, 200);
    expect(res.body).toMatchObject({ message: 'Hadith restored', data: null, meta: { unscheduled: false, previous_display_date: null } });
    expect((await adminRow(h.id)).display_date).toBe(date);
  });

  it('restores unscheduled, and says so, when its date was taken while it sat in the trash', async () => {
    const date = farDate();
    const h = await create({ display_date: date });
    await del(h.id);
    const taker = await create({ display_date: date });

    const res = await restore(h.id);
    expectSuccess(res, 200);
    expect(res.body.message).toBe(`Hadith restored without its schedule: ${date} is now taken by another hadith`);
    expect(res.body.meta).toEqual({ unscheduled: true, previous_display_date: date });
    expect((await adminRow(h.id)).display_date).toBeNull();
    expect((await adminRow(taker.id)).display_date).toBe(date);
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
  it('lists live hadiths newest first with the date as YYYY-MM-DD and the resolved translation', async () => {
    const date = farDate();
    const older = await create({ display_date: date, translations: [ar('ar-text'), en('en-text')] });
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
    expect(item).toMatchObject({ display_date: date, translation: { lang: 'en', content: 'en-text' } });
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
  it('browses live hadiths newest first, resolves the language, and is CDN-cacheable', async () => {
    const first = await create({ translations: [ar('first-ar'), en('first-en')] });
    const second = await create();
    const gone = await create();
    await del(gone.id);

    const res = await api(`${BASE}?limit=100`, { lang: 'en' });
    expectSuccess(res);
    expect(res.body.message).toBe('Hadiths fetched');
    expect(res.headers.get('cache-control')).toBe('public, max-age=300, s-maxage=1800');
    expect(res.headers.get('vary')).toContain('Accept-Language');
    const ids = idsOf(res);
    expect(ids).not.toContain(gone.id);
    expect(ids.indexOf(second.id)).toBeLessThan(ids.indexOf(first.id));
    expect(res.body.data.items.find((i: { id: string }) => i.id === first.id)).toEqual({ id: first.id, display_date: null, content: 'first-en', source: null, lang: 'en' });
  });

  it('filters by an exact date, and by an inclusive range ordered by date', async () => {
    const base = farDate().slice(0, 7);
    const [d1, d2, d3] = [`${base}-03`, `${base}-10`, `${base}-20`];
    for (const d of [d1, d2, d3]) await clearDate(d);
    const h3 = await create({ display_date: d3 });
    const h1 = await create({ display_date: d1 });
    const h2 = await create({ display_date: d2 });

    expect(idsOf(await api(`${BASE}?date=${d2}`))).toEqual([h2.id]);
    expect(idsOf(await api(`${BASE}?date=${base}-04`))).toEqual([]);
    expect(idsOf(await api(`${BASE}?from=${d1}&to=${d3}`))).toEqual([h1.id, h2.id, h3.id]);
    expect(idsOf(await api(`${BASE}?from=${d1}&to=${d2}`))).toEqual([h1.id, h2.id]);
  });

  it('never falls back to a random pick: a date nobody holds returns an empty page', async () => {
    const res = await api(`${BASE}?date=${farDate()}`);
    expectSuccess(res);
    expect(res.body.data.items).toEqual([]);
    expect(res.body.data.pagination.total).toBe(0);
  });

  it.each([
    ['date with from/to', 'date=2026-05-01&from=2026-05-01&to=2026-05-31', 'date cannot be combined with from/to'],
    ['from without to', 'from=2026-05-01', 'from and to must be provided together'],
    ['to without from', 'to=2026-05-01', 'from and to must be provided together'],
    ['from after to', 'from=2026-06-01&to=2026-05-01', 'from must be on or before to'],
    ['an impossible date', 'date=2026-02-30', 'date is not a valid calendar date'],
    ['an impossible range end', 'from=2026-05-01&to=2026-04-31', 'to is not a valid calendar date'],
  ])('400s %s', async (_name, query, message) => {
    expectError(await api(`${BASE}?${query}`), 400, 'BAD_REQUEST', message);
  });

  it('validates the date shape and pagination with Nest’s messages', async () => {
    const res = await api(`${BASE}?date=tomorrow&from=x&limit=0`);
    expectError(res, 400, 'VALIDATION_FAILED');
    expect(errorsOf(res)).toEqual(['date must be YYYY-MM-DD', 'from must be YYYY-MM-DD', 'limit must not be less than 1']);
  });

  it('keeps a hadith out of the page and the total when its only translation is in a retired language', async () => {
    const date = farDate();
    const h = await create({ display_date: date, translations: [en(uid())] });
    expect(idsOf(await api(`${BASE}?date=${date}`))).toEqual([h.id]);

    await withDb((q) => q(`UPDATE languages SET is_active = false WHERE code = 'en'`));
    try {
      const res = await api(`${BASE}?date=${date}`);
      expectSuccess(res);
      expect(res.body.data.items).toEqual([]);
      expect(res.body.data.pagination.total).toBe(0);
    } finally {
      await withDb((q) => q(`UPDATE languages SET is_active = true WHERE code = 'en'`));
    }
  });
});

describe('GET /daily-hadiths/today', () => {
  it('serves the hadith scheduled to the site day, in the requested language, with a cache lifetime that ends at site midnight', async () => {
    const date = siteToday();
    await clearDate(date);
    const h = await create({ display_date: date, translations: [ar('today-ar', 'src-ar'), en('today-en')] });

    const res = await today('en');
    expectSuccess(res);
    expect(res.body).toMatchObject({
      message: "Today's hadith",
      data: { id: h.id, content: 'today-en', source: null, lang: 'en' },
      meta: { date, source: 'scheduled' },
    });
    expect((await today('fa')).body.data).toEqual({ id: h.id, content: 'today-ar', source: 'src-ar', lang: 'ar' });

    const [, maxAge, sMaxAge] = /^public, max-age=(\d+), s-maxage=(\d+)$/.exec(res.headers.get('cache-control') ?? '') ?? [];
    expect(Number(maxAge)).toBeGreaterThanOrEqual(1);
    expect(Number(maxAge)).toBeLessThanOrEqual(900);
    expect(Number(sMaxAge)).toBeGreaterThanOrEqual(1);
    expect(Number(sMaxAge)).toBeLessThanOrEqual(3600);
    const now = new Date();
    const baghdadSeconds = ((now.getUTCHours() + 3) % 24) * 3600 + now.getUTCMinutes() * 60 + now.getUTCSeconds();
    expect(Number(sMaxAge)).toBeLessThanOrEqual(86400 - baghdadSeconds + 2);
    expect(res.headers.get('vary')).toContain('Accept-Language');
  });

  it('draws once from the unscheduled pool, keeps that pick for the whole day, and never draws a hadith scheduled elsewhere', async () => {
    await withEmptyPool(async () => {
      const pick = await create({ translations: [ar('pool-ar')] });
      await create({ display_date: farDate() });

      const first = await today();
      expectSuccess(first);
      expect(first.body.data).toEqual({ id: pick.id, content: 'pool-ar', source: null, lang: 'ar' });
      expect(first.body.meta).toEqual({ date: siteToday(), source: 'random' });

      await create({ translations: [ar('joins-the-pool-late')] });
      expect((await today()).body.data.id).toBe(pick.id);

      // The pick survives the hadith being trashed for the rest of the day.
      await del(pick.id);
      const after = await today();
      expect(after.body.data.id).toBe(pick.id);
      expect(after.body.meta.source).toBe('random');
    });
  });

  it('lets a hadith scheduled for today override the locked pick, and goes back to the pick when it is removed', async () => {
    await withEmptyPool(async () => {
      const pick = await create();
      expect((await today()).body.data.id).toBe(pick.id);

      const scheduled = await create({ display_date: siteToday() });
      const res = await today();
      expect(res.body.data.id).toBe(scheduled.id);
      expect(res.body.meta.source).toBe('scheduled');

      await del(scheduled.id);
      const back = await today();
      expect(back.body.data.id).toBe(pick.id);
      expect(back.body.meta.source).toBe('random');
    });
  });

  it('answers data: null when nothing is eligible, and releases that empty lock the moment a hadith joins the pool', async () => {
    await withEmptyPool(async () => {
      const empty = await today();
      expectSuccess(empty);
      expect(empty.body).toMatchObject({ message: "Today's hadith", data: null, meta: { date: siteToday(), source: 'empty' } });

      // A scheduled-elsewhere hadith is not in the pool, so the empty answer stays.
      await create({ display_date: farDate() });
      expect((await today()).body.data).toBeNull();

      const joined = await create({ translations: [ar('joined')] });
      const res = await today();
      expect(res.body.data).toMatchObject({ id: joined.id, content: 'joined' });
      expect(res.body.meta.source).toBe('random');
    });
  });

  it('also releases an empty lock when a hadith is unscheduled into the pool', async () => {
    await withEmptyPool(async () => {
      const h = await create({ display_date: farDate() });
      expect((await today()).body.meta.source).toBe('empty');

      expectSuccess(await patch(h.id, { display_date: null }));
      expect((await today()).body.data?.id).toBe(h.id);
    });
  });

  it('also releases an empty lock when a hadith is restored into the pool', async () => {
    await withEmptyPool(async () => {
      const h = await create();
      await del(h.id);
      expect((await today()).body.meta.source).toBe('empty');

      expectSuccess(await restore(h.id));
      expect((await today()).body.data?.id).toBe(h.id);
    });
  });
});
