import { describe, expect, it } from 'vitest';
import { adminToken, api, expectError, expectSuccess, ISO_DATE, tokenWith } from './support/http';

const BASE = '/api/v1/stores';
const MISSING = '00000000-0000-4000-8000-000000000000';

const uid = () => `st-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
const city = (lang: string, name: string) => ({ lang, city_name: name });
const place = (lang: string, name: string, address = `Address ${name}`) => ({ lang, name, address });
const errorsOf = (res: { body: { errors?: string[] } }) => res.body.errors;
const idsOf = (res: { body: { data: { items: { id: string }[] } } }) => res.body.data.items.map((i) => i.id);

const post = async (body: unknown) => api(BASE, { method: 'POST', token: await adminToken(), body });
const patch = async (id: string, body: unknown) => api(`${BASE}/${id}`, { method: 'PATCH', token: await adminToken(), body });
const del = async (id: string) => api(`${BASE}/${id}`, { method: 'DELETE', token: await adminToken() });
const restore = async (id: string) => api(`${BASE}/${id}/restore`, { method: 'POST', token: await adminToken() });
const addLocation = async (id: string, body: unknown) => api(`${BASE}/${id}/locations`, { method: 'POST', token: await adminToken(), body });
const patchLocation = async (id: string, loc: string, body: unknown) =>
  api(`${BASE}/${id}/locations/${loc}`, { method: 'PATCH', token: await adminToken(), body });
const delLocation = async (id: string, loc: string) => api(`${BASE}/${id}/locations/${loc}`, { method: 'DELETE', token: await adminToken() });

async function create(body: Record<string, unknown> = {}) {
  const res = await post({ translations: [city('ar', uid()), city('en', uid())], ...body });
  expectSuccess(res, 201);
  return res.body.data;
}

describe('POST /stores', () => {
  it('creates the store with translations and sale-points and answers 201 with the hydrated row', async () => {
    const name = uid();
    const res = await post({
      translations: [city('en', `${name}-en`), city('ar', `${name}-ar`)],
      display_order: 3,
      locations: [{ phone: '+964 770 000 0000', gps_link: 'https://maps.app.goo.gl/abc123', display_order: 1, translations: [place('ar', 'مكتبة'), place('en', 'Shop')] }],
    });

    expectSuccess(res, 201);
    expect(res.body.message).toBe('Store created');
    const data = res.body.data;
    expect(Object.keys(data)).toEqual(['id', 'display_order', 'created_at', 'updated_at', 'deleted_at', 'store_translations', 'store_locations', 'translation']);
    expect(data).toMatchObject({ display_order: 3, created_at: expect.stringMatching(ISO_DATE), deleted_at: null });
    // Translations come back ordered by language code.
    expect(data.store_translations).toEqual([
      { store_id: data.id, lang: 'ar', city_name: `${name}-ar` },
      { store_id: data.id, lang: 'en', city_name: `${name}-en` },
    ]);
    expect(data.translation).toMatchObject({ lang: 'ar' });
    expect(data.store_locations).toHaveLength(1);
    expect(data.store_locations[0]).toMatchObject({
      store_id: data.id,
      phone: '+964 770 000 0000',
      gps_embed_url: null,
      gps_link: 'https://maps.app.goo.gl/abc123',
      display_order: 1,
      translation: { lang: 'ar', name: 'مكتبة' },
    });
    expect(data.store_locations[0].store_location_translations.map((t: { lang: string }) => t.lang)).toEqual(['ar', 'en']);
  });

  it('defaults display_order to 0 and accepts no locations', async () => {
    const data = await create();
    expect(data).toMatchObject({ display_order: 0, store_locations: [] });
  });

  describe('validation', () => {
    const ok = () => city('ar', uid());
    const loc = () => ({ translations: [place('ar', 'n')] });
    const cases: [string, unknown, string[]][] = [
      ['an empty list', { translations: [] }, ['translations must contain at least 1 elements']],
      ['a three-letter lang', { translations: [{ ...ok(), lang: 'abc' }] }, ['translations.0.lang must be shorter than or equal to 2 characters']],
      ['an empty city_name', { translations: [{ ...ok(), city_name: '' }] }, ['translations.0.city_name must be longer than or equal to 1 characters']],
      ['a 201-char city_name', { translations: [{ ...ok(), city_name: 'x'.repeat(201) }] }, ['translations.0.city_name must be shorter than or equal to 200 characters']],
      ['a negative display_order', { translations: [ok()], display_order: -1 }, ['display_order must not be less than 0']],
      ['a fractional display_order', { translations: [ok()], display_order: 1.5 }, ['display_order must be an integer number']],
      ['an unknown key', { translations: [ok()], extra: 1 }, ['property extra should not exist']],
            ['a location with an empty translation list', { translations: [ok()], locations: [{ translations: [] }] }, ['locations.0.translations must contain at least 1 elements']],
      ['a long phone', { translations: [ok()], locations: [{ ...loc(), phone: 'x'.repeat(51) }] }, ['locations.0.phone must be shorter than or equal to 50 characters']],
      ['a bad gps_link', { translations: [ok()], locations: [{ ...loc(), gps_link: 'not a url' }] }, ['locations.0.gps_link must be a URL address']],
      ['a gps_embed_url without protocol', { translations: [ok()], locations: [{ ...loc(), gps_embed_url: 'www.google.com/maps' }] }, ['locations.0.gps_embed_url must be a URL address']],
      ['an empty address', { translations: [ok()], locations: [{ translations: [place('ar', 'n', '')] }] }, ['locations.0.translations.0.address must be longer than or equal to 1 characters']],
      ['a 501-char address', { translations: [ok()], locations: [{ translations: [place('ar', 'n', 'x'.repeat(501))] }] }, ['locations.0.translations.0.address must be shorter than or equal to 500 characters']],
      ['a 301-char location name', { translations: [ok()], locations: [{ translations: [place('ar', 'x'.repeat(301))] }] }, ['locations.0.translations.0.name must be shorter than or equal to 300 characters']],
      ['an unknown location key', { translations: [ok()], locations: [{ ...loc(), extra: 1 }] }, ['locations.0.property extra should not exist']],
    ];

    it.each(cases)('rejects %s with Nest’s messages', async (_name, body, errors) => {
      const res = await post(body);
      expectError(res, 400, 'VALIDATION_FAILED', 'Validation failed');
      expect(errorsOf(res)).toEqual(errors);
    });

    it('rejects a location without translations', async () => {
      const res = await post({ translations: [ok()], locations: [{}] });
      expectError(res, 400, 'VALIDATION_FAILED', 'Validation failed');
      expect(errorsOf(res)).toContain('locations.0.translations must be an array');
    });

    it('rejects 201 locations', async () => {
      const res = await post({ translations: [city('ar', uid())], locations: Array.from({ length: 201 }, loc) });
      expectError(res, 400, 'VALIDATION_FAILED', 'Validation failed');
      expect(errorsOf(res)).toEqual(['locations must contain no more than 200 elements']);
    });
  });

  it('refuses a language that does not exist, and creates nothing', async () => {
    expectError(
      await post({ translations: [city('zz', uid())] }),
      400,
      'FK_CONSTRAINT_VIOLATION',
      'Foreign key constraint failed — referenced record does not exist',
    );
  });

  it('is 401 without a token and 403 without stores:create', async () => {
    expectError(await api(BASE, { method: 'POST', body: {} }), 401, 'UNAUTHORIZED', 'Unauthorized');
    const token = await tokenWith(['stores:update', 'stores:delete']);
    expectError(await api(BASE, { method: 'POST', token, body: { translations: [city('ar', uid())] } }), 403, 'FORBIDDEN');
  });
});

describe('GET /stores', () => {
  it('lists live stores by display_order with their live locations, CDN-cacheable', async () => {
    const late = await create({ display_order: 900_000_002 });
    const early = await create({ display_order: 900_000_001, locations: [{ translations: [place('ar', uid()), place('en', uid())] }] });
    const gone = await create({ display_order: 900_000_000 });
    expectSuccess(await del(gone.id));

    const res = await api(`${BASE}?limit=100`, { lang: 'en' });

    expectSuccess(res);
    expect(res.body.message).toBe('Stores fetched');
    expect(res.headers.get('cache-control')).toBe('public, max-age=300, s-maxage=1800');
    expect(res.headers.get('vary')).toMatch(/Accept-Language/);
    const ids = idsOf(res);
    expect(ids.indexOf(early.id)).toBeLessThan(ids.indexOf(late.id));
    expect(ids).not.toContain(gone.id);
    const item = res.body.data.items.find((i: { id: string }) => i.id === early.id);
    expect(item.translation.lang).toBe('en');
    expect(item.store_locations[0].translation.lang).toBe('en');
    expect(res.body.data.pagination).toEqual({ page: 1, limit: 100, total: expect.any(Number), pages: expect.any(Number) });
  });

  it.each([
    ['?page=0', ['page must not be less than 1']],
    ['?limit=101', ['limit must not be greater than 100']],
    ['?foo=1', ['property foo should not exist']],
  ])('rejects %s', async (query, errors) => {
    const res = await api(`${BASE}${query}`);
    expectError(res, 400, 'VALIDATION_FAILED', 'Validation failed');
    expect(errorsOf(res)).toEqual(errors);
  });
});

describe('GET /stores/:id', () => {
  it('answers with the store, CDN-cacheable, and 304 for a matching If-None-Match', async () => {
    const store = await create({ locations: [{ translations: [place('ar', uid())] }] });
    const res = await api(`${BASE}/${store.id}`);

    expectSuccess(res);
    expect(res.body.message).toBe('Store fetched');
    expect(res.body.data).toEqual(store);
    expect(res.headers.get('cache-control')).toBe('public, max-age=300, s-maxage=1800');
    const etag = res.headers.get('etag');
    expect(etag).toMatch(/^W\/"[\w-]+"$/);
    expect((await api(`${BASE}/${store.id}`, { headers: { 'if-none-match': etag!, 'cache-control': 'max-age=0' } })).status).toBe(304);
  });

  it('resolves the requested language, else ar', async () => {
    const store = await create();
    const lang = async (l?: string) => (await api(`${BASE}/${store.id}`, { lang: l })).body.data.translation.lang;
    expect(await lang('en')).toBe('en');
    expect(await lang('de')).toBe('ar');
  });

  it('is 404 for a missing or soft-deleted store, never cached, and 400 for a malformed id', async () => {
    const store = await create();
    expectSuccess(await del(store.id));

    for (const id of [MISSING, store.id]) {
      const res = await api(`${BASE}/${id}`);
      expectError(res, 404, 'NOT_FOUND', 'Store not found');
      expect(res.headers.get('cache-control')).toBe('no-store');
    }
    expectError(await api(`${BASE}/not-a-uuid`), 400, 'INVALID_IDENTIFIER', 'Invalid identifier format');
  });
});

describe('PATCH /stores/:id', () => {
  it('updates display_order and upserts city names, answering with the hydrated row', async () => {
    const name = uid();
    const store = await create({ translations: [city('ar', name)] });

    const res = await patch(store.id, { display_order: 7, translations: [city('en', 'Karbala'), city('ar', `${name}-2`)] });

    expectSuccess(res);
    expect(res.body.message).toBe('Store updated');
    expect(res.body.data.display_order).toBe(7);
    expect(res.body.data.store_translations.map((t: { lang: string; city_name: string }) => [t.lang, t.city_name])).toEqual([
      ['ar', `${name}-2`],
      ['en', 'Karbala'],
    ]);
    expect(Date.parse(res.body.data.updated_at)).toBeGreaterThan(Date.parse(store.updated_at));
  });

  it('accepts an empty body and bumps updated_at only', async () => {
    const store = await create({ display_order: 4 });
    const res = await patch(store.id, {});
    expectSuccess(res);
    expect(res.body.data).toMatchObject({ display_order: 4, store_translations: store.store_translations });
  });

  it('is 404 for a missing or soft-deleted store, 400 for a malformed id or body, 403 without stores:update', async () => {
    const store = await create();
    expectSuccess(await del(store.id));
    expectError(await patch(MISSING, {}), 404, 'NOT_FOUND', 'Store not found');
    expectError(await patch(store.id, {}), 404, 'NOT_FOUND', 'Store not found');
    expectError(await patch('not-a-uuid', {}), 400, 'INVALID_IDENTIFIER', 'Invalid identifier format');

    const bad = await patch(MISSING, { display_order: -1 });
    expectError(bad, 400, 'VALIDATION_FAILED', 'Validation failed');
    expect(errorsOf(bad)).toEqual(['display_order must not be less than 0']);

    const token = await tokenWith(['stores:create']);
    expectError(await api(`${BASE}/${MISSING}`, { method: 'PATCH', token, body: {} }), 403, 'FORBIDDEN');
  });
});

describe('locations', () => {
  it('adds a sale-point and answers with the whole store', async () => {
    const store = await create();
    const res = await addLocation(store.id, { phone: '123', gps_embed_url: 'https://www.google.com/maps/embed?pb=1', translations: [place('ar', 'مكتبة جديدة')] });

    expectSuccess(res, 201);
    expect(res.body.message).toBe('Store location added');
    expect(res.body.data.id).toBe(store.id);
    expect(res.body.data.store_locations).toHaveLength(1);
    expect(res.body.data.store_locations[0]).toMatchObject({ phone: '123', gps_embed_url: 'https://www.google.com/maps/embed?pb=1', display_order: 0 });
  });

  it('updates scalars and upserts translations', async () => {
    const store = await create({ locations: [{ phone: '1', display_order: 2, translations: [place('ar', 'قديم')] }] });
    const loc = store.store_locations[0];

    const res = await patchLocation(store.id, loc.id, { phone: '2', display_order: 5, translations: [place('ar', 'جديد', 'عنوان'), place('en', 'New')] });

    expectSuccess(res);
    expect(res.body.message).toBe('Store location updated');
    const updated = res.body.data.store_locations[0];
    expect(updated).toMatchObject({ id: loc.id, phone: '2', display_order: 5, gps_link: null });
    expect(updated.store_location_translations).toEqual([
      { location_id: loc.id, lang: 'ar', name: 'جديد', address: 'عنوان' },
      { location_id: loc.id, lang: 'en', name: 'New', address: 'Address New' },
    ]);
    expectSuccess(await patchLocation(store.id, loc.id, {}));
  });

  it('soft-deletes a sale-point out of every read', async () => {
    const store = await create({ locations: [{ translations: [place('ar', uid())] }, { translations: [place('ar', uid())] }] });
    const [first, second] = store.store_locations;

    const res = await delLocation(store.id, first.id);

    expectSuccess(res);
    expect(res.body.message).toBe('Store location deleted');
    expect(res.body.data.store_locations.map((l: { id: string }) => l.id)).toEqual([second.id]);
    expectError(await delLocation(store.id, first.id), 404, 'NOT_FOUND', 'Store location not found');
    expectError(await patchLocation(store.id, first.id, {}), 404, 'NOT_FOUND', 'Store location not found');
  });

  it('is 404 for a missing, deleted or foreign store / location', async () => {
    const store = await create({ locations: [{ translations: [place('ar', uid())] }] });
    const other = await create();
    const loc = store.store_locations[0];

    expectError(await addLocation(MISSING, { translations: [place('ar', 'n')] }), 404, 'NOT_FOUND', 'Store not found');
    expectError(await patchLocation(other.id, loc.id, {}), 404, 'NOT_FOUND', 'Store location not found');
    expectError(await delLocation(MISSING, loc.id), 404, 'NOT_FOUND', 'Store location not found');
    expectSuccess(await del(other.id));
    expectError(await addLocation(other.id, { translations: [place('ar', 'n')] }), 404, 'NOT_FOUND', 'Store not found');
  });

  it('validates the body', async () => {
    const store = await create({ locations: [{ translations: [place('ar', uid())] }] });
    const add = await addLocation(store.id, { gps_link: 'nope' });
    expectError(add, 400, 'VALIDATION_FAILED', 'Validation failed');
    expect(errorsOf(add)).toEqual(expect.arrayContaining(['gps_link must be a URL address', 'translations must be an array']));

    const upd = await patchLocation(store.id, store.store_locations[0].id, { display_order: -2, phone: 'x'.repeat(51) });
    expectError(upd, 400, 'VALIDATION_FAILED', 'Validation failed');
    expect(errorsOf(upd)).toEqual(['phone must be shorter than or equal to 50 characters', 'display_order must not be less than 0']);
  });

  it('needs stores:update to add or edit and stores:delete to remove', async () => {
    const store = await create({ locations: [{ translations: [place('ar', uid())] }] });
    const loc = store.store_locations[0];
    const onlyCreate = await tokenWith(['stores:create']);
    const onlyUpdate = await tokenWith(['stores:update']);

    expectError(await api(`${BASE}/${store.id}/locations`, { method: 'POST', body: {} }), 401, 'UNAUTHORIZED');
    expectError(await api(`${BASE}/${store.id}/locations`, { method: 'POST', token: onlyCreate, body: {} }), 403, 'FORBIDDEN');
    expectError(await api(`${BASE}/${store.id}/locations/${loc.id}`, { method: 'PATCH', token: onlyCreate, body: {} }), 403, 'FORBIDDEN');
    expectError(await api(`${BASE}/${store.id}/locations/${loc.id}`, { method: 'DELETE', token: onlyUpdate }), 403, 'FORBIDDEN');
  });
});

describe('DELETE, trash and restore', () => {
  it('soft-deletes, lists the store in the trash and restores it', async () => {
    const store = await create({ locations: [{ translations: [place('ar', uid())] }] });

    const res = await del(store.id);
    expectSuccess(res);
    expect(res.body).toMatchObject({ message: 'Store deleted', data: null });
    expectError(await del(store.id), 404, 'NOT_FOUND', 'Store not found');

    const trash = await api(`${BASE}/trash?limit=100`, { token: await adminToken() });
    expectSuccess(trash);
    expect(trash.body.message).toBe('Trash fetched');
    const item = trash.body.data.items.find((i: { id: string }) => i.id === store.id);
    expect(item.deleted_at).toMatch(ISO_DATE);
    expect(item.store_locations).toHaveLength(1);

    const back = await restore(store.id);
    expectSuccess(back);
    expect(back.body).toMatchObject({ message: 'Store restored', data: null });
    expect((await api(`${BASE}/${store.id}`)).body.data.store_locations).toHaveLength(1);
    expectError(await restore(store.id), 404, 'NOT_FOUND', 'Deleted store not found');
  });

  it('is 404 / 400 for missing and malformed ids', async () => {
    expectError(await del(MISSING), 404, 'NOT_FOUND', 'Store not found');
    expectError(await restore(MISSING), 404, 'NOT_FOUND', 'Deleted store not found');
    expectError(await del('not-a-uuid'), 400, 'INVALID_IDENTIFIER');
    expectError(await restore('not-a-uuid'), 400, 'INVALID_IDENTIFIER');
  });

  it('needs stores:delete for delete, trash and restore', async () => {
    const store = await create();
    const token = await tokenWith(['stores:create', 'stores:update']);

    expectError(await api(`${BASE}/trash`), 401, 'UNAUTHORIZED');
    expectError(await api(`${BASE}/trash`, { token }), 403, 'FORBIDDEN');
    expectError(await api(`${BASE}/${store.id}`, { method: 'DELETE', token }), 403, 'FORBIDDEN');
    expectError(await api(`${BASE}/${store.id}/restore`, { method: 'POST', token }), 403, 'FORBIDDEN');
  });
});
