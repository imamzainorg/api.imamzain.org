import { describe, expect, it } from 'vitest';
import { adminToken, api, expectError, expectSuccess, ISO_DATE, tokenWith, withDb } from './support/http';

const BASE = '/api/v1/static-pages';
const MISSING = '00000000-0000-4000-8000-000000000000';

const uid = () => `sp-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
const ar = (title: string, extra: Record<string, unknown> = {}) => ({ lang: 'ar', title, body: `<p>${title}</p>`, is_default: true, ...extra });
const en = (title: string, extra: Record<string, unknown> = {}) => ({ lang: 'en', title, body: `<p>${title}</p>`, ...extra });
const errorsOf = (res: { body: { errors?: string[] } }) => res.body.errors;
const idsOf = (res: { body: { data: { items: { id: string }[] } } }) => res.body.data.items.map((i) => i.id);

const post = async (body: unknown) => api(BASE, { method: 'POST', token: await adminToken(), body });
const patch = async (id: string, body: unknown) => api(`${BASE}/${id}`, { method: 'PATCH', token: await adminToken(), body });
const publish = async (id: string, body: unknown) => api(`${BASE}/${id}/publish`, { method: 'PATCH', token: await adminToken(), body });
const del = async (id: string) => api(`${BASE}/${id}`, { method: 'DELETE', token: await adminToken() });
const restore = async (id: string) => api(`${BASE}/${id}/restore`, { method: 'POST', token: await adminToken() });
const admin = async (path: string, lang?: string) => api(`${BASE}${path}`, { token: await adminToken(), lang });

async function create(body: Record<string, unknown> = {}) {
  const slug = uid();
  const res = await post({ slug, translations: [ar(`${slug}-ar`), en(`${slug}-en`)], ...body });
  expectSuccess(res, 201);
  return res.body.data;
}

describe('POST /static-pages', () => {
  it('creates the page with sanitised bodies and answers 201 with the hydrated row', async () => {
    const slug = uid();
    const res = await post({
      slug,
      display_order: 3,
      translations: [
        en(`${slug}-en`, { body: '<p onclick="x()">hi</p><script>alert(1)</script><h2 id="top">T</h2><a href="#top" target="_blank">up</a>', meta_title: 'Meta', meta_description: 'Desc' }),
        ar(`${slug}-ar`),
      ],
    });

    expectSuccess(res, 201);
    expect(res.body.message).toBe('Static page created');
    const data = res.body.data;
    expect(Object.keys(data)).toEqual([
      'id',
      'display_order',
      'is_published',
      'slug',
      'created_at',
      'updated_at',
      'deleted_at',
      'static_page_translations',
      'translation',
    ]);
    expect(data).toMatchObject({ slug, display_order: 3, is_published: true, created_at: expect.stringMatching(ISO_DATE), deleted_at: null });
    const english = data.static_page_translations.find((t: { lang: string }) => t.lang === 'en');
    expect(english).toMatchObject({
      page_id: data.id,
      title: `${slug}-en`,
      body: '<p>hi</p><h2 id="user-content-top">T</h2><a href="#user-content-top" target="_blank" rel="noopener noreferrer">up</a>',
      meta_title: 'Meta',
      meta_description: 'Desc',
      og_image_id: null,
      is_default: false,
      og_image: null,
    });
    expect(data.translation).toMatchObject({ lang: 'ar', is_default: true });
  });

  it('defaults display_order to 0 and is_published to true, and can create a draft', async () => {
    expect(await create()).toMatchObject({ display_order: 0, is_published: true });
    expect(await create({ is_published: false })).toMatchObject({ is_published: false });
  });

  it('embeds the og image of a translation', async () => {
    const media = await withDb((q) => q(`SELECT id::text AS id FROM media LIMIT 1`));
    if (media.length === 0) return;
    const slug = uid();
    const res = await post({ slug, translations: [ar(slug, { og_image_id: media[0].id })] });
    expectSuccess(res, 201);
    expect(res.body.data.static_page_translations[0].og_image).toMatchObject({ id: media[0].id });
    expect(Object.keys(res.body.data.static_page_translations[0].og_image)).toEqual(['id', 'url', 'filename', 'alt_text', 'mime_type', 'width', 'height']);
  });

  describe('validation', () => {
    const slug = () => uid();
    const t = () => ar(uid());
    const cases: [string, () => unknown, string[]][] = [
      ['an upper-case slug', () => ({ slug: 'Bad Slug', translations: [t()] }), ['slug must match /^[a-z0-9]+(?:-[a-z0-9]+)*$/ regular expression']],
      ['a 201-char slug', () => ({ slug: 'a'.repeat(201), translations: [t()] }), ['slug must be shorter than or equal to 200 characters']],
      ['an empty list', () => ({ slug: slug(), translations: [] }), ['translations must contain at least 1 elements']],
      ['a 51-item list', () => ({ slug: slug(), translations: Array.from({ length: 51 }, t) }), ['translations must contain no more than 50 elements']],
      ['a three-letter lang', () => ({ slug: slug(), translations: [{ ...t(), lang: 'abc' }] }), ['translations.0.lang must be shorter than or equal to 2 characters']],
      ['an empty title', () => ({ slug: slug(), translations: [{ ...t(), title: '' }] }), ['translations.0.title must be longer than or equal to 1 characters']],
      ['a 301-char title', () => ({ slug: slug(), translations: [{ ...t(), title: 'x'.repeat(301) }] }), ['translations.0.title must be shorter than or equal to 300 characters']],
      ['an empty body', () => ({ slug: slug(), translations: [{ ...t(), body: '' }] }), ['translations.0.body must be longer than or equal to 1 characters']],
      ['a body over 200 KB', () => ({ slug: slug(), translations: [{ ...t(), body: 'x'.repeat(204_801) }] }), ['translations.0.body must be at most 204800 bytes (UTF-8)']],
      ['a 301-char meta_title', () => ({ slug: slug(), translations: [{ ...t(), meta_title: 'x'.repeat(301) }] }), ['translations.0.meta_title must be shorter than or equal to 300 characters']],
      ['a 501-char meta_description', () => ({ slug: slug(), translations: [{ ...t(), meta_description: 'x'.repeat(501) }] }), ['translations.0.meta_description must be shorter than or equal to 500 characters']],
      ['a malformed og_image_id', () => ({ slug: slug(), translations: [{ ...t(), og_image_id: 'nope' }] }), ['translations.0.og_image_id must be a UUID']],
      ['a non-boolean is_default', () => ({ slug: slug(), translations: [{ ...t(), is_default: 'yes' }] }), ['translations.0.is_default must be a boolean value']],
      ['an unknown translation key', () => ({ slug: slug(), translations: [{ ...t(), extra: 1 }] }), ['translations.0.property extra should not exist']],
      ['a negative display_order', () => ({ slug: slug(), translations: [t()], display_order: -1 }), ['display_order must not be less than 0']],
      ['a fractional display_order', () => ({ slug: slug(), translations: [t()], display_order: 1.5 }), ['display_order must be an integer number']],
      ['a non-boolean is_published', () => ({ slug: slug(), translations: [t()], is_published: 'yes' }), ['is_published must be a boolean value']],
      ['an unknown key', () => ({ slug: slug(), translations: [t()], extra: 1 }), ['property extra should not exist']],
    ];

    it.each(cases)('rejects %s with Nest’s messages', async (_name, body, errors) => {
      const res = await post(body());
      expectError(res, 400, 'VALIDATION_FAILED', 'Validation failed');
      expect(errorsOf(res)).toEqual(errors);
    });
  });

  it('needs exactly one default translation', async () => {
    const msg = 'Exactly one translation must have is_default = true';
    expectError(await post({ slug: uid(), translations: [{ lang: 'ar', title: 'A', body: '<p>a</p>' }] }), 400, 'BAD_REQUEST', msg);
    expectError(await post({ slug: uid(), translations: [ar('A'), en('B', { is_default: true })] }), 400, 'BAD_REQUEST', msg);
  });

  it('answers 404 for an og_image_id that matches no media, before anything is written', async () => {
    const slug = uid();
    expectError(
      await post({ slug, translations: [ar('A', { og_image_id: MISSING })] }),
      404,
      'NOT_FOUND',
      'One or more og_image_id values do not match any media record',
    );
    expectError(await api(`${BASE}/by-slug/${slug}`), 404, 'NOT_FOUND');
  });

  it('answers 409 for a taken slug and for a language sent twice', async () => {
    const page = await create();
    expectError(await post({ slug: page.slug, translations: [ar('A')] }), 409, 'CONFLICT', `Slug "${page.slug}" is already used by another static page`);
    expectError(
      await post({ slug: uid(), translations: [ar('A'), { lang: 'ar', title: 'B', body: '<p>b</p>' }] }),
      409,
      'CONFLICT',
      'The same language appears more than once in translations',
    );
  });

  it('refuses a language that does not exist', async () => {
    expectError(
      await post({ slug: uid(), translations: [ar('A', { lang: 'zz' })] }),
      400,
      'FK_CONSTRAINT_VIOLATION',
      'Foreign key constraint failed — referenced record does not exist',
    );
  });

  it('is 401 without a token and 403 without static-pages:create', async () => {
    expectError(await api(BASE, { method: 'POST', body: {} }), 401, 'UNAUTHORIZED', 'Unauthorized');
    const token = await tokenWith(['static-pages:read', 'static-pages:update', 'static-pages:delete']);
    expectError(await api(BASE, { method: 'POST', token, body: { slug: uid(), translations: [ar('A')] } }), 403, 'FORBIDDEN');
  });
});

describe('GET /static-pages (public list)', () => {
  it('lists published pages by display_order, slim and CDN-cacheable', async () => {
    const late = await create({ display_order: 900_000_002 });
    const early = await create({ display_order: 900_000_001 });
    const draft = await create({ display_order: 900_000_000, is_published: false });
    const gone = await create({ display_order: 900_000_003 });
    expectSuccess(await del(gone.id));

    const res = await api(`${BASE}?limit=100`, { lang: 'en' });

    expectSuccess(res);
    expect(res.body.message).toBe('Static pages fetched');
    expect(res.headers.get('cache-control')).toBe('public, max-age=300, s-maxage=1800');
    expect(res.headers.get('vary')).toMatch(/Accept-Language/);
    const ids = idsOf(res);
    expect(ids.indexOf(early.id)).toBeLessThan(ids.indexOf(late.id));
    expect(ids).not.toContain(draft.id);
    expect(ids).not.toContain(gone.id);
    const item = res.body.data.items.find((i: { id: string }) => i.id === early.id);
    expect(Object.keys(item)).toEqual(['id', 'display_order', 'is_published', 'slug', 'created_at', 'updated_at', 'deleted_at', 'translation']);
    expect(Object.keys(item.translation)).toEqual(['page_id', 'lang', 'title', 'is_default', 'meta_title', 'meta_description', 'og_image_id']);
    expect(item.translation.lang).toBe('en');
    expect(res.body.data.pagination).toEqual({ page: 1, limit: 100, total: expect.any(Number), pages: expect.any(Number) });
  });

  it('falls back to the default translation for a language the page does not have', async () => {
    const page = await create();
    const res = await api(`${BASE}?limit=100`, { lang: 'fr' });
    const item = res.body.data.items.find((i: { id: string }) => i.id === page.id);
    expect(item.translation.lang).toBe('ar');
  });

  it('paginates and rejects bad queries', async () => {
    const res = await api(`${BASE}?page=2&limit=1`);
    expectSuccess(res);
    expect(res.body.data.pagination).toMatchObject({ page: 2, limit: 1 });
    const bad = await api(`${BASE}?page=0&limit=500&is_published=true`);
    expectError(bad, 400, 'VALIDATION_FAILED', 'Validation failed');
    expect(errorsOf(bad)).toEqual(['property is_published should not exist', 'page must not be less than 1', 'limit must not be greater than 100']);
  });
});

describe('GET /static-pages/admin', () => {
  it('lists drafts too, with every translation and its body, and filters by is_published', async () => {
    const live = await create({ display_order: 900_000_010 });
    const draft = await create({ display_order: 900_000_011, is_published: false });

    const all = await admin('/admin?limit=100');
    expectSuccess(all);
    expect(idsOf(all)).toEqual(expect.arrayContaining([live.id, draft.id]));
    const item = all.body.data.items.find((i: { id: string }) => i.id === draft.id);
    expect(item.static_page_translations).toHaveLength(2);
    expect(item.static_page_translations[0].body).toEqual(expect.any(String));

    const drafts = await admin('/admin?limit=100&is_published=false');
    expect(idsOf(drafts)).toContain(draft.id);
    expect(idsOf(drafts)).not.toContain(live.id);
    const published = await admin('/admin?limit=100&is_published=true');
    expect(idsOf(published)).toContain(live.id);
    expect(idsOf(published)).not.toContain(draft.id);
  });

  it('rejects a non-boolean is_published and an unknown key', async () => {
    const res = await admin('/admin?is_published=yes&extra=1');
    expectError(res, 400, 'VALIDATION_FAILED', 'Validation failed');
    expect(errorsOf(res)).toEqual(['property extra should not exist', 'is_published must be a boolean value']);
  });

  it('is 401 without a token and 403 without static-pages:read', async () => {
    expectError(await api(`${BASE}/admin`), 401, 'UNAUTHORIZED');
    expectError(await api(`${BASE}/admin`, { token: await tokenWith(['static-pages:update']) }), 403, 'FORBIDDEN');
    expectError(await api(`${BASE}/admin/${MISSING}`, { token: await tokenWith(['static-pages:update']) }), 403, 'FORBIDDEN');
  });
});

describe('GET /static-pages/admin/:id, /:id and /by-slug/:slug', () => {
  it('serves a draft on the admin route only', async () => {
    const draft = await create({ is_published: false });

    const res = await admin(`/admin/${draft.id}`, 'en');
    expectSuccess(res);
    expect(res.body.message).toBe('Static page fetched');
    expect(res.body.data.translation.lang).toBe('en');
    expect(res.body.data.static_page_translations).toHaveLength(2);

    expectError(await api(`${BASE}/${draft.id}`), 404, 'NOT_FOUND', 'Static page not found');
    expectError(await api(`${BASE}/by-slug/${draft.slug}`), 404, 'NOT_FOUND', 'Static page not found');
  });

  it('serves a published page publicly by id and by slug, CDN-cacheable, with the requested translation', async () => {
    const page = await create();
    for (const path of [`/${page.id}`, `/by-slug/${page.slug}`]) {
      const res = await api(BASE + path, { lang: 'en' });
      expectSuccess(res);
      expect(res.headers.get('cache-control')).toBe('public, max-age=300, s-maxage=1800');
      expect(res.headers.get('vary')).toMatch(/Accept-Language/);
      expect(res.body.data).toMatchObject({ id: page.id, slug: page.slug, translation: { lang: 'en' } });
      expect(res.body.data.static_page_translations[0].body).toEqual(expect.any(String));
    }
  });

  it('answers 404 for an unknown id or slug, and 400 for a malformed id', async () => {
    expectError(await api(`${BASE}/${MISSING}`), 404, 'NOT_FOUND', 'Static page not found');
    expectError(await admin(`/admin/${MISSING}`), 404, 'NOT_FOUND', 'Static page not found');
    expectError(await api(`${BASE}/by-slug/${uid()}`), 404, 'NOT_FOUND', 'Static page not found');
    expectError(await api(`${BASE}/not-a-uuid`), 400, 'INVALID_IDENTIFIER', 'Invalid identifier format');
  });
});

describe('PATCH /static-pages/:id', () => {
  it('updates scalars and upserts translations, keeping the untouched ones', async () => {
    const page = await create({ is_published: false });

    const res = await patch(page.id, {
      display_order: 5,
      translations: [en('New title', { body: '<p>new</p><script>x</script>' })],
    });

    expectSuccess(res);
    expect(res.body.message).toBe('Static page updated');
    expect(res.body.data.display_order).toBe(5);
    const byLang = Object.fromEntries(res.body.data.static_page_translations.map((t: { lang: string }) => [t.lang, t]));
    expect(byLang.en).toMatchObject({ title: 'New title', body: '<p>new</p>', is_default: false });
    expect(byLang.ar).toMatchObject({ title: `${page.slug}-ar`, is_default: true });
    expect(Date.parse(res.body.data.updated_at)).toBeGreaterThan(Date.parse(page.updated_at));
  });

  it('inserts a missing language, and an upsert without is_default resets the flag', async () => {
    const slug = uid();
    const page = (await post({ slug, translations: [ar(slug)] })).body.data;

    const added = await patch(page.id, { translations: [ar(slug, { title: 'Retitled' }), en(`${slug}-en`)] });
    expectSuccess(added);
    expect(added.body.data.static_page_translations.map((t: { lang: string }) => t.lang).sort()).toEqual(['ar', 'en']);

    const reset = await patch(page.id, { translations: [{ lang: 'ar', title: 'No flag', body: '<p>x</p>' }] });
    expectError(reset, 400, 'BAD_REQUEST', 'Exactly one translation must have is_default: true');
  });

  it('keeps exactly one default across the whole set', async () => {
    const page = await create();
    expectError(await patch(page.id, { translations: [en('Two defaults', { is_default: true })] }), 400, 'BAD_REQUEST', 'Exactly one translation must have is_default: true');
    // Rolled back: the page is unchanged.
    const after = await admin(`/admin/${page.id}`);
    expect(after.body.data.static_page_translations.find((t: { lang: string }) => t.lang === 'en').title).toBe(`${page.slug}-en`);
  });

  it('locks the slug of a published page, and allows the rename once it is unpublished', async () => {
    const page = await create();
    const next = uid();
    const locked = await patch(page.id, { slug: next });
    expectError(locked, 409, 'SLUG_LOCKED_WHILE_PUBLISHED', /slug of a published static page cannot be changed/);
    expectSuccess(await patch(page.id, { slug: page.slug }));

    const renamed = await patch(page.id, { slug: next, is_published: false });
    expectSuccess(renamed);
    expect(renamed.body.data).toMatchObject({ slug: next, is_published: false });
  });

  it('answers 409 for a slug another page owns', async () => {
    const taken = await create();
    const page = await create({ is_published: false });
    expectError(await patch(page.id, { slug: taken.slug }), 409, 'CONFLICT', `Slug "${taken.slug}" is already used by another static page`);
  });

  it('answers 404 for an unknown page, a deleted page and an og_image_id without media', async () => {
    const page = await create();
    expectError(await patch(MISSING, { display_order: 1 }), 404, 'NOT_FOUND', 'Static page not found');
    expectError(
      await patch(page.id, { translations: [en('X', { og_image_id: MISSING })] }),
      404,
      'NOT_FOUND',
      'One or more og_image_id values do not match any media record',
    );
    expectSuccess(await del(page.id));
    expectError(await patch(page.id, { display_order: 1 }), 404, 'NOT_FOUND', 'Static page not found');
  });

  it('rejects bad bodies', async () => {
    const page = await create();
    const res = await patch(page.id, { slug: 'Bad Slug', display_order: -1, extra: 1 });
    expectError(res, 400, 'VALIDATION_FAILED', 'Validation failed');
    expect(errorsOf(res)).toEqual([
      'property extra should not exist',
      'slug must match /^[a-z0-9]+(?:-[a-z0-9]+)*$/ regular expression',
      'display_order must not be less than 0',
    ]);
  });

  it('is 401 without a token and 403 without static-pages:update', async () => {
    expectError(await api(`${BASE}/${MISSING}`, { method: 'PATCH', body: {} }), 401, 'UNAUTHORIZED');
    expectError(await api(`${BASE}/${MISSING}`, { method: 'PATCH', body: {}, token: await tokenWith(['static-pages:read']) }), 403, 'FORBIDDEN');
  });
});

describe('PATCH /static-pages/:id/publish', () => {
  it('publishes and unpublishes, and writes nothing when the state already matches', async () => {
    const page = await create();

    const off = await publish(page.id, { is_published: false });
    expectSuccess(off);
    expect(off.body).toMatchObject({ message: 'Static page unpublished', data: { is_published: false } });
    expectError(await api(`${BASE}/${page.id}`), 404, 'NOT_FOUND');

    const again = await publish(page.id, { is_published: false });
    expect(again.body.message).toBe('Static page already in requested state');
    expect(again.body.data.updated_at).toBe(off.body.data.updated_at);

    const on = await publish(page.id, { is_published: true });
    expect(on.body).toMatchObject({ message: 'Static page published', data: { is_published: true } });
    expectSuccess(await api(`${BASE}/${page.id}`));
  });

  it('answers 400, 404, 401 and 403 where they apply', async () => {
    const page = await create();
    const bad = await publish(page.id, { is_published: 'yes' });
    expectError(bad, 400, 'VALIDATION_FAILED', 'Validation failed');
    expect(errorsOf(bad)).toEqual(['is_published must be a boolean value']);
    expectError(await publish(MISSING, { is_published: true }), 404, 'NOT_FOUND', 'Static page not found');
    expectError(await api(`${BASE}/${page.id}/publish`, { method: 'PATCH', body: { is_published: true } }), 401, 'UNAUTHORIZED');
    const token = await tokenWith(['static-pages:read']);
    expectError(await api(`${BASE}/${page.id}/publish`, { method: 'PATCH', token, body: { is_published: true } }), 403, 'FORBIDDEN');
  });
});

describe('DELETE, GET /trash and POST /:id/restore', () => {
  it('soft-deletes a page, frees its slug, lists it in the trash with the slug restored, and restores it', async () => {
    const page = await create();

    const res = await del(page.id);
    expectSuccess(res);
    expect(res.body).toMatchObject({ message: 'Static page deleted', data: null });
    expectError(await api(`${BASE}/${page.id}`), 404, 'NOT_FOUND');
    expectError(await api(`${BASE}/by-slug/${page.slug}`), 404, 'NOT_FOUND');
    expectError(await del(page.id), 404, 'NOT_FOUND', 'Static page not found');

    const trash = await admin('/trash?limit=100');
    expectSuccess(trash);
    expect(trash.body.message).toBe('Trash fetched');
    const item = trash.body.data.items.find((i: { id: string }) => i.id === page.id);
    expect(item).toMatchObject({ slug: page.slug, deleted_at: expect.stringMatching(ISO_DATE) });
    expect(item.translation).toMatchObject({ lang: 'ar' });
    const stored = await withDb((q) => q(`SELECT slug FROM static_pages WHERE id = $1`, [page.id]));
    expect(stored[0].slug).toMatch(new RegExp(`^${page.slug}__del_\\d+$`));

    const back = await restore(page.id);
    expectSuccess(back);
    expect(back.body).toMatchObject({ message: 'Static page restored', data: null });
    expectSuccess(await api(`${BASE}/by-slug/${page.slug}`));
    expectError(await restore(page.id), 404, 'NOT_FOUND', 'Deleted static page not found');
  });

  it('refuses to restore onto a slug a live page has taken', async () => {
    const page = await create();
    expectSuccess(await del(page.id));
    await create({ slug: page.slug });

    expectError(await restore(page.id), 409, 'CONFLICT', `Cannot restore: slug "${page.slug}" is now used by another static page`);
  });

  it('answers 404, 401 and 403 where they apply', async () => {
    expectError(await del(MISSING), 404, 'NOT_FOUND', 'Static page not found');
    expectError(await restore(MISSING), 404, 'NOT_FOUND', 'Deleted static page not found');
    expectError(await api(`${BASE}/trash`), 401, 'UNAUTHORIZED');
    const token = await tokenWith(['static-pages:read', 'static-pages:update', 'static-pages:create']);
    expectError(await api(`${BASE}/trash`, { token }), 403, 'FORBIDDEN');
    expectError(await api(`${BASE}/${MISSING}`, { method: 'DELETE', token }), 403, 'FORBIDDEN');
    expectError(await api(`${BASE}/${MISSING}/restore`, { method: 'POST', token }), 403, 'FORBIDDEN');
    expectError(await api(`${BASE}/${MISSING}`, { method: 'DELETE' }), 401, 'UNAUTHORIZED');
  });
});
