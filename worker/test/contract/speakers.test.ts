import { describe, expect, it } from 'vitest';
import { adminToken, api, expectError, expectSuccess, ISO_DATE, tokenWith, withDb } from './support/http';

const BASE = '/api/v1/speakers';
const MISSING = '00000000-0000-4000-8000-000000000000';

/** A name no earlier run used: the suite runs twice on one DB in CI. */
const uid = () => `spk-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
const tr = (lang: string, name: string, isDefault?: boolean) => ({ lang, name, ...(isDefault === undefined ? {} : { is_default: isDefault }) });
const errorsOf = (res: { body: { errors?: string[] } }) => res.body.errors;
const idsOf = (res: { body: { data: { items: { id: string }[] } } }) => res.body.data.items.map((i) => i.id);

const post = async (body: unknown) => api(BASE, { method: 'POST', token: await adminToken(), body });
const patch = async (id: string, body: unknown) => api(`${BASE}/${id}`, { method: 'PATCH', token: await adminToken(), body });
const del = async (id: string) => api(`${BASE}/${id}`, { method: 'DELETE', token: await adminToken() });
const restore = async (id: string) => api(`${BASE}/${id}/restore`, { method: 'POST', token: await adminToken() });

async function create(translations: unknown[]) {
  const res = await post({ translations });
  expectSuccess(res, 201);
  return res.body.data;
}

describe('POST /speakers', () => {
  it('creates the speaker with its translations and answers 201 with the hydrated row', async () => {
    const name = uid();
    const res = await post({ translations: [tr('ar', `${name}-ar`, true), tr('en', `${name}-en`)] });

    expectSuccess(res, 201);
    expect(res.body.message).toBe('Speaker created');
    const data = res.body.data;
    expect(Object.keys(data)).toEqual(['id', 'created_at', 'updated_at', 'deleted_at', 'speaker_translations', 'translation', 'audio_count']);
    expect(data).toMatchObject({ created_at: expect.stringMatching(ISO_DATE), deleted_at: null, audio_count: 0 });
    expect(data.speaker_translations).toHaveLength(2);
    expect(data.speaker_translations).toContainEqual({ speaker_id: data.id, lang: 'en', name: `${name}-en`, is_default: false });
    expect(data.translation).toEqual({ speaker_id: data.id, lang: 'ar', name: `${name}-ar`, is_default: true });
  });

  it('refuses a translation set without exactly one default', async () => {
    for (const translations of [[tr('ar', uid())], [tr('ar', uid(), true), tr('en', uid(), true)], [tr('ar', uid(), false)]]) {
      expectError(await post({ translations }), 400, 'BAD_REQUEST', 'Exactly one translation must have is_default = true');
    }
  });

  it('refuses the same language twice', async () => {
    expectError(
      await post({ translations: [tr('ar', uid(), true), tr('ar', uid())] }),
      409,
      'CONFLICT',
      'Duplicate translation language for this speaker',
    );
  });

  it('refuses a language that does not exist', async () => {
    expectError(
      await post({ translations: [tr('zz', uid(), true)] }),
      400,
      'FK_CONSTRAINT_VIOLATION',
      'Foreign key constraint failed — referenced record does not exist',
    );
  });

  describe('validation', () => {
    const ok = () => tr('ar', uid(), true);
    const cases: [string, unknown, string[]][] = [
      ['an empty list', { translations: [] }, ['translations must contain at least 1 elements']],
      ['51 translations', { translations: Array.from({ length: 51 }, ok) }, ['translations must contain no more than 50 elements']],
      ['a one-letter lang', { translations: [{ ...ok(), lang: 'a' }] }, ['translations.0.lang must be longer than or equal to 2 characters']],
      ['a three-letter lang', { translations: [{ ...ok(), lang: 'abc' }] }, ['translations.0.lang must be shorter than or equal to 2 characters']],
      ['an empty name', { translations: [{ ...ok(), name: '' }] }, ['translations.0.name must be longer than or equal to 1 characters']],
      ['a 301-char name', { translations: [{ ...ok(), name: 'x'.repeat(301) }] }, ['translations.0.name must be shorter than or equal to 300 characters']],
      ['a non-boolean is_default', { translations: [{ ...ok(), is_default: 'yes' }] }, ['translations.0.is_default must be a boolean value']],
      ['an unknown translation key', { translations: [{ ...ok(), extra: 1 }] }, ['translations.0.property extra should not exist']],
      ['an unknown top-level key', { translations: [ok()], extra: 1 }, ['property extra should not exist']],
    ];

    it.each(cases)('rejects %s with Nest’s messages', async (_name, body, errors) => {
      const res = await post(body);
      expectError(res, 400, 'VALIDATION_FAILED', 'Validation failed');
      expect(errorsOf(res)).toEqual(errors);
    });

    it('rejects a missing list', async () => {
      const res = await post({});
      expectError(res, 400, 'VALIDATION_FAILED', 'Validation failed');
      expect(errorsOf(res)).toContain('translations must be an array');
    });
  });

  it('is 401 without a token, before validation, and 403 without audios:create', async () => {
    expectError(await api(BASE, { method: 'POST', body: {} }), 401, 'UNAUTHORIZED', 'Unauthorized');
    const token = await tokenWith(['audios:update', 'audios:delete']);
    expectError(await api(BASE, { method: 'POST', token, body: { translations: [tr('ar', uid(), true)] } }), 403, 'FORBIDDEN');
  });
});

describe('GET /speakers', () => {
  it('lists live speakers newest first, CDN-cacheable, with the translation for Accept-Language', async () => {
    const name = uid();
    const older = await create([tr('ar', `${name}-a`, true), tr('en', `${name}-a`)]);
    const newer = await create([tr('ar', `${name}-b`, true), tr('en', `${name}-b`)]);

    const res = await api(`${BASE}?limit=100`, { lang: 'en-US,en;q=0.9' });

    expectSuccess(res);
    expect(res.body.message).toBe('Speakers fetched');
    expect(res.headers.get('cache-control')).toBe('public, max-age=60, s-maxage=300');
    expect(res.headers.get('vary')).toMatch(/Accept-Language/);
    expect(idsOf(res).indexOf(newer.id)).toBeLessThan(idsOf(res).indexOf(older.id));
    expect(res.body.data.items.find((i: { id: string }) => i.id === newer.id).translation.lang).toBe('en');
    expect(res.body.data.pagination).toEqual({ page: 1, limit: 100, total: expect.any(Number), pages: expect.any(Number) });
  });

  it('searches names case-insensitively, trims the term and ignores a blank one', async () => {
    const name = uid();
    const hit = await create([tr('ar', `Needle-${name}`, true)]);
    const miss = await create([tr('ar', uid(), true)]);

    const found = await api(`${BASE}?limit=100&search=${encodeURIComponent(`  needle-${name.toUpperCase()}  `)}`);
    expectSuccess(found);
    expect(idsOf(found)).toEqual([hit.id]);

    const blank = await api(`${BASE}?limit=100&search=%20%20`);
    expectSuccess(blank);
    expect(idsOf(blank)).toEqual(expect.arrayContaining([hit.id, miss.id]));
  });

  it('counts only live, published audios', async () => {
    const speaker = await create([tr('ar', uid(), true)]);
    await withDb(async (q) => {
      await q('INSERT INTO audios (speaker_id, audio_url) VALUES ($1, $2)', [speaker.id, `https://example.test/${uid()}.mp3`]);
      await q('INSERT INTO audios (speaker_id, audio_url, is_published) VALUES ($1, $2, false)', [speaker.id, `https://example.test/${uid()}.mp3`]);
      await q('INSERT INTO audios (speaker_id, audio_url, deleted_at) VALUES ($1, $2, now())', [speaker.id, `https://example.test/${uid()}.mp3`]);
    });

    const res = await api(`${BASE}/${speaker.id}`);
    expect(res.body.data.audio_count).toBe(1);
  });

  it('paginates and hides soft-deleted speakers', async () => {
    const gone = await create([tr('ar', uid(), true)]);
    await create([tr('ar', uid(), true)]);
    expectSuccess(await del(gone.id));

    const page = await api(`${BASE}?page=2&limit=1`);
    expectSuccess(page);
    expect(page.body.data.items).toHaveLength(1);
    expect(page.body.data.pagination).toMatchObject({ page: 2, limit: 1 });
    expect(idsOf(await api(`${BASE}?limit=100`))).not.toContain(gone.id);
  });

  it.each([
    ['?page=0', ['page must not be less than 1']],
    ['?limit=101', ['limit must not be greater than 100']],
    ['?search=a', ['search must be longer than or equal to 2 characters']],
    [`?search=${'x'.repeat(201)}`, ['search must be shorter than or equal to 200 characters']],
    ['?foo=1', ['property foo should not exist']],
  ])('rejects %s', async (query, errors) => {
    const res = await api(`${BASE}${query}`);
    expectError(res, 400, 'VALIDATION_FAILED', 'Validation failed');
    expect(errorsOf(res)).toEqual(errors);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });
});

describe('GET /speakers/:id', () => {
  it('resolves the requested language, else the default one', async () => {
    const speaker = await create([tr('en', uid(), true), tr('ar', uid())]);
    const lang = async (l?: string) => (await api(`${BASE}/${speaker.id}`, { lang: l })).body.data.translation.lang;

    expect(await lang('ar')).toBe('ar');
    expect(await lang('de')).toBe('en');
    expect(await lang()).toBe('en');
  });

  it('answers with the speaker, CDN-cacheable, and 304 for a matching If-None-Match', async () => {
    const speaker = await create([tr('ar', uid(), true)]);
    const res = await api(`${BASE}/${speaker.id}`);

    expectSuccess(res);
    expect(res.body.message).toBe('Speaker fetched');
    expect(res.body.data).toEqual(speaker);
    expect(res.headers.get('cache-control')).toBe('public, max-age=60, s-maxage=300');
    const etag = res.headers.get('etag');
    expect(etag).toMatch(/^W\/"[\w-]+"$/);
    expect((await api(`${BASE}/${speaker.id}`, { headers: { 'if-none-match': etag!, 'cache-control': 'max-age=0' } })).status).toBe(304);
  });

  it('is 404 for a missing or soft-deleted speaker, never cached, and 400 for a malformed id', async () => {
    const speaker = await create([tr('ar', uid(), true)]);
    expectSuccess(await del(speaker.id));

    for (const id of [MISSING, speaker.id]) {
      const res = await api(`${BASE}/${id}`);
      expectError(res, 404, 'NOT_FOUND', 'Speaker not found');
      expect(res.headers.get('cache-control')).toBe('no-store');
    }
    expectError(await api(`${BASE}/not-a-uuid`), 400, 'INVALID_IDENTIFIER', 'Invalid identifier format');
  });
});

describe('PATCH /speakers/:id', () => {
  it('upserts translations and answers with the hydrated row', async () => {
    const name = uid();
    const speaker = await create([tr('ar', name, true), tr('en', name)]);

    const res = await patch(speaker.id, { translations: [tr('en', 'Renamed'), tr('fa', name), tr('ar', name, true)] });

    expectSuccess(res);
    expect(res.body.message).toBe('Speaker updated');
    const byLang = Object.fromEntries(res.body.data.speaker_translations.map((t: { lang: string }) => [t.lang, t]));
    expect(Object.keys(byLang).sort()).toEqual(['ar', 'en', 'fa']);
    expect(byLang.en).toMatchObject({ name: 'Renamed', is_default: false });
  });

  it('moves the default, and refuses a result without exactly one', async () => {
    const speaker = await create([tr('ar', uid(), true), tr('en', uid())]);

    expectSuccess(await patch(speaker.id, { translations: [tr('en', 'Now default', true), tr('ar', 'Demoted', false)] }));
    expect((await api(`${BASE}/${speaker.id}`, { lang: 'de' })).body.data.translation).toMatchObject({ lang: 'en', is_default: true });

    expectError(await patch(speaker.id, { translations: [tr('ar', 'Also default', true)] }), 400, 'BAD_REQUEST', 'Exactly one translation must have is_default: true');
    // The failed request rolled back.
    expect((await api(`${BASE}/${speaker.id}`)).body.data.speaker_translations.find((t: { lang: string }) => t.lang === 'ar').name).toBe('Demoted');
  });

  it('accepts an empty body or a null list and changes nothing', async () => {
    const speaker = await create([tr('ar', uid(), true)]);
    for (const body of [{}, { translations: null }]) {
      const res = await patch(speaker.id, body);
      expectSuccess(res);
      expect(res.body.data.speaker_translations).toEqual(speaker.speaker_translations);
    }
  });

  it('is 404 for a missing or soft-deleted speaker and 400 for a malformed id', async () => {
    const speaker = await create([tr('ar', uid(), true)]);
    expectSuccess(await del(speaker.id));

    expectError(await patch(MISSING, {}), 404, 'NOT_FOUND', 'Speaker not found');
    expectError(await patch(speaker.id, {}), 404, 'NOT_FOUND', 'Speaker not found');
    expectError(await patch('not-a-uuid', {}), 400, 'INVALID_IDENTIFIER', 'Invalid identifier format');
  });

  it('is 401 / 403 without audios:update', async () => {
    const speaker = await create([tr('ar', uid(), true)]);
    expectError(await api(`${BASE}/${speaker.id}`, { method: 'PATCH', body: {} }), 401, 'UNAUTHORIZED');
    const token = await tokenWith(['audios:create']);
    expectError(await api(`${BASE}/${speaker.id}`, { method: 'PATCH', token, body: {} }), 403, 'FORBIDDEN');
  });
});

describe('DELETE, trash and restore', () => {
  it('soft-deletes, lists the speaker in the trash and restores it', async () => {
    const speaker = await create([tr('ar', uid(), true)]);

    const res = await del(speaker.id);
    expectSuccess(res);
    expect(res.body).toMatchObject({ message: 'Speaker deleted', data: null });
    expectError(await del(speaker.id), 404, 'NOT_FOUND', 'Speaker not found');

    const trash = await api(`${BASE}/trash?limit=100`, { token: await adminToken() });
    expectSuccess(trash);
    expect(trash.body.message).toBe('Trash fetched');
    const item = trash.body.data.items.find((i: { id: string }) => i.id === speaker.id);
    expect(item.deleted_at).toMatch(ISO_DATE);
    expect(item.translation).toMatchObject({ lang: 'ar', is_default: true });

    const back = await restore(speaker.id);
    expectSuccess(back);
    expect(back.body).toMatchObject({ message: 'Speaker restored', data: null });
    expectSuccess(await api(`${BASE}/${speaker.id}`));
    expectError(await restore(speaker.id), 404, 'NOT_FOUND', 'Deleted speaker not found');
  });

  it('refuses to delete a speaker that still has live audios', async () => {
    const speaker = await create([tr('ar', uid(), true)]);
    await withDb((q) => q('INSERT INTO audios (speaker_id, audio_url) VALUES ($1, $2)', [speaker.id, `https://example.test/${uid()}.mp3`]));

    expectError(await del(speaker.id), 409, 'CONFLICT', 'Cannot delete a speaker that still has audios — reassign them first');
  });

  it('is 404 / 400 for missing and malformed ids', async () => {
    expectError(await del(MISSING), 404, 'NOT_FOUND', 'Speaker not found');
    expectError(await restore(MISSING), 404, 'NOT_FOUND', 'Deleted speaker not found');
    expectError(await del('not-a-uuid'), 400, 'INVALID_IDENTIFIER');
    expectError(await restore('not-a-uuid'), 400, 'INVALID_IDENTIFIER');
  });

  it('needs audios:delete for delete, trash and restore', async () => {
    const speaker = await create([tr('ar', uid(), true)]);
    const token = await tokenWith(['audios:create', 'audios:update']);

    expectError(await api(`${BASE}/trash`), 401, 'UNAUTHORIZED');
    expectError(await api(`${BASE}/trash`, { token }), 403, 'FORBIDDEN');
    expectError(await api(`${BASE}/${speaker.id}`, { method: 'DELETE', token }), 403, 'FORBIDDEN');
    expectError(await api(`${BASE}/${speaker.id}/restore`, { method: 'POST', token }), 403, 'FORBIDDEN');
  });
});
