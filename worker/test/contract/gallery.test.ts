import { describe, expect, it } from 'vitest';
import { adminToken, api, expectError, expectSuccess, ISO_DATE, tokenWith, withDb } from './support/http';

const BASE = '/api/v1/gallery';
const MISSING = '00000000-0000-4000-8000-000000000000';

const uid = () => `gl-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
const ar = (title: string, extra: Record<string, unknown> = {}) => ({ lang: 'ar', title, ...extra });
const en = (title: string, extra: Record<string, unknown> = {}) => ({ lang: 'en', title, ...extra });
const errorsOf = (res: { body: { errors?: string[] } }) => res.body.errors;
const idsOf = (res: { body: { data: { items: { media_id: string }[] } } }) => res.body.data.items.map((i) => i.media_id);

const post = async (body: unknown) => api(BASE, { method: 'POST', token: await adminToken(), body });
const patch = async (id: string, body: unknown) => api(`${BASE}/${id}`, { method: 'PATCH', token: await adminToken(), body });
const publish = async (id: string, body: unknown) => api(`${BASE}/${id}/publish`, { method: 'PATCH', token: await adminToken(), body });
const del = async (id: string) => api(`${BASE}/${id}`, { method: 'DELETE', token: await adminToken() });
const restore = async (id: string) => api(`${BASE}/${id}/restore`, { method: 'POST', token: await adminToken() });
const admin = async (path: string, lang?: string) => api(`${BASE}${path}`, { token: await adminToken(), lang });

async function newMedia(): Promise<string> {
  const name = uid();
  const [row] = await withDb((q) =>
    q("INSERT INTO media (filename, url, mime_type, file_size) VALUES ($1, $2, 'image/jpeg', 1) RETURNING id::text AS id", [name, `https://example.test/${name}.jpg`]),
  );
  return row.id as string;
}

async function newCategory(): Promise<string> {
  const slug = uid();
  const res = await api('/api/v1/gallery-categories', { method: 'POST', token: await adminToken(), body: { translations: [{ lang: 'ar', title: slug, slug }] } });
  expectSuccess(res, 201);
  return res.body.data.id;
}

async function create(body: Record<string, unknown> = {}) {
  const title = uid();
  const res = await post({ media_id: await newMedia(), translations: [ar(`${title}-ar`), en(`${title}-en`)], ...body });
  expectSuccess(res, 201);
  return res.body.data;
}

describe('POST /gallery', () => {
  it('adds the image, defaults to published and answers 201 with the hydrated admin row', async () => {
    const mediaId = await newMedia();
    const title = uid();
    const res = await post({
      media_id: mediaId,
      taken_at: '2023-11-05',
      author: 'Ahmad',
      tags: ['shrine', 'karbala'],
      locations: ['Karbala'],
      translations: [en(`${title}-en`, { description: 'D', meta_title: 'M', meta_description: 'MD' }), ar(`${title}-ar`)],
    });

    expectSuccess(res, 201);
    expect(res.body.message).toBe('Gallery image created');
    const data = res.body.data;
    expect(Object.keys(data)).toEqual([
      'media_id',
      'category_id',
      'taken_at',
      'author',
      'tags',
      'locations',
      'views',
      'is_published',
      'created_at',
      'updated_at',
      'added_by',
      'deleted_at',
      'gallery_image_translations',
      'media',
      'gallery_categories',
      'translation',
    ]);
    expect(data).toMatchObject({
      media_id: mediaId,
      category_id: null,
      author: 'Ahmad',
      tags: ['shrine', 'karbala'],
      locations: ['Karbala'],
      views: 0,
      is_published: true,
      created_at: expect.stringMatching(ISO_DATE),
      deleted_at: null,
      gallery_categories: null,
    });
    expect(data.taken_at).toMatch(/^2023-11-05T/);
    expect(data.media).toMatchObject({ id: mediaId, media_variants: [] });
    const english = data.gallery_image_translations.find((t: { lang: string }) => t.lang === 'en');
    expect(english).toMatchObject({ media_id: mediaId, title: `${title}-en`, description: 'D', meta_title: 'M', meta_description: 'MD', og_image_id: null, og_image: null });
    expect(data.translation).toMatchObject({ lang: 'ar' });
  });

  it('can create a draft, and binds a live category', async () => {
    const categoryId = await newCategory();
    const draft = await create({ is_published: false, category_id: categoryId });
    expect(draft).toMatchObject({ is_published: false, category_id: categoryId });
    expect(draft.gallery_categories.id).toBe(categoryId);
  });

  it('embeds the og image of a translation', async () => {
    const og = await newMedia();
    const res = await post({ media_id: await newMedia(), translations: [ar(uid(), { og_image_id: og })] });
    expectSuccess(res, 201);
    expect(res.body.data.gallery_image_translations[0].og_image).toMatchObject({ id: og });
    expect(Object.keys(res.body.data.gallery_image_translations[0].og_image)).toEqual(['id', 'url', 'filename', 'alt_text', 'mime_type', 'width', 'height']);
  });

  describe('validation', () => {
    const media = () => MISSING;
    const t = () => ar(uid());
    const cases: [string, () => unknown, string[]][] = [
      ['a missing media_id', () => ({ translations: [t()] }), ['media_id must be a UUID']],
      ['a malformed media_id', () => ({ media_id: 'nope', translations: [t()] }), ['media_id must be a UUID']],
      ['a malformed category_id', () => ({ media_id: media(), category_id: 'nope', translations: [t()] }), ['category_id must be a UUID']],
      ['a bad taken_at', () => ({ media_id: media(), taken_at: 'yesterday', translations: [t()] }), ['taken_at must be a valid ISO 8601 date string']],
      ['a 301-char author', () => ({ media_id: media(), author: 'x'.repeat(301), translations: [t()] }), ['author must be shorter than or equal to 300 characters']],
      ['a 51-item tags list', () => ({ media_id: media(), tags: Array.from({ length: 51 }, () => 'a'), translations: [t()] }), ['tags must contain no more than 50 elements']],
      ['a 201-char tag', () => ({ media_id: media(), tags: ['x'.repeat(201)], translations: [t()] }), ['each value in tags must be shorter than or equal to 200 characters']],
      ['a non-boolean is_published', () => ({ media_id: media(), is_published: 'yes', translations: [t()] }), ['is_published must be a boolean value']],
      ['an empty list', () => ({ media_id: media(), translations: [] }), ['translations must contain at least 1 elements']],
      ['a 51-item list', () => ({ media_id: media(), translations: Array.from({ length: 51 }, t) }), ['translations must contain no more than 50 elements']],
      ['a three-letter lang', () => ({ media_id: media(), translations: [{ ...t(), lang: 'abc' }] }), ['translations.0.lang must be shorter than or equal to 2 characters']],
      ['an empty title', () => ({ media_id: media(), translations: [{ ...t(), title: '' }] }), ['translations.0.title must be longer than or equal to 1 characters']],
      ['a 501-char title', () => ({ media_id: media(), translations: [{ ...t(), title: 'x'.repeat(501) }] }), ['translations.0.title must be shorter than or equal to 500 characters']],
      ['a 5001-char description', () => ({ media_id: media(), translations: [{ ...t(), description: 'x'.repeat(5001) }] }), ['translations.0.description must be shorter than or equal to 5000 characters']],
      ['a 301-char meta_title', () => ({ media_id: media(), translations: [{ ...t(), meta_title: 'x'.repeat(301) }] }), ['translations.0.meta_title must be shorter than or equal to 300 characters']],
      ['a 501-char meta_description', () => ({ media_id: media(), translations: [{ ...t(), meta_description: 'x'.repeat(501) }] }), ['translations.0.meta_description must be shorter than or equal to 500 characters']],
      ['a malformed og_image_id', () => ({ media_id: media(), translations: [{ ...t(), og_image_id: 'nope' }] }), ['translations.0.og_image_id must be a UUID']],
      ['an unknown translation key', () => ({ media_id: media(), translations: [{ ...t(), extra: 1 }] }), ['translations.0.property extra should not exist']],
      ['an unknown key', () => ({ media_id: media(), translations: [t()], extra: 1 }), ['property extra should not exist']],
    ];

    it.each(cases)('rejects %s with Nest’s messages', async (_name, body, errors) => {
      const res = await post(body());
      expectError(res, 400, 'VALIDATION_FAILED', 'Validation failed');
      expect(errorsOf(res)).toEqual(errors);
    });
  });

  it('answers 404 for a media, category or og image that does not exist, before anything is written', async () => {
    expectError(await post({ media_id: MISSING, translations: [ar('A')] }), 404, 'NOT_FOUND', 'Media not found');
    expectError(await post({ media_id: await newMedia(), category_id: MISSING, translations: [ar('A')] }), 404, 'NOT_FOUND', 'Category not found');
    const mediaId = await newMedia();
    expectError(
      await post({ media_id: mediaId, translations: [ar('A', { og_image_id: MISSING })] }),
      404,
      'NOT_FOUND',
      'One or more og_image_id values do not match any media record',
    );
    expectError(await api(`${BASE}/${mediaId}`), 404, 'NOT_FOUND');
  });

  it('refuses a soft-deleted category', async () => {
    const categoryId = await newCategory();
    expectSuccess(await api(`/api/v1/gallery-categories/${categoryId}`, { method: 'DELETE', token: await adminToken() }));
    expectError(await post({ media_id: await newMedia(), category_id: categoryId, translations: [ar('A')] }), 404, 'NOT_FOUND', 'Category not found');
  });

  it('answers 409 for a media already in the gallery, one in its trash, and a language sent twice', async () => {
    const image = await create();
    expectError(await post({ media_id: image.media_id, translations: [ar('A')] }), 409, 'GALLERY_IMAGE_EXISTS', /already in the gallery/);
    expectSuccess(await del(image.media_id));
    expectError(await post({ media_id: image.media_id, translations: [ar('A')] }), 409, 'GALLERY_IMAGE_IN_TRASH', /in the gallery trash/);
    expectError(
      await post({ media_id: await newMedia(), translations: [ar('A'), ar('B')] }),
      409,
      'DUPLICATE_TRANSLATION_LANG',
      'translations lists the same language more than once; send one entry per language',
    );
  });

  it('refuses a language that does not exist', async () => {
    expectError(
      await post({ media_id: await newMedia(), translations: [ar('A', { lang: 'zz' })] }),
      400,
      'FK_CONSTRAINT_VIOLATION',
      'Foreign key constraint failed — referenced record does not exist',
    );
  });

  it('is 401 without a token and 403 without gallery:create', async () => {
    expectError(await api(BASE, { method: 'POST', body: {} }), 401, 'UNAUTHORIZED', 'Unauthorized');
    const token = await tokenWith(['gallery:read', 'gallery:update', 'gallery:delete']);
    expectError(await api(BASE, { method: 'POST', token, body: { media_id: MISSING, translations: [ar('A')] } }), 403, 'FORBIDDEN');
  });
});

describe('GET /gallery (public list)', () => {
  it('lists published images with the slim shape, cacheable, newest first', async () => {
    const image = await create({ tags: ['t-list'] });
    const res = await api(`${BASE}?tags=t-list&limit=100`, { lang: 'en' });

    expectSuccess(res);
    expect(res.body.message).toBe('Gallery fetched');
    expect(res.headers.get('cache-control')).toBe('public, max-age=60, s-maxage=300');
    expect(res.headers.get('vary')).toMatch(/Accept-Language/);
    const item = res.body.data.items.find((i: { media_id: string }) => i.media_id === image.media_id);
    expect(item).toBeTruthy();
    expect(Object.keys(item)).toEqual([
      'media_id',
      'category_id',
      'taken_at',
      'author',
      'tags',
      'locations',
      'views',
      'is_published',
      'created_at',
      'updated_at',
      'deleted_at',
      'gallery_image_translations',
      'media',
      'gallery_categories',
      'translation',
    ]);
    expect(Object.keys(item.gallery_image_translations[0])).toEqual(['media_id', 'lang', 'title', 'meta_title', 'meta_description', 'og_image_id']);
    expect(item.translation.lang).toBe('en');
    expect(res.body.data.pagination).toMatchObject({ page: 1, limit: 100 });
  });

  it('hides drafts and trashed images', async () => {
    const draft = await create({ is_published: false, tags: ['t-hide'] });
    const gone = await create({ tags: ['t-hide'] });
    const live = await create({ tags: ['t-hide'] });
    expectSuccess(await del(gone.media_id));
    expect(idsOf(await api(`${BASE}?tags=t-hide`))).toEqual([live.media_id]);
    expect(idsOf(await admin('/admin?tags=t-hide'))).toEqual(expect.arrayContaining([live.media_id, draft.media_id]));
    expect(idsOf(await admin('/admin?tags=t-hide'))).not.toContain(gone.media_id);
  });

  it('filters by category, and requires ALL tags and ALL locations', async () => {
    const categoryId = await newCategory();
    const a = await create({ category_id: categoryId, tags: ['x1', 'x2'], locations: ['L1', 'L2'] });
    await create({ category_id: categoryId, tags: ['x1'], locations: ['L1'] });
    expect((await api(`${BASE}?category_id=${categoryId}`)).body.data.pagination.total).toBe(2);
    expect(idsOf(await api(`${BASE}?category_id=${categoryId}&tags=x1&tags=x2`))).toEqual([a.media_id]);
    expect(idsOf(await api(`${BASE}?category_id=${categoryId}&locations=L1&locations=L2`))).toEqual([a.media_id]);
    expect(idsOf(await api(`${BASE}?category_id=${categoryId}&tags=x1&locations=L2`))).toEqual([a.media_id]);
  });

  it('paginates', async () => {
    for (let i = 0; i < 3; i++) await create({ tags: ['t-page'] });
    const res = await api(`${BASE}?tags=t-page&limit=2&page=2`);
    expect(res.body.data.items).toHaveLength(1);
    expect(res.body.data.pagination).toEqual({ page: 2, limit: 2, total: 3, pages: 2 });
  });

  const bad: [string, string, string[]][] = [
    ['page=0', '?page=0', ['page must not be less than 1']],
    ['limit=101', '?limit=101', ['limit must not be greater than 100']],
    ['a malformed category_id', '?category_id=nope', ['category_id must be a UUID']],
    ['an unknown param', '?extra=1', ['property extra should not exist']],
  ];
  it.each(bad)('rejects %s', async (_name, query, errors) => {
    const res = await api(`${BASE}${query}`);
    expectError(res, 400, 'VALIDATION_FAILED', 'Validation failed');
    expect(errorsOf(res)).toEqual(errors);
  });

  it('is 401 / 403 on the admin list', async () => {
    expectError(await api(`${BASE}/admin`), 401, 'UNAUTHORIZED');
    expectError(await api(`${BASE}/admin`, { token: await tokenWith(['gallery:update']) }), 403, 'FORBIDDEN');
  });
});

describe('GET /gallery/:id and /gallery/admin/:id', () => {
  it('serves a published image in the slim public shape (no added_by, no storage columns)', async () => {
    const image = await create();
    const res = await api(`${BASE}/${image.media_id}`, { lang: 'en' });

    expectSuccess(res);
    expect(res.body.message).toBe('Gallery image fetched');
    expect(res.headers.get('cache-control')).toBe('public, max-age=60, s-maxage=300');
    expect(res.body.data).not.toHaveProperty('added_by');
    expect(Object.keys(res.body.data.media)).toEqual(['id', 'url', 'filename', 'alt_text', 'mime_type', 'width', 'height', 'media_variants']);
    expect(res.body.data.translation.lang).toBe('en');
  });

  it('answers 404 for a draft, a trashed image and an unknown one, but the admin route serves the draft', async () => {
    const draft = await create({ is_published: false });
    expectError(await api(`${BASE}/${draft.media_id}`), 404, 'NOT_FOUND', 'Gallery image not found');
    expectError(await api(`${BASE}/${MISSING}`), 404, 'NOT_FOUND', 'Gallery image not found');
    const res = await admin(`/admin/${draft.media_id}`);
    expectSuccess(res);
    expect(res.body.data).toMatchObject({ media_id: draft.media_id, is_published: false });
    expect(res.body.data).toHaveProperty('added_by');
    expectSuccess(await del(draft.media_id));
    expectError(await admin(`/admin/${draft.media_id}`), 404, 'NOT_FOUND');
  });

  it('answers 400 for a malformed id', async () => {
    expectError(await api(`${BASE}/not-a-uuid`), 400, 'INVALID_IDENTIFIER', 'Invalid identifier format');
  });

  it('is 401 / 403 on the admin detail', async () => {
    expectError(await api(`${BASE}/admin/${MISSING}`), 401, 'UNAUTHORIZED');
    expectError(await api(`${BASE}/admin/${MISSING}`, { token: await tokenWith(['gallery:update']) }), 403, 'FORBIDDEN');
  });
});

describe('POST /gallery/:id/view', () => {
  it('counts a view on a published image and answers 201', async () => {
    const image = await create();
    const res = await api(`${BASE}/${image.media_id}/view`, { method: 'POST' });
    expectSuccess(res, 201);
    expect(res.body).toMatchObject({ message: 'View tracked', data: null });
    await api(`${BASE}/${image.media_id}/view`, { method: 'POST' });
    expect((await api(`${BASE}/${image.media_id}`)).body.data.views).toBe(2);
  });

  it('answers 404 for a draft, a trashed or an unknown image', async () => {
    const draft = await create({ is_published: false });
    expectError(await api(`${BASE}/${draft.media_id}/view`, { method: 'POST' }), 404, 'NOT_FOUND', 'Gallery image not found');
    expectError(await api(`${BASE}/${MISSING}/view`, { method: 'POST' }), 404, 'NOT_FOUND', 'Gallery image not found');
  });

  it('is limited to 30 a minute per IP', async () => {
    const ip = `10.99.${(Math.random() * 256) | 0}.${(Math.random() * 256) | 0}`;
    let last = 0;
    for (let i = 0; i < 31; i++) last = (await api(`${BASE}/${MISSING}/view`, { method: 'POST', ip })).status;
    expect(last).toBe(429);
  });
});

describe('PATCH /gallery/:id', () => {
  it('updates scalars and upserts translations, answering with the hydrated row', async () => {
    const image = await create({ tags: ['old'] });
    const res = await patch(image.media_id, {
      author: 'New Author',
      tags: ['new'],
      locations: ['Medina'],
      taken_at: '2024-01-02',
      translations: [en('Renamed', { description: 'Desc' }), ar('Titre')],
    });
    expectSuccess(res);
    expect(res.body.message).toBe('Gallery image updated');
    expect(res.body.data).toMatchObject({ author: 'New Author', tags: ['new'], locations: ['Medina'] });
    expect(res.body.data.taken_at).toMatch(/^2024-01-02T/);
    const byLang = Object.fromEntries(res.body.data.gallery_image_translations.map((t: { lang: string; title: string }) => [t.lang, t.title]));
    expect(byLang).toMatchObject({ en: 'Renamed', ar: 'Titre' });
    expect(new Date(res.body.data.updated_at).getTime()).toBeGreaterThanOrEqual(new Date(image.updated_at).getTime());
  });

  it('moves the image between categories and clears it with null', async () => {
    const first = await newCategory();
    const second = await newCategory();
    const image = await create({ category_id: first });
    expect((await patch(image.media_id, { category_id: second })).body.data.category_id).toBe(second);
    const cleared = await patch(image.media_id, { category_id: null });
    expectSuccess(cleared);
    expect(cleared.body.data).toMatchObject({ category_id: null, gallery_categories: null });
  });

  it('answers 404 for a missing image, category or og image', async () => {
    const image = await create();
    expectError(await patch(MISSING, { author: 'x' }), 404, 'NOT_FOUND', 'Gallery image not found');
    expectError(await patch(image.media_id, { category_id: MISSING }), 404, 'NOT_FOUND', 'Category not found');
    expectError(
      await patch(image.media_id, { translations: [ar('A', { og_image_id: MISSING })] }),
      404,
      'NOT_FOUND',
      'One or more og_image_id values do not match any media record',
    );
    expectSuccess(await del(image.media_id));
    expectError(await patch(image.media_id, { author: 'x' }), 404, 'NOT_FOUND');
  });

  it('rejects an invalid body with Nest’s messages, and a media_id', async () => {
    const image = await create();
    const res = await patch(image.media_id, { taken_at: 'x', tags: ['y'.repeat(201)], media_id: MISSING });
    expectError(res, 400, 'VALIDATION_FAILED', 'Validation failed');
    expect(errorsOf(res)).toEqual(['property media_id should not exist', 'taken_at must be a valid ISO 8601 date string', 'each value in tags must be shorter than or equal to 200 characters']);
  });

  it('is 401 without a token and 403 without gallery:update', async () => {
    expectError(await api(`${BASE}/${MISSING}`, { method: 'PATCH', body: {} }), 401, 'UNAUTHORIZED');
    expectError(await api(`${BASE}/${MISSING}`, { method: 'PATCH', body: {}, token: await tokenWith(['gallery:read']) }), 403, 'FORBIDDEN');
  });
});

describe('PATCH /gallery/:id/publish', () => {
  it('publishes and unpublishes, and says so when nothing changes', async () => {
    const image = await create({ is_published: false });
    const on = await publish(image.media_id, { is_published: true });
    expectSuccess(on);
    expect(on.body).toMatchObject({ message: 'Gallery image published', data: { is_published: true } });
    expect(await api(`${BASE}/${image.media_id}`)).toMatchObject({ status: 200 });
    expect((await publish(image.media_id, { is_published: true })).body.message).toBe('Gallery image already in requested state');
    expect((await publish(image.media_id, { is_published: false })).body.message).toBe('Gallery image unpublished');
    expectError(await api(`${BASE}/${image.media_id}`), 404, 'NOT_FOUND');
  });

  it('answers 400, 404, 401 and 403 where they apply', async () => {
    const image = await create();
    const bad = await publish(image.media_id, { is_published: 'yes' });
    expectError(bad, 400, 'VALIDATION_FAILED');
    expect(errorsOf(bad)).toEqual(['is_published must be a boolean value']);
    expectError(await publish(MISSING, { is_published: true }), 404, 'NOT_FOUND', 'Gallery image not found');
    expectError(await api(`${BASE}/${image.media_id}/publish`, { method: 'PATCH', body: { is_published: true } }), 401, 'UNAUTHORIZED');
    const token = await tokenWith(['gallery:read']);
    expectError(await api(`${BASE}/${image.media_id}/publish`, { method: 'PATCH', token, body: { is_published: true } }), 403, 'FORBIDDEN');
  });
});

describe('trash: DELETE, GET /trash, POST /:id/restore', () => {
  it('soft-deletes, lists the image in the trash, and restores it', async () => {
    const image = await create({ tags: ['t-trash'] });
    const deleted = await del(image.media_id);
    expectSuccess(deleted);
    expect(deleted.body).toMatchObject({ message: 'Gallery image deleted', data: null });
    expectError(await api(`${BASE}/${image.media_id}`), 404, 'NOT_FOUND');
    expectError(await del(image.media_id), 404, 'NOT_FOUND', 'Gallery image not found');

    const trash = await admin('/trash?limit=100');
    expectSuccess(trash);
    expect(trash.body.message).toBe('Trash fetched');
    const item = trash.body.data.items.find((i: { media_id: string }) => i.media_id === image.media_id);
    expect(item.deleted_at).toMatch(ISO_DATE);
    expect(item.translation).toBeTruthy();

    const restored = await restore(image.media_id);
    expectSuccess(restored, 200);
    expect(restored.body).toMatchObject({ message: 'Gallery image restored', data: null });
    expectSuccess(await api(`${BASE}/${image.media_id}`));
    expectError(await restore(image.media_id), 404, 'NOT_FOUND', 'Deleted gallery image not found');
  });

  it('detaches a category that was trashed while the image sat in the trash', async () => {
    const categoryId = await newCategory();
    const image = await create({ category_id: categoryId });
    expectSuccess(await del(image.media_id));
    expectSuccess(await api(`/api/v1/gallery-categories/${categoryId}`, { method: 'DELETE', token: await adminToken() }));
    expectSuccess(await restore(image.media_id));
    expect((await admin(`/admin/${image.media_id}`)).body.data).toMatchObject({ category_id: null, gallery_categories: null });
  });

  it('is 401 / 403 on delete, trash and restore, and 400 on a bad page', async () => {
    const token = await tokenWith(['gallery:read', 'gallery:update']);
    for (const [method, path] of [['DELETE', `/${MISSING}`], ['GET', '/trash'], ['POST', `/${MISSING}/restore`]]) {
      expectError(await api(`${BASE}${path}`, { method }), 401, 'UNAUTHORIZED');
      expectError(await api(`${BASE}${path}`, { method, token }), 403, 'FORBIDDEN');
    }
    const res = await admin('/trash?page=0');
    expectError(res, 400, 'VALIDATION_FAILED');
    expect(errorsOf(res)).toEqual(['page must not be less than 1']);
    expectError(await del(MISSING), 404, 'NOT_FOUND', 'Gallery image not found');
  });
});
