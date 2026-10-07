import { describe, expect, it } from 'vitest';
import { adminToken, api, expectError, expectSuccess, ISO_DATE, randomIp, tokenWith, withDb } from './support/http';

const BASE = '/api/v1/posts';
const CATEGORIES = '/api/v1/post-categories';
const MISSING = '00000000-0000-4000-8000-000000000000';

/** A value no earlier run used: the suite runs twice on one DB in CI. */
const uid = () => `po-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
const ar = (title: string, extra: Record<string, unknown> = {}) => ({ lang: 'ar', title, body: `<p>${title}</p>`, is_default: true, ...extra });
const en = (title: string, extra: Record<string, unknown> = {}) => ({ lang: 'en', title, body: `<p>${title}</p>`, ...extra });
const errorsOf = (res: { body: { errors?: string[] } }) => res.body.errors;
const idsOf = (res: { body: { data: { items: { id: string }[] } } }) => res.body.data.items.map((i) => i.id);
const minutesFromNow = (m: number) => new Date(Date.now() + m * 60_000).toISOString();

const post = async (body: unknown) => api(BASE, { method: 'POST', token: await adminToken(), body });
const patch = async (id: string, body: unknown) => api(`${BASE}/${id}`, { method: 'PATCH', token: await adminToken(), body });
const publish = async (id: string, body: unknown) => api(`${BASE}/${id}/publish`, { method: 'PATCH', token: await adminToken(), body });
const del = async (id: string) => api(`${BASE}/${id}`, { method: 'DELETE', token: await adminToken() });
const restore = async (id: string) => api(`${BASE}/${id}/restore`, { method: 'POST', token: await adminToken() });
const admin = async (path: string, lang?: string) => api(`${BASE}${path}`, { token: await adminToken(), lang });
const detail = async (id: string) => (await admin(`/admin/${id}`)).body.data;
const bulk = async (path: string, body: unknown) => api(`${BASE}/bulk/${path}`, { method: 'POST', token: await adminToken(), body });

async function newMedia(): Promise<string> {
  const name = uid();
  const [row] = await withDb((q) =>
    q("INSERT INTO media (filename, url, mime_type, file_size) VALUES ($1, $2, 'image/jpeg', 1) RETURNING id::text AS id", [name, `https://example.test/${name}.jpg`]),
  );
  return row.id as string;
}

async function newCategory(): Promise<string> {
  const slug = uid();
  const res = await api(CATEGORIES, { method: 'POST', token: await adminToken(), body: { translations: [{ lang: 'ar', title: slug, slug }] } });
  expectSuccess(res, 201);
  return res.body.data.id;
}

let sharedCategory: Promise<string> | undefined;
const category = () => (sharedCategory ??= newCategory());

async function create(body: Record<string, unknown> = {}) {
  const title = uid();
  const res = await post({ category_id: await category(), slug: title, translations: [ar(`${title}-ar`), en(`${title}-en`)], ...body });
  expectSuccess(res, 201);
  return res.body.data;
}

describe('POST /posts', () => {
  it('creates a draft with translations and ordered attachments, and answers 201 with the hydrated admin row', async () => {
    const cat = await newCategory();
    const cover = await newMedia();
    const [a, b] = [await newMedia(), await newMedia()];
    const slug = uid();
    const res = await post({
      category_id: cat,
      cover_image_id: cover,
      slug,
      is_featured: true,
      attachment_ids: [b, a],
      translations: [
        ar(slug, { summary: 'نبذة', body: `<p>${'كلمة '.repeat(600)}</p>`, meta_title: 'MT', meta_description: 'MD' }),
        en(`${slug}-en`),
      ],
    });

    expectSuccess(res, 201);
    expect(res.body.message).toBe('Post created');
    const data = res.body.data;
    expect(data).toMatchObject({
      category_id: cat,
      cover_image_id: cover,
      slug,
      is_published: false,
      is_featured: true,
      published_at: null,
      views: 0,
      deleted_at: null,
      created_at: expect.stringMatching(ISO_DATE),
      created_by: expect.any(String),
      translation: { lang: 'ar', title: slug, summary: 'نبذة', is_default: true, reading_time_minutes: 3 },
    });
    expect(data.post_translations).toHaveLength(2);
    expect(data.post_categories.id).toBe(cat);
    expect(data.media).toMatchObject({ id: cover, media_variants: [] });
    expect(data.media).toHaveProperty('file_size');
    expect(data.post_attachments.map((x: { media_id: string; display_order: number }) => [x.media_id, x.display_order])).toEqual([
      [b, 0],
      [a, 1],
    ]);
  });

  it('sanitizes the body of every translation', async () => {
    const data = await create({ translations: [ar(uid(), { body: '<p onclick="x()">hi</p><script>alert(1)</script>' })] });
    expect(data.translation.body).toBe('<p>hi</p>');
  });

  it('refuses a translation set without exactly one default', async () => {
    for (const translations of [[en(uid())], [ar(uid()), en(uid(), { is_default: true })]]) {
      expectError(await post({ category_id: await category(), slug: uid(), translations }), 400, 'BAD_REQUEST', 'Exactly one translation must have is_default = true');
    }
  });

  it('404s an unknown or trashed category, an unknown cover and an unknown og_image_id', async () => {
    const base = { slug: uid(), translations: [ar(uid())] };
    expectError(await post({ ...base, category_id: MISSING }), 404, 'NOT_FOUND', 'Category not found');

    const trashed = await newCategory();
    expectSuccess(await api(`${CATEGORIES}/${trashed}`, { method: 'DELETE', token: await adminToken() }));
    expectError(await post({ ...base, category_id: trashed }), 404, 'NOT_FOUND', 'Category not found');

    const cat = await category();
    expectError(await post({ ...base, category_id: cat, cover_image_id: MISSING }), 404, 'NOT_FOUND', 'Cover image not found');
    expectError(
      await post({ ...base, category_id: cat, translations: [ar(uid(), { og_image_id: MISSING })] }),
      404,
      'NOT_FOUND',
      'One or more og_image_id values do not match any media record',
    );
  });

  it('409s a taken slug and a repeated language', async () => {
    const taken = await create();
    expectError(await post({ category_id: taken.category_id, slug: taken.slug, translations: [ar(uid())] }), 409, 'CONFLICT', `Slug "${taken.slug}" is already used by another post`);
    expectError(
      await post({ category_id: taken.category_id, slug: uid(), translations: [ar(uid()), ar(uid(), { is_default: false })] }),
      409,
      'CONFLICT',
      'The same language appears more than once in translations',
    );
  });

  describe('published_at', () => {
    it('stamps a post created published now, keeps a past date and clamps a future one', async () => {
      const before = Date.now();
      const nowPost = await create({ is_published: true });
      expect(Date.parse(nowPost.published_at)).toBeGreaterThanOrEqual(before - 1000);

      const past = '2020-01-02T03:04:05.000Z';
      expect((await create({ is_published: true, published_at: past })).published_at).toBe(past);

      // A live post dated in the future would sit above every real post in every list.
      const clamped = await create({ is_published: true, published_at: minutesFromNow(60) });
      expect(Date.parse(clamped.published_at)).toBeLessThanOrEqual(Date.now());
    });

    it('keeps a future date on a draft as a schedule and drops a past one, which the cron would publish at once', async () => {
      const future = minutesFromNow(120);
      expect((await create({ published_at: future })).published_at).toBe(future);
      expect((await create({ published_at: '2020-01-02T03:04:05Z' })).published_at).toBeNull();
    });
  });

  describe('validation', () => {
    const t = () => ar(uid());
    const ok = () => ({ category_id: MISSING, slug: uid(), translations: [t()] });
    const cases: [string, () => unknown, string[]][] = [
      ['a missing category_id', () => ({ slug: uid(), translations: [t()] }), ['category_id must be a UUID']],
      ['an upper-case slug', () => ({ ...ok(), slug: 'Bad Slug' }), ['slug must match /^[a-z0-9]+(?:-[a-z0-9]+)*$/ regular expression']],
      ['a published_at without an offset', () => ({ ...ok(), published_at: '2026-06-01T09:00:00' }), ['published_at must be an ISO-8601 timestamp with an explicit UTC offset, e.g. 2026-06-01T09:00:00Z or 2026-06-01T12:00:00+03:00']],
      ['an impossible published_at day', () => ({ ...ok(), published_at: '2026-02-31T09:00:00Z' }), ['published_at must be an ISO-8601 timestamp with an explicit UTC offset, e.g. 2026-06-01T09:00:00Z or 2026-06-01T12:00:00+03:00']],
      ['a non-boolean is_featured', () => ({ ...ok(), is_featured: 'yes' }), ['is_featured must be a boolean value']],
      ['an empty list', () => ({ ...ok(), translations: [] }), ['translations must contain at least 1 elements']],
      ['an empty title', () => ({ ...ok(), translations: [{ ...t(), title: '' }] }), ['translations.0.title must be longer than or equal to 1 characters']],
      ['an empty body', () => ({ ...ok(), translations: [{ ...t(), body: '' }] }), ['translations.0.body must be longer than or equal to 1 characters']],
      ['a 121-char meta_title', () => ({ ...ok(), translations: [{ ...t(), meta_title: 'x'.repeat(121) }] }), ['translations.0.meta_title must be shorter than or equal to 120 characters']],
      ['a malformed og_image_id', () => ({ ...ok(), translations: [{ ...t(), og_image_id: 'nope' }] }), ['translations.0.og_image_id must be a UUID']],
      ['a malformed attachment id', () => ({ ...ok(), attachment_ids: ['nope'] }), ['each value in attachment_ids must be a UUID']],
      ['a repeated attachment id in another letter case', () => ({ ...ok(), attachment_ids: [MISSING, MISSING.toUpperCase()] }), ["All attachment_ids's elements must be unique"]],
      ['an unknown translation key', () => ({ ...ok(), translations: [{ ...t(), extra: 1 }] }), ['translations.0.property extra should not exist']],
      ['an unknown key', () => ({ ...ok(), extra: 1 }), ['property extra should not exist']],
    ];

    it.each(cases)('rejects %s with Nest’s messages', async (_name, body, errors) => {
      const res = await post(body());
      expectError(res, 400, 'VALIDATION_FAILED', 'Validation failed');
      expect(errorsOf(res)).toEqual(errors);
    });
  });

  it('401s without a token and 403s without posts:create', async () => {
    const body = { category_id: MISSING, slug: uid(), translations: [ar(uid())] };
    expectError(await api(BASE, { method: 'POST', body }), 401, 'UNAUTHORIZED');
    expectError(await api(BASE, { method: 'POST', token: await tokenWith(['posts:read']), body }), 403, 'FORBIDDEN');
  });
});

describe('GET /posts', () => {
  it('lists published posts only, newest first, with bodiless translations, and is CDN-cacheable', async () => {
    const cat = await newCategory();
    const attachment = await newMedia();
    const older = await create({ category_id: cat, is_published: true, published_at: '2020-01-01T00:00:00Z' });
    const live = await create({ category_id: cat, is_published: true, attachment_ids: [attachment] });
    const draft = await create({ category_id: cat });
    const gone = await create({ category_id: cat, is_published: true });
    expectSuccess(await del(gone.id));

    const res = await api(`${BASE}?category_id=${cat}&limit=100`);
    expectSuccess(res);
    expect(res.body.message).toBe('Posts fetched');
    expect(res.headers.get('cache-control')).toBe('public, max-age=60, s-maxage=300');
    expect(res.headers.get('vary')).toContain('Accept-Language');
    expect(idsOf(res)).toEqual([live.id, older.id]);
    expect(idsOf(res)).not.toContain(draft.id);
    const row = res.body.data.items[0];
    expect(row).not.toHaveProperty('created_by');
    expect(row.post_translations[0]).not.toHaveProperty('body');
    expect(row.post_translations[0].reading_time_minutes).toBe(0);
    expect(row.translation).not.toHaveProperty('body');
    expect(row.post_categories).toMatchObject({ id: cat });
    expect(row.media).toBeNull();
    expect(row.post_attachments).toEqual([{ post_id: live.id, media_id: attachment, display_order: 0, media: expect.objectContaining({ id: attachment, url: expect.any(String) }) }]);
    expect(res.body.data.pagination).toMatchObject({ page: 1, limit: 100, total: 2, pages: 1 });
  });

  it('ignores the admin status filter on the public route', async () => {
    const cat = await newCategory();
    const live = await create({ category_id: cat, is_published: true });
    await create({ category_id: cat });
    expect(idsOf(await api(`${BASE}?category_id=${cat}&status=draft`))).toEqual([live.id]);
  });

  it('filters by featured, sorts by views, and resolves the translation by Accept-Language', async () => {
    const cat = await newCategory();
    const title = uid();
    const quiet = await create({ category_id: cat, is_published: true, is_featured: true, translations: [ar(`${title}-ar`), en(`${title}-en`)] });
    const popular = await create({ category_id: cat, is_published: true });
    expectSuccess(await api(`${BASE}/${popular.id}/view`, { method: 'POST' }), 201);

    expect(idsOf(await api(`${BASE}?category_id=${cat}&featured=true`))).toEqual([quiet.id]);
    expect(idsOf(await api(`${BASE}?category_id=${cat}&featured=false`))).toEqual([popular.id]);
    expect(idsOf(await api(`${BASE}?category_id=${cat}&sort=views`))).toEqual([popular.id, quiet.id]);

    const res = await api(`${BASE}?category_id=${cat}&featured=true`, { lang: 'en' });
    expect(res.body.data.items[0].translation).toMatchObject({ lang: 'en', title: `${title}-en` });
  });

  it('searches titles and bodies case-insensitively, in the requested or the default language only', async () => {
    const needle = uid();
    const byTitle = await create({ is_published: true, translations: [ar(`Title ${needle.toUpperCase()}`)] });
    const byBody = await create({ is_published: true, translations: [ar(uid(), { body: `<p>deep ${needle}</p>` })] });
    const otherLang = await create({ is_published: true, translations: [ar(uid()), en(uid(), { body: `<p>${needle}</p>` })] });
    const draft = await create({ translations: [ar(`Draft ${needle}`)] });

    const ids = idsOf(await api(`${BASE}?search=${needle}&limit=100`));
    expect(ids.sort()).toEqual([byTitle.id, byBody.id].sort());
    expect(ids).not.toContain(draft.id);
    expect(idsOf(await api(`${BASE}?search=${needle}&limit=100`, { lang: 'en' }))).toContain(otherLang.id);
  });

  it('paginates with a stable order', async () => {
    await create({ is_published: true });
    await create({ is_published: true });
    const page1 = await api(`${BASE}?page=1&limit=1`);
    const page2 = await api(`${BASE}?page=2&limit=1`);
    expect(idsOf(page1)).toHaveLength(1);
    expect(idsOf(page1)[0]).not.toBe(idsOf(page2)[0]);
  });

  it('rejects bad query parameters', async () => {
    expect(errorsOf(await api(`${BASE}?category_id=nope`))).toEqual(['category_id must be a UUID']);
    expect(errorsOf(await api(`${BASE}?search=a`))).toEqual(['search must be longer than or equal to 2 characters']);
    expect(errorsOf(await api(`${BASE}?featured=yes`))).toEqual(['featured must be a boolean value']);
    expect(errorsOf(await api(`${BASE}?sort=oldest`))).toEqual(['sort must be one of the following values: newest, views']);
    expect(errorsOf(await api(`${BASE}?status=live`))).toEqual(['status must be one of the following values: draft, scheduled, published, all']);
    expect(errorsOf(await api(`${BASE}?limit=101`))).toEqual(['limit must not be greater than 100']);
    expect(errorsOf(await api(`${BASE}?extra=1`))).toEqual(['property extra should not exist']);
  });
});

describe('GET /posts/admin', () => {
  it('splits drafts, scheduled and published posts by status, keeps created_by, and needs posts:read', async () => {
    const cat = await newCategory();
    const live = await create({ category_id: cat, is_published: true });
    const scheduled = await create({ category_id: cat, published_at: minutesFromNow(90) });
    const draft = await create({ category_id: cat });

    const tab = async (status: string) => idsOf(await admin(`/admin?category_id=${cat}&status=${status}&limit=100`));
    expect(await tab('published')).toEqual([live.id]);
    expect(await tab('scheduled')).toEqual([scheduled.id]);
    expect(await tab('draft')).toEqual([draft.id]);
    expect((await tab('all')).sort()).toEqual([live.id, scheduled.id, draft.id].sort());

    const res = await admin(`/admin?category_id=${cat}`);
    expect(res.body.data.items[0]).toHaveProperty('views');
    expectError(await api(`${BASE}/admin`), 401, 'UNAUTHORIZED');
    expectError(await api(`${BASE}/admin`, { token: await tokenWith(['posts:create']) }), 403, 'FORBIDDEN');
  });

  it('GET /admin/:id returns a draft with every column and 404s a trashed or missing post', async () => {
    const draft = await create();
    const row = await detail(draft.id);
    expect(row).toMatchObject({ id: draft.id, is_published: false, created_by: expect.any(String) });

    const gone = await create();
    expectSuccess(await del(gone.id));
    expectError(await admin(`/admin/${gone.id}`), 404, 'NOT_FOUND', 'Post not found');
    expectError(await admin(`/admin/${MISSING}`), 404, 'NOT_FOUND', 'Post not found');
    expectError(await api(`${BASE}/admin/${MISSING}`), 401, 'UNAUTHORIZED');
  });
});

describe('GET /posts/:id and /posts/by-slug/:slug', () => {
  it('serves a published post without staff columns, with reading time, and caches it', async () => {
    const cover = await newMedia();
    const attachment = await newMedia();
    const post = await create({ is_published: true, cover_image_id: cover, attachment_ids: [attachment], translations: [ar(uid(), { body: `<p>${'x'.repeat(2400)}</p>` })] });

    for (const path of [`/${post.id}`, `/by-slug/${post.slug}`]) {
      const res = await api(`${BASE}${path}`);
      expectSuccess(res);
      expect(res.body.message).toBe('Post fetched');
      expect(res.headers.get('cache-control')).toBe('public, max-age=60, s-maxage=300');
      expect(res.headers.get('vary')).toContain('Accept-Language');
      const data = res.body.data;
      expect(data).toMatchObject({ id: post.id, slug: post.slug, translation: { reading_time_minutes: 2 } });
      expect(data).not.toHaveProperty('created_by');
      expect(data.media).toMatchObject({ id: cover, media_variants: [] });
      expect(data.media).not.toHaveProperty('file_size');
      expect(data.post_attachments[0].media).not.toHaveProperty('uploaded_by');
    }
  });

  it('resolves the translation by Accept-Language and falls back to the default', async () => {
    const post = await create({ is_published: true, translations: [ar(uid()), en(uid())] });
    expect((await api(`${BASE}/${post.id}`, { lang: 'en' })).body.data.translation.lang).toBe('en');
    expect((await api(`${BASE}/${post.id}`, { lang: 'fr' })).body.data.translation.lang).toBe('ar');
  });

  it('404s a draft, a trashed post and a missing id or slug; 400s a malformed id', async () => {
    const draft = await create();
    const gone = await create({ is_published: true });
    expectSuccess(await del(gone.id));
    for (const path of [`/${draft.id}`, `/${gone.id}`, `/${MISSING}`, `/by-slug/${draft.slug}`, `/by-slug/${gone.slug}`, `/by-slug/${uid()}`]) {
      expectError(await api(`${BASE}${path}`), 404, 'NOT_FOUND', 'Post not found');
    }
    expectError(await api(`${BASE}/nope`), 400, 'INVALID_IDENTIFIER', 'Invalid identifier format');
  });
});

describe('POST /posts/:id/view', () => {
  it('counts a view on a published post, once per client IP, and answers 201', async () => {
    const post = await create({ is_published: true });
    const ip = randomIp();
    const res = await api(`${BASE}/${post.id}/view`, { method: 'POST', ip });
    expectSuccess(res, 201);
    expect(res.body).toMatchObject({ message: 'View tracked', data: null });

    // A repeat from the same IP answers the same but adds nothing; another visitor counts.
    expectSuccess(await api(`${BASE}/${post.id}/view`, { method: 'POST', ip }), 201);
    expect((await detail(post.id)).views).toBe(1);
    expectSuccess(await api(`${BASE}/${post.id}/view`, { method: 'POST', ip: randomIp() }), 201);
    expect((await detail(post.id)).views).toBe(2);
  });

  it('404s a draft, a trashed post and a missing id, also on a repeat from the same IP', async () => {
    const draft = await create();
    expectError(await api(`${BASE}/${draft.id}/view`, { method: 'POST' }), 404, 'NOT_FOUND', 'Post not found');
    expectError(await api(`${BASE}/${MISSING}/view`, { method: 'POST' }), 404, 'NOT_FOUND', 'Post not found');
    expect((await detail(draft.id)).views).toBe(0);

    const post = await create({ is_published: true });
    const ip = randomIp();
    expectSuccess(await api(`${BASE}/${post.id}/view`, { method: 'POST', ip }), 201);
    expectSuccess(await del(post.id));
    expectError(await api(`${BASE}/${post.id}/view`, { method: 'POST', ip }), 404, 'NOT_FOUND', 'Post not found');
  });

  it('is limited to 30 a minute per IP', async () => {
    const ip = randomIp();
    let last = 0;
    for (let i = 0; i < 31; i++) last = (await api(`${BASE}/${MISSING}/view`, { method: 'POST', ip })).status;
    expect(last).toBe(429);
  });
});

describe('PATCH /posts/:id', () => {
  it('updates fields, upserts translations by language and keeps the rest', async () => {
    const post = await create({ translations: [ar('A'), en('B')] });
    const cat = await newCategory();
    const cover = await newMedia();
    const slug = uid();

    const res = await patch(post.id, { category_id: cat, cover_image_id: cover, slug, is_featured: true, translations: [en('B2', { summary: 'S' })] });
    expectSuccess(res);
    expect(res.body.message).toBe('Post updated');
    expect(res.body.data).toMatchObject({ category_id: cat, cover_image_id: cover, slug, is_featured: true, updated_at: expect.stringMatching(ISO_DATE) });
    const byLang = Object.fromEntries(res.body.data.post_translations.map((x: { lang: string }) => [x.lang, x]));
    expect(byLang.ar).toMatchObject({ title: 'A', is_default: true });
    expect(byLang.en).toMatchObject({ title: 'B2', summary: 'S', is_default: false });

    expect((await patch(post.id, { cover_image_id: null })).body.data).toMatchObject({ cover_image_id: null, media: null });
  });

  it('replaces the attachments in the order given, and clears them with an empty list', async () => {
    const [a, b, c] = [await newMedia(), await newMedia(), await newMedia()];
    const post = await create({ attachment_ids: [a, b] });
    const order = (data: { post_attachments: { media_id: string }[] }) => data.post_attachments.map((x) => x.media_id);

    expect(order((await patch(post.id, { attachment_ids: [c, a] })).body.data)).toEqual([c, a]);
    expect(order((await patch(post.id, { is_featured: true })).body.data)).toEqual([c, a]);
    expect(order((await patch(post.id, { attachment_ids: [] })).body.data)).toEqual([]);
  });

  it('refuses a translation set that ends without exactly one default, and rolls everything back', async () => {
    const post = await create({ translations: [ar('A'), en('B')] });
    expectError(await patch(post.id, { is_featured: true, translations: [en('B2', { is_default: true })] }), 400, 'BAD_REQUEST', 'Exactly one translation must have is_default: true');
    expect(await detail(post.id)).toMatchObject({ is_featured: false });
    expect((await detail(post.id)).post_translations.find((x: { lang: string }) => x.lang === 'en').title).toBe('B');
  });

  it('404s an unknown category, cover or og_image_id, a missing post and a trashed post', async () => {
    const post = await create();
    expectError(await patch(post.id, { category_id: MISSING }), 404, 'NOT_FOUND', 'Category not found');
    expectError(await patch(post.id, { cover_image_id: MISSING }), 404, 'NOT_FOUND', 'Cover image not found');
    expectError(await patch(post.id, { translations: [ar(uid(), { og_image_id: MISSING })] }), 404, 'NOT_FOUND', 'One or more og_image_id values do not match any media record');
    expectError(await patch(MISSING, { is_featured: true }), 404, 'NOT_FOUND', 'Post not found');
    expectSuccess(await del(post.id));
    expectError(await patch(post.id, { is_featured: true }), 404, 'NOT_FOUND', 'Post not found');
  });

  it('409s a slug another post holds', async () => {
    const [one, two] = [await create(), await create()];
    expectError(await patch(two.id, { slug: one.slug }), 409, 'CONFLICT', `Slug "${one.slug}" is already used by another post`);
  });

  describe('slug lock', () => {
    it('refuses to rename the slug of a post that is and stays published', async () => {
      const post = await create({ is_published: true });
      const res = await patch(post.id, { slug: uid() });
      expectError(res, 409, 'SLUG_LOCKED_WHILE_PUBLISHED');
      expect(res.body.error).toMatch(/^The slug of a published post cannot be changed/);
      expectSuccess(await patch(post.id, { slug: post.slug, is_featured: true }));
    });

    it('allows a rename on a draft and in the request that unpublishes', async () => {
      const draft = await create();
      expectSuccess(await patch(draft.id, { slug: uid() }));

      const live = await create({ is_published: true });
      const next = uid();
      expect((await patch(live.id, { slug: next, is_published: false })).body.data).toMatchObject({ slug: next, is_published: false });
    });
  });

  describe('published_at', () => {
    it('does not republish a post unpublished through the CMS form, which re-sends the stored date', async () => {
      const post = await create({ is_published: true, published_at: '2020-01-02T03:04:05.000Z' });
      const res = await patch(post.id, { is_published: false, published_at: post.published_at });
      expectSuccess(res);
      expect(res.body.data).toMatchObject({ is_published: false, published_at: null });
    });

    it('schedules a draft, cancels the schedule with null and refuses to leave a live post future-dated', async () => {
      const post = await create();
      const future = minutesFromNow(180);
      expect((await patch(post.id, { published_at: future })).body.data.published_at).toBe(future);
      expect((await patch(post.id, { published_at: null })).body.data.published_at).toBeNull();

      const published = (await patch(post.id, { is_published: true, published_at: minutesFromNow(180) })).body.data;
      expect(Date.parse(published.published_at)).toBeLessThanOrEqual(Date.now());
    });
  });

  it('rejects bad bodies and needs posts:update', async () => {
    const post = await create();
    expect(errorsOf(await patch(post.id, { slug: 'Bad Slug' }))).toEqual(['slug must match /^[a-z0-9]+(?:-[a-z0-9]+)*$/ regular expression']);
    expect(errorsOf(await patch(post.id, { attachment_ids: [MISSING, MISSING] }))).toEqual(["All attachment_ids's elements must be unique"]);
    expect(errorsOf(await patch(post.id, { translations: [{ lang: 'e', title: 'T', body: 'B' }] }))).toEqual(['translations.0.lang must be longer than or equal to 2 characters']);
    expectError(await patch('nope', { is_featured: true }), 400, 'INVALID_IDENTIFIER', 'Invalid identifier format');
    expectError(await api(`${BASE}/${post.id}`, { method: 'PATCH', body: {} }), 401, 'UNAUTHORIZED');
    expectError(await api(`${BASE}/${post.id}`, { method: 'PATCH', token: await tokenWith(['posts:read']), body: {} }), 403, 'FORBIDDEN');
  });
});

describe('PATCH /posts/:id/publish', () => {
  it('publishes now over a scheduled date, unpublishes by clearing the date, and answers "already" for a no-op', async () => {
    const post = await create({ published_at: minutesFromNow(240) });

    const on = await publish(post.id, { is_published: true });
    expectSuccess(on);
    expect(on.body.message).toBe('Post published');
    expect(on.body.data.is_published).toBe(true);
    expect(Date.parse(on.body.data.published_at)).toBeLessThanOrEqual(Date.now());

    const same = await publish(post.id, { is_published: true });
    expectSuccess(same);
    expect(same.body.message).toBe('Post already in requested state');
    expect(same.body.data.published_at).toBe(on.body.data.published_at);
    expect(same.body.data.updated_at).toBe(on.body.data.updated_at);

    const off = await publish(post.id, { is_published: false });
    expect(off.body.message).toBe('Post unpublished');
    expect(off.body.data).toMatchObject({ is_published: false, published_at: null });
  });

  it('keeps a past date when publishing', async () => {
    const post = await create({ is_published: true, published_at: '2020-01-02T03:04:05.000Z' });
    await publish(post.id, { is_published: false });
    // Unpublishing cleared it, so the next publish stamps a fresh date.
    const again = await publish(post.id, { is_published: true });
    expect(Date.parse(again.body.data.published_at)).toBeGreaterThan(Date.parse('2021-01-01'));
  });

  it('404s a missing or trashed post; validates the body; needs posts:update', async () => {
    const post = await create();
    expect(errorsOf(await publish(post.id, { is_published: 'yes' }))).toEqual(['is_published must be a boolean value']);
    expectError(await api(`${BASE}/${post.id}/publish`, { method: 'PATCH', token: await tokenWith(['posts:read']), body: { is_published: true } }), 403, 'FORBIDDEN');
    expectSuccess(await del(post.id));
    expectError(await publish(post.id, { is_published: true }), 404, 'NOT_FOUND', 'Post not found');
  });
});

describe('POST /posts/bulk/publish and /posts/bulk/delete', () => {
  it('publishes the posts that differ and skips missing, trashed and unchanged ones', async () => {
    const [draft, scheduled, live, gone] = [await create(), await create({ published_at: minutesFromNow(300) }), await create({ is_published: true }), await create()];
    expectSuccess(await del(gone.id));

    const res = await bulk('publish', { ids: [draft.id, scheduled.id, live.id, gone.id, MISSING], is_published: true });
    expectSuccess(res, 200);
    expect(res.body.message).toBe('2 post(s) published');
    expect(res.body.data.affected).toBe(2);
    expect(res.body.data.skipped.sort()).toEqual([live.id, gone.id, MISSING].sort());

    for (const id of [draft.id, scheduled.id]) {
      const row = await detail(id);
      expect(row.is_published).toBe(true);
      expect(Date.parse(row.published_at)).toBeLessThanOrEqual(Date.now());
    }

    const off = await bulk('publish', { ids: [draft.id, scheduled.id], is_published: false });
    expect(off.body).toMatchObject({ message: '2 post(s) unpublished', data: { affected: 2, skipped: [] } });
    expect(await detail(draft.id)).toMatchObject({ is_published: false, published_at: null });

    const none = await bulk('publish', { ids: [draft.id], is_published: false });
    expect(none.body).toMatchObject({ message: 'No posts updated', data: { affected: 0, skipped: [draft.id] } });
  });

  it('soft-deletes the live posts, frees their slugs and skips the rest', async () => {
    const [one, two, gone] = [await create(), await create(), await create()];
    expectSuccess(await del(gone.id));

    const res = await bulk('delete', { ids: [one.id, two.id, gone.id] });
    expectSuccess(res, 200);
    expect(res.body).toMatchObject({ message: '2 post(s) deleted', data: { affected: 2, skipped: [gone.id] } });
    expectError(await admin(`/admin/${one.id}`), 404, 'NOT_FOUND', 'Post not found');

    // The slug is reusable and the trash shows the original.
    await create({ slug: one.slug });
    const trash = await admin('/trash?limit=100');
    expect(trash.body.data.items.find((i: { id: string }) => i.id === two.id)).toMatchObject({ slug: two.slug });

    expect((await bulk('delete', { ids: [one.id] })).body).toMatchObject({ message: 'No posts deleted', data: { affected: 0, skipped: [one.id] } });
  });

  it('validates ids and needs posts:update / posts:delete', async () => {
    expect(errorsOf(await bulk('delete', { ids: [] }))).toEqual(['ids must contain at least 1 elements']);
    expect(errorsOf(await bulk('delete', { ids: ['nope'] }))).toEqual(['each value in ids must be a UUID']);
    expect(errorsOf(await bulk('delete', { ids: Array.from({ length: 201 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`) }))).toEqual(['ids must contain no more than 200 elements']);
    expect(errorsOf(await bulk('publish', { ids: [MISSING] }))).toEqual(['is_published must be a boolean value']);

    const body = { ids: [MISSING], is_published: true };
    expectError(await api(`${BASE}/bulk/publish`, { method: 'POST', body }), 401, 'UNAUTHORIZED');
    expectError(await api(`${BASE}/bulk/publish`, { method: 'POST', token: await tokenWith(['posts:delete']), body }), 403, 'FORBIDDEN');
    expectError(await api(`${BASE}/bulk/delete`, { method: 'POST', token: await tokenWith(['posts:update']), body: { ids: [MISSING] } }), 403, 'FORBIDDEN');
  });
});

describe('DELETE, trash and restore', () => {
  it('soft-deletes, lists the post in the trash with its original slug, and restores it', async () => {
    const post = await create({ is_published: true });

    const res = await del(post.id);
    expectSuccess(res);
    expect(res.body).toMatchObject({ message: 'Post deleted', data: null });
    expectError(await del(post.id), 404, 'NOT_FOUND', 'Post not found');

    const trash = await admin('/trash?limit=100');
    expectSuccess(trash);
    expect(trash.body.message).toBe('Trash fetched');
    const row = trash.body.data.items.find((i: { id: string }) => i.id === post.id);
    expect(row).toMatchObject({ slug: post.slug, deleted_at: expect.stringMatching(ISO_DATE) });
    expect(row).not.toHaveProperty('created_by');
    expect(row.post_translations[0]).not.toHaveProperty('body');

    const back = await restore(post.id);
    expectSuccess(back);
    expect(back.body).toMatchObject({ message: 'Post restored', data: null });
    expectSuccess(await api(`${BASE}/${post.id}`));
    expect(await detail(post.id)).toMatchObject({ slug: post.slug, deleted_at: null });
    expectError(await restore(post.id), 404, 'NOT_FOUND', 'Deleted post not found');
  });

  it('frees the slug of a trashed post, and refuses to restore over a post that took it', async () => {
    const post = await create();
    expectSuccess(await del(post.id));
    const taker = await create({ slug: post.slug });
    expectError(await restore(post.id), 409, 'CONFLICT', `Cannot restore: slug "${post.slug}" is now used by another post`);

    expectSuccess(await patch(taker.id, { slug: uid() }));
    expectSuccess(await restore(post.id));
  });

  it('refuses to restore a post whose category is in the trash', async () => {
    const cat = await newCategory();
    const post = await create({ category_id: cat });
    await del(post.id);
    // The category only blocks deletion while it has LIVE posts, so it can go to the trash now.
    expectSuccess(await api(`${CATEGORIES}/${cat}`, { method: 'DELETE', token: await adminToken() }));

    expectError(await restore(post.id), 409, 'CONFLICT', 'Cannot restore: the parent category was deleted — restore the category first');

    expectSuccess(await api(`${CATEGORIES}/${cat}/restore`, { method: 'POST', token: await adminToken() }));
    expectSuccess(await restore(post.id));
  });

  it('401s and 403s on the destructive routes', async () => {
    const post = await create();
    const weak = await tokenWith(['posts:read']);
    for (const [method, path] of [
      ['GET', '/trash'],
      ['DELETE', `/${post.id}`],
      ['POST', `/${post.id}/restore`],
    ]) {
      expectError(await api(`${BASE}${path}`, { method }), 401, 'UNAUTHORIZED');
      expectError(await api(`${BASE}${path}`, { method, token: weak }), 403, 'FORBIDDEN');
    }
  });

  it('400s a malformed id on delete and restore', async () => {
    expectError(await del('nope'), 400, 'INVALID_IDENTIFIER', 'Invalid identifier format');
    expectError(await restore('nope'), 400, 'INVALID_IDENTIFIER', 'Invalid identifier format');
  });
});
