import { describe, expect, it } from 'vitest';
import { adminToken, api, expectError, expectSuccess, ISO_DATE, tokenWith, withDb } from './http';
import type { Query } from '../../harness/token';

const MISSING = '00000000-0000-4000-8000-000000000000';

export interface CategorySuite {
  /** URL segment and permission prefix, e.g. `book-categories`. */
  base: string;
  /** Short slug prefix, so the groups' test data never collide. */
  idPrefix: string;
  /** Name of the translations relation on the category row, e.g. `book_category_translations`. */
  translationKey: string;
  /** Inserts one live row that uses the category, through the unported child table. */
  insertChild: (q: Query, categoryId: string, slug: string) => Promise<unknown>;
  childConflict: string;
}

/** The black-box suite every *-categories group shares; they differ only in the names in CategorySuite. */
export function categorySuite(cfg: CategorySuite) {
  const BASE = `/api/v1/${cfg.base}`;
  const T = cfg.translationKey;

  /** A slug no earlier run used: the suite runs twice on one DB in CI. */
  const uid = () => `${cfg.idPrefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  const tr = (lang: string, slug: string, extra: Record<string, unknown> = {}) => ({ lang, title: `Title ${lang} ${slug}`, slug, ...extra });

  async function create(translations: unknown[]) {
    const res = await api(BASE, { method: 'POST', token: await adminToken(), body: { translations } });
    expectSuccess(res, 201);
    return res.body.data;
  }

  async function remove(id: string) {
    expectSuccess(await api(`${BASE}/${id}`, { method: 'DELETE', token: await adminToken() }));
  }

  const post = async (body: unknown) => api(BASE, { method: 'POST', token: await adminToken(), body });
  const errorsOf = (res: { body: { errors?: string[] } }) => res.body.errors;

  describe(`POST /${cfg.base}`, () => {
    it('creates the category with its translations and answers 201 with the hydrated row', async () => {
      const slug = uid();
      const res = await post({ translations: [tr('en', slug), tr('ar', slug, { description: 'وصف' })] });

      expectSuccess(res, 201);
      expect(res.body.message).toBe('Category created');
      const data = res.body.data;
      expect(Object.keys(data)).toEqual(['id', 'created_at', 'deleted_at', T, 'translation']);
      expect(data).toMatchObject({ created_at: expect.stringMatching(ISO_DATE), deleted_at: null });
      expect(data[T]).toHaveLength(2);
      expect(data[T]).toContainEqual({ category_id: data.id, lang: 'en', title: `Title en ${slug}`, slug, description: null });
      // No language asked for: the site's primary language wins.
      expect(data.translation).toEqual({ category_id: data.id, lang: 'ar', title: `Title ar ${slug}`, slug, description: 'وصف' });
    });

    it('accepts a null description', async () => {
      const data = await create([tr('ar', uid(), { description: null })]);
      expect(data.translation.description).toBeNull();
    });

    it('refuses a slug another category uses in the same language', async () => {
      const slug = uid();
      await create([tr('ar', slug)]);

      expectError(await post({ translations: [tr('ar', slug)] }), 409, 'SLUG_ALREADY_USED', `Slug "${slug}" (ar) is already used by another category`);
      // The same slug in another language is fine.
      await create([tr('en', slug)]);
    });

    it('refuses the same language twice', async () => {
      expectError(
        await post({ translations: [tr('ar', uid()), tr('ar', uid())] }),
        409,
        'DUPLICATE_TRANSLATION_LANG',
        'translations lists the same language more than once; send one entry per language',
      );
    });

    it('refuses a language that does not exist', async () => {
      expectError(
        await post({ translations: [tr('zz', uid())] }),
        400,
        'FK_CONSTRAINT_VIOLATION',
        'Foreign key constraint failed — referenced record does not exist',
      );
    });

    describe('validation', () => {
      const ok = () => tr('ar', uid());
      const cases: [string, unknown, string[]][] = [
        ['an empty list', { translations: [] }, ['translations must contain at least 1 elements']],
        ['51 translations', { translations: Array.from({ length: 51 }, ok) }, ['translations must contain no more than 50 elements']],
        ['a one-letter lang', { translations: [{ ...ok(), lang: 'a' }] }, ['translations.0.lang must be longer than or equal to 2 characters']],
        ['a three-letter lang', { translations: [{ ...ok(), lang: 'abc' }] }, ['translations.0.lang must be shorter than or equal to 2 characters']],
        ['an empty title', { translations: [{ ...ok(), title: '' }] }, ['translations.0.title must be longer than or equal to 1 characters']],
        ['a 501-char title', { translations: [{ ...ok(), title: 'x'.repeat(501) }] }, ['translations.0.title must be shorter than or equal to 500 characters']],
        ['a bad slug', { translations: [{ ...ok(), slug: 'Bad Slug' }] }, ['translations.0.slug must match /^[a-z0-9]+(?:-[a-z0-9]+)*$/ regular expression']],
        [
          'a long bad slug',
          { translations: [{ ...ok(), slug: 'A'.repeat(201) }] },
          ['translations.0.slug must be shorter than or equal to 200 characters', 'translations.0.slug must match /^[a-z0-9]+(?:-[a-z0-9]+)*$/ regular expression'],
        ],
        ['a 5001-char description', { translations: [{ ...ok(), description: 'x'.repeat(5001) }] }, ['translations.0.description must be shorter than or equal to 5000 characters']],
        ['an unknown translation key', { translations: [{ ...ok(), extra: 1 }] }, ['translations.0.property extra should not exist']],
        ['an unknown top-level key', { translations: [ok()], extra: 1 }, ['property extra should not exist']],
        [
          'errors in two entries',
          { translations: [{ ...ok(), title: '', slug: 'Bad' }, { lang: 'e', title: 'x', slug: 'fine' }] },
          [
            'translations.0.title must be longer than or equal to 1 characters',
            'translations.0.slug must match /^[a-z0-9]+(?:-[a-z0-9]+)*$/ regular expression',
            'translations.1.lang must be longer than or equal to 2 characters',
          ],
        ],
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

    describe('auth', () => {
      it('is 401 without a token, before validation', async () => {
        expectError(await api(BASE, { method: 'POST', body: {} }), 401, 'UNAUTHORIZED', 'Unauthorized');
      });

      it(`is 403 without ${cfg.base}:create`, async () => {
        const token = await tokenWith([`${cfg.base}:update`, `${cfg.base}:delete`]);
        expectError(
          await api(BASE, { method: 'POST', token, body: { translations: [tr('ar', uid())] } }),
          403,
          'FORBIDDEN',
          'You do not have permission to access this resource',
        );
      });
    });
  });

  describe(`GET /${cfg.base}`, () => {
    it('lists live categories newest first, CDN-cacheable, with the translation for Accept-Language', async () => {
      const slug = uid();
      const older = await create([tr('ar', `${slug}-a`), tr('en', `${slug}-a`)]);
      const newer = await create([tr('ar', `${slug}-b`), tr('en', `${slug}-b`)]);

      const res = await api(`${BASE}?limit=100`, { lang: 'en-US,en;q=0.9' });

      expectSuccess(res);
      expect(res.body.message).toBe('Categories fetched');
      expect(res.headers.get('cache-control')).toBe('public, max-age=300, s-maxage=1800');
      expect(res.headers.get('vary')).toMatch(/Accept-Language/);
      const ids = res.body.data.items.map((i: { id: string }) => i.id);
      expect(ids.indexOf(newer.id)).toBeLessThan(ids.indexOf(older.id));
      const item = res.body.data.items.find((i: { id: string }) => i.id === newer.id);
      expect(item.translation.lang).toBe('en');
      expect(res.body.data.pagination).toEqual({ page: 1, limit: 100, total: expect.any(Number), pages: expect.any(Number) });
      expect(res.body.data.pagination.pages).toBe(Math.ceil(res.body.data.pagination.total / 100));
    });

    it('paginates', async () => {
      await create([tr('ar', uid())]);
      await create([tr('ar', uid())]);
      const res = await api(`${BASE}?page=2&limit=1`);

      expectSuccess(res);
      expect(res.body.data.items).toHaveLength(1);
      expect(res.body.data.pagination).toMatchObject({ page: 2, limit: 1 });
    });

    it('does not list soft-deleted categories', async () => {
      const cat = await create([tr('ar', uid())]);
      await remove(cat.id);

      const res = await api(`${BASE}?limit=100`);
      expect(res.body.data.items.map((i: { id: string }) => i.id)).not.toContain(cat.id);
    });

    it.each([
      ['?page=0', ['page must not be less than 1']],
      ['?limit=101', ['limit must not be greater than 100']],
      ['?page=1.5', ['page must be an integer number']],
      ['?limit=0.5', ['limit must not be less than 1', 'limit must be an integer number']],
      ['?foo=1', ['property foo should not exist']],
    ])('rejects %s', async (query, errors) => {
      const res = await api(`${BASE}${query}`);
      expectError(res, 400, 'VALIDATION_FAILED', 'Validation failed');
      expect(errorsOf(res)).toEqual(errors);
      expect(res.headers.get('cache-control')).toBe('no-store');
    });
  });

  describe(`GET /${cfg.base}/:id`, () => {
    it('resolves the requested language, else ar, else the lowest code', async () => {
      const slug = uid();
      const cat = await create([tr('en', slug), tr('ar', slug)]);
      const noArabic = await create([tr('fa', uid()), tr('en', uid())]);
      const lang = async (id: string, l?: string) => (await api(`${BASE}/${id}`, { lang: l })).body.data.translation?.lang;

      expect(await lang(cat.id, 'en')).toBe('en');
      expect(await lang(cat.id, 'de')).toBe('ar');
      expect(await lang(cat.id)).toBe('ar');
      expect(await lang(noArabic.id, 'de')).toBe('en');
    });

    it('answers with the category, CDN-cacheable, and 304 for a matching If-None-Match', async () => {
      const cat = await create([tr('ar', uid())]);
      const res = await api(`${BASE}/${cat.id}`);

      expectSuccess(res);
      expect(res.body.message).toBe('Category fetched');
      expect(res.body.data).toEqual(cat);
      expect(res.headers.get('cache-control')).toBe('public, max-age=300, s-maxage=1800');
      const etag = res.headers.get('etag');
      expect(etag).toMatch(/^W\/"[\w-]+"$/);
      // fetch adds `Cache-Control: no-cache` to a conditional request unless one is set, and no-cache never gets a 304.
      expect((await api(`${BASE}/${cat.id}`, { headers: { 'if-none-match': etag!, 'cache-control': 'max-age=0' } })).status).toBe(304);
    });

    it('is 404 for a missing or soft-deleted category, never cached', async () => {
      const cat = await create([tr('ar', uid())]);
      await remove(cat.id);

      for (const id of [MISSING, cat.id]) {
        const res = await api(`${BASE}/${id}`);
        expectError(res, 404, 'NOT_FOUND', 'Category not found');
        expect(res.headers.get('cache-control')).toBe('no-store');
      }
    });

    it('is 400 for a malformed id', async () => {
      expectError(await api(`${BASE}/not-a-uuid`), 400, 'INVALID_IDENTIFIER', 'Invalid identifier format');
    });

    it('never serves a translation in a retired language, while the admin write response does', async () => {
      const code = await withDb(async (q) => {
        const used = new Set((await q('SELECT code FROM languages')).map((r) => r.code as string));
        const free = [];
        // Never `zz`: the FK test above relies on it not existing.
        for (const a of 'qxjvw') for (const b of 'abcdefghijklmnopqrstuvwxyz') if (!used.has(a + b)) free.push(a + b);
        return free[Math.floor(Math.random() * free.length)];
      });
      // languages is not ported: on the Worker target this falls through to Nest.
      const lang = await api('/api/v1/languages', {
        method: 'POST',
        token: await adminToken(),
        body: { code, name: `Retired ${code}`, native_name: `Retired ${code}`, is_active: false },
      });
      expectSuccess(lang, 201);

      const only = await create([tr(code, uid())]);
      expect(only.translation.lang).toBe(code);
      expect((await api(`${BASE}/${only.id}`, { lang: code })).body.data.translation).toBeNull();

      const mixed = await create([tr(code, uid()), tr('en', uid())]);
      expect((await api(`${BASE}/${mixed.id}`, { lang: code })).body.data.translation.lang).toBe('en');
      const list = await api(`${BASE}?limit=100`, { lang: code });
      expect(list.body.data.items.find((i: { id: string }) => i.id === only.id).translation).toBeNull();
    });
  });

  describe(`PATCH /${cfg.base}/:id`, () => {
    const patch = async (id: string, body: unknown) => api(`${BASE}/${id}`, { method: 'PATCH', token: await adminToken(), body });

    it('upserts translations and answers with the hydrated row', async () => {
      const slug = uid();
      const cat = await create([tr('ar', slug), tr('en', slug)]);

      const res = await patch(cat.id, { translations: [tr('en', `${slug}-x`, { title: 'Renamed' }), tr('fa', slug)] });

      expectSuccess(res);
      expect(res.body.message).toBe('Category updated');
      const byLang = Object.fromEntries(res.body.data[T].map((t: { lang: string }) => [t.lang, t]));
      expect(Object.keys(byLang).sort()).toEqual(['ar', 'en', 'fa']);
      expect(byLang.en).toMatchObject({ title: 'Renamed', slug: `${slug}-x`, description: null });
      expect(res.body.data.translation.lang).toBe('ar');
    });

    it('accepts an empty body or an empty list and changes nothing', async () => {
      const cat = await create([tr('ar', uid())]);
      for (const body of [{}, { translations: [] }, { translations: null }]) {
        const res = await patch(cat.id, body);
        expectSuccess(res);
        expect(res.body.data).toEqual(cat);
      }
    });

    it('refuses a slug another category uses, but not its own', async () => {
      const taken = uid();
      await create([tr('en', taken)]);
      const own = uid();
      const cat = await create([tr('en', own)]);

      expectSuccess(await patch(cat.id, { translations: [tr('en', own, { title: 'Same slug' })] }));
      expectError(await patch(cat.id, { translations: [tr('en', taken)] }), 409, 'SLUG_ALREADY_USED', `Slug "${taken}" (en) is already used by another category`);
    });

    it('is 404 for a missing or soft-deleted category and 400 for a malformed id', async () => {
      const cat = await create([tr('ar', uid())]);
      await remove(cat.id);

      expectError(await patch(MISSING, {}), 404, 'NOT_FOUND', 'Category not found');
      expectError(await patch(cat.id, {}), 404, 'NOT_FOUND', 'Category not found');
      expectError(await patch('not-a-uuid', {}), 400, 'INVALID_IDENTIFIER', 'Invalid identifier format');
    });

    it(`is 403 without ${cfg.base}:update`, async () => {
      const cat = await create([tr('ar', uid())]);
      const token = await tokenWith([`${cfg.base}:create`]);
      expectError(await api(`${BASE}/${cat.id}`, { method: 'PATCH', token, body: {} }), 403, 'FORBIDDEN');
    });
  });

  describe('DELETE, trash and restore', () => {
    const restore = async (id: string) => api(`${BASE}/${id}/restore`, { method: 'POST', token: await adminToken() });

    it('soft-deletes, frees the slug, lists the category in the trash and restores it', async () => {
      const slug = uid();
      const cat = await create([tr('ar', slug), tr('en', slug)]);

      const del = await api(`${BASE}/${cat.id}`, { method: 'DELETE', token: await adminToken() });
      expectSuccess(del);
      expect(del.body).toMatchObject({ message: 'Category deleted', data: null });
      expectError(await api(`${BASE}/${cat.id}`, { method: 'DELETE', token: await adminToken() }), 404, 'NOT_FOUND', 'Category not found');

      const trash = await api(`${BASE}/trash?limit=100`, { token: await adminToken() });
      expectSuccess(trash);
      expect(trash.body.message).toBe('Trash fetched');
      const item = trash.body.data.items.find((i: { id: string }) => i.id === cat.id);
      expect(item.deleted_at).toMatch(ISO_DATE);
      expect(item[T].map((t: { slug: string }) => t.slug)).toEqual([slug, slug]);
      expect(item.translation).toMatchObject({ lang: 'ar', slug });

      // The slug is free while the category is in the trash, so restoring has to wait for it.
      const squatter = await create([tr('ar', slug)]);
      expectError(await restore(cat.id), 409, 'CONFLICT', `Cannot restore: slug "${slug}" (ar) is now used by another category`);
      await remove(squatter.id);

      const res = await restore(cat.id);
      expectSuccess(res);
      expect(res.body).toMatchObject({ message: 'Category restored', data: null });
      const back = await api(`${BASE}/${cat.id}`);
      expect(back.body.data[T].map((t: { slug: string }) => t.slug)).toEqual([slug, slug]);
      expectError(await restore(cat.id), 404, 'NOT_FOUND', 'Deleted category not found');
    });

    it('refuses to delete a category that still has live children', async () => {
      const cat = await create([tr('ar', uid())]);
      await withDb((q) => cfg.insertChild(q, cat.id, uid()));

      expectError(await api(`${BASE}/${cat.id}`, { method: 'DELETE', token: await adminToken() }), 409, 'CONFLICT', cfg.childConflict);
    });

    it('is 404 / 400 for missing and malformed ids', async () => {
      const token = await adminToken();
      expectError(await api(`${BASE}/${MISSING}`, { method: 'DELETE', token }), 404, 'NOT_FOUND', 'Category not found');
      expectError(await restore(MISSING), 404, 'NOT_FOUND', 'Deleted category not found');
      expectError(await api(`${BASE}/not-a-uuid`, { method: 'DELETE', token }), 400, 'INVALID_IDENTIFIER');
      expectError(await restore('not-a-uuid'), 400, 'INVALID_IDENTIFIER');
    });

    it(`needs ${cfg.base}:delete for delete, trash and restore`, async () => {
      const cat = await create([tr('ar', uid())]);
      const token = await tokenWith([`${cfg.base}:create`, `${cfg.base}:update`]);

      expectError(await api(`${BASE}/trash`), 401, 'UNAUTHORIZED');
      expectError(await api(`${BASE}/trash`, { token }), 403, 'FORBIDDEN');
      expectError(await api(`${BASE}/${cat.id}`, { method: 'DELETE', token }), 403, 'FORBIDDEN');
      expectError(await api(`${BASE}/${cat.id}/restore`, { method: 'POST', token }), 403, 'FORBIDDEN');
    });
  });
}
