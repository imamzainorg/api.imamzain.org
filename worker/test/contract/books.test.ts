import { describe, expect, it } from 'vitest';
import { adminToken, api, expectError, expectSuccess, ISO_DATE, tokenWith, withDb } from './support/http';

const BASE = '/api/v1/books';
const CATEGORIES = '/api/v1/book-categories';
const MISSING = '00000000-0000-4000-8000-000000000000';

/** A value no earlier run used: the suite runs twice on one DB in CI. */
const uid = () => `bk-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
const ar = (title: string, extra: Record<string, unknown> = {}) => ({ lang: 'ar', title, is_default: true, ...extra });
const en = (title: string, extra: Record<string, unknown> = {}) => ({ lang: 'en', title, ...extra });
const errorsOf = (res: { body: { errors?: string[] } }) => res.body.errors;
const idsOf = (res: { body: { data: { items: { id: string }[] } } }) => res.body.data.items.map((i) => i.id);

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

let sharedCover: Promise<string> | undefined;
const cover = () => (sharedCover ??= newMedia());

async function newCategory(): Promise<string> {
  const slug = uid();
  const res = await api(CATEGORIES, { method: 'POST', token: await adminToken(), body: { translations: [{ lang: 'ar', title: slug, slug }] } });
  expectSuccess(res, 201);
  return res.body.data.id;
}

async function create(body: Record<string, unknown> = {}) {
  const title = uid();
  const res = await post({ category_id: await newCategory(), cover_image_id: await cover(), translations: [ar(`${title}-ar`), en(`${title}-en`)], ...body });
  expectSuccess(res, 201);
  return res.body.data;
}

/** A series parent and its parts, numbered from 1 of `total`. */
async function newSeries(partStates: boolean[] = [true], parentBody: Record<string, unknown> = {}) {
  const parent = await create(parentBody);
  const parts = [];
  for (const [i, is_published] of partStates.entries()) {
    parts.push(await create({ category_id: parent.category_id, parent_id: parent.id, part_number: i + 1, parts: partStates.length, is_published }));
  }
  return { parent, parts };
}

describe('POST /books', () => {
  it('creates the book, defaults to published and answers 201 with the hydrated admin row', async () => {
    const category = await newCategory();
    const media = await cover();
    const title = uid();
    const slug = uid();
    const isbn = uid();
    const res = await post({
      category_id: category,
      cover_image_id: media,
      slug,
      isbn,
      pages: 320,
      publish_year: '2010',
      pdf_url: 'https://example.test/books/a.pdf',
      document_languages: ['ar', 'fa'],
      is_publication: true,
      translations: [ar(`${title}-ar`, { author: 'A', publisher: 'P', description: 'وصف', series: 'S', meta_title: 'MT', meta_description: 'MD' }), en(`${title}-en`)],
    });

    expectSuccess(res, 201);
    expect(res.body.message).toBe('Book created');
    const data = res.body.data;
    expect(data).toMatchObject({
      category_id: category,
      cover_image_id: media,
      slug,
      isbn,
      pages: 320,
      publish_year: '2010',
      pdf_url: 'https://example.test/books/a.pdf',
      document_languages: ['ar', 'fa'],
      part_number: null,
      is_published: true,
      is_publication: true,
      views: 0,
      deleted_at: null,
      created_at: expect.stringMatching(ISO_DATE),
      added_by: expect.any(String),
      parts_count: 0,
      translation: { lang: 'ar', title: `${title}-ar`, author: 'A', publisher: 'P', description: 'وصف', series: 'S', is_default: true },
    });
    expect(data).not.toHaveProperty('parts_rel');
    expect(data).not.toHaveProperty('parent_id');
    expect(data).not.toHaveProperty('parent');
    expect(data.book_translations).toHaveLength(2);
    expect(data.book_categories.id).toBe(category);
    expect(data.media).toMatchObject({ id: media, media_variants: [] });
    expect(data.media).toHaveProperty('file_size');
  });

  it('accepts a minimal body and can create a draft', async () => {
    expect(await create()).toMatchObject({ slug: null, isbn: null, pdf_url: null, document_languages: [], is_publication: false, is_published: true });
    expect(await create({ is_published: false })).toMatchObject({ is_published: false });
  });

  it('refuses a translation set without exactly one default', async () => {
    const base = { category_id: await newCategory(), cover_image_id: await cover() };
    for (const translations of [[en(uid())], [ar(uid()), ar(uid(), { lang: 'en' })]]) {
      expectError(await post({ ...base, translations }), 400, 'BAD_REQUEST', 'Exactly one translation must have is_default = true');
    }
  });

  it('404s an unknown or trashed category, an unknown cover and an unknown og_image_id', async () => {
    const media = await cover();
    expectError(await post({ category_id: MISSING, cover_image_id: media, translations: [ar(uid())] }), 404, 'NOT_FOUND', 'Category not found');

    const trashed = await newCategory();
    expectSuccess(await api(`${CATEGORIES}/${trashed}`, { method: 'DELETE', token: await adminToken() }));
    expectError(await post({ category_id: trashed, cover_image_id: media, translations: [ar(uid())] }), 404, 'NOT_FOUND', 'Category not found');

    const category = await newCategory();
    expectError(await post({ category_id: category, cover_image_id: MISSING, translations: [ar(uid())] }), 404, 'NOT_FOUND', 'Cover image not found');
    expectError(
      await post({ category_id: category, cover_image_id: media, translations: [ar(uid(), { og_image_id: MISSING })] }),
      404,
      'NOT_FOUND',
      'One or more og_image_id values do not match any media record',
    );
  });

  it('409s a taken ISBN or slug', async () => {
    const book = await create({ isbn: uid(), slug: uid() });
    expectError(await post({ category_id: book.category_id, cover_image_id: await cover(), isbn: book.isbn, translations: [ar(uid())] }), 409, 'CONFLICT', 'A book with that ISBN already exists');
    expectError(
      await post({ category_id: book.category_id, cover_image_id: await cover(), slug: book.slug, translations: [ar(uid())] }),
      409,
      'CONFLICT',
      `Slug "${book.slug}" is already used by another book`,
    );
  });

  describe('series fields', () => {
    const body = async (extra: Record<string, unknown>) => ({ category_id: await newCategory(), cover_image_id: await cover(), translations: [ar(uid())], ...extra });

    it('requires part_number and parts together, and part_number within parts', async () => {
      expectError(await post(await body({ part_number: 1 })), 400, 'BAD_REQUEST', 'part_number and parts must be set together — send both, or neither');
      expectError(await post(await body({ parts: 2 })), 400, 'BAD_REQUEST', 'part_number and parts must be set together — send both, or neither');
      expectError(await post(await body({ part_number: 3, parts: 2 })), 400, 'BAD_REQUEST', 'part_number (3) cannot exceed parts (2)');
    });

    it('404s an unknown parent and 400s a parent that is itself a part', async () => {
      expectError(await post(await body({ parent_id: MISSING })), 404, 'NOT_FOUND', 'Parent book not found');
      const { parts } = await newSeries();
      expectError(await post(await body({ parent_id: parts[0].id })), 400, 'BAD_REQUEST', 'parent_id must point at a top-level book — that book is itself a part of a series');
    });

    it('409s a part number another live part of the series already holds', async () => {
      const { parent } = await newSeries([true]);
      expectError(
        await post(await body({ category_id: parent.category_id, parent_id: parent.id, part_number: 1, parts: 2 })),
        409,
        'CONFLICT',
        'That part number is already used by another part of this series',
      );
    });

    it('starts a new part in its series’ publication state unless told otherwise', async () => {
      const draftSeries = await create({ is_published: false });
      const part = await create({ parent_id: draftSeries.id });
      expect(part.is_published).toBe(false);
      expect(await create({ parent_id: draftSeries.id, is_published: true })).toMatchObject({ is_published: true });
    });
  });

  describe('validation', () => {
    const t = () => ar(uid());
    const ok = () => ({ category_id: MISSING, cover_image_id: MISSING, translations: [t()] });
    const cases: [string, () => unknown, string[]][] = [
      ['a missing category_id', () => ({ cover_image_id: MISSING, translations: [t()] }), ['category_id must be a UUID']],
      ['a missing cover_image_id', () => ({ category_id: MISSING, translations: [t()] }), ['cover_image_id must be a UUID']],
      ['an upper-case slug', () => ({ ...ok(), slug: 'Bad Slug' }), ['slug must match /^[a-z0-9]+(?:-[a-z0-9]+)*$/ regular expression']],
      ['an empty isbn', () => ({ ...ok(), isbn: '' }), ['isbn must be longer than or equal to 1 characters']],
      ['a zero pages', () => ({ ...ok(), pages: 0 }), ['pages must not be less than 1']],
      ['a fractional pages', () => ({ ...ok(), pages: 1.5 }), ['pages must be an integer number']],
      ['a non-http pdf_url', () => ({ ...ok(), pdf_url: 'ftp://x/y.pdf' }), ['pdf_url must be an http(s) URL']],
      ['one long document language', () => ({ ...ok(), document_languages: ['arb'] }), ['each value in document_languages must be longer than or equal to 2 characters']],
      ['a zero part_number', () => ({ ...ok(), part_number: 0, parts: 1 }), ['part_number must not be less than 1']],
      ['a malformed parent_id', () => ({ ...ok(), parent_id: 'nope' }), ['parent_id must be a UUID']],
      ['a non-boolean is_publication', () => ({ ...ok(), is_publication: 'yes' }), ['is_publication must be a boolean value']],
      ['an empty list', () => ({ ...ok(), translations: [] }), ['translations must contain at least 1 elements']],
      ['an empty title', () => ({ ...ok(), translations: [{ ...t(), title: '' }] }), ['translations.0.title must be longer than or equal to 1 characters']],
      ['a 301-char meta_title', () => ({ ...ok(), translations: [{ ...t(), meta_title: 'x'.repeat(301) }] }), ['translations.0.meta_title must be shorter than or equal to 300 characters']],
      ['a malformed og_image_id', () => ({ ...ok(), translations: [{ ...t(), og_image_id: 'nope' }] }), ['translations.0.og_image_id must be a UUID']],
      ['an unknown translation key', () => ({ ...ok(), translations: [{ ...t(), extra: 1 }] }), ['translations.0.property extra should not exist']],
      ['an unknown key', () => ({ ...ok(), extra: 1 }), ['property extra should not exist']],
    ];

    it.each(cases)('rejects %s with Nest’s messages', async (_name, body, errors) => {
      const res = await post(body());
      expectError(res, 400, 'VALIDATION_FAILED', 'Validation failed');
      expect(errorsOf(res)).toEqual(errors);
    });
  });

  it('401s without a token and 403s without books:create', async () => {
    const body = { category_id: MISSING, cover_image_id: MISSING, translations: [ar(uid())] };
    expectError(await api(BASE, { method: 'POST', body }), 401, 'UNAUTHORIZED');
    expectError(await api(BASE, { method: 'POST', token: await tokenWith(['books:read']), body }), 403, 'FORBIDDEN');
  });
});

describe('GET /books', () => {
  it('lists published top-level books, newest first, with slim translations, and is CDN-cacheable', async () => {
    const live = await create({ translations: [ar(uid(), { description: 'long description' })] });
    const draft = await create({ is_published: false });
    const gone = await create();
    expectSuccess(await del(gone.id));

    const res = await api(`${BASE}?limit=100`);
    expectSuccess(res);
    expect(res.body.message).toBe('Books fetched');
    expect(res.headers.get('cache-control')).toBe('public, max-age=60, s-maxage=300');
    expect(res.headers.get('vary')).toContain('Accept-Language');
    const ids = idsOf(res);
    expect(ids).toContain(live.id);
    expect(ids).not.toContain(draft.id);
    expect(ids).not.toContain(gone.id);
    const row = res.body.data.items.find((i: { id: string }) => i.id === live.id);
    expect(row).not.toHaveProperty('added_by');
    expect(row).not.toHaveProperty('_count');
    expect(row.parts_count).toBe(0);
    expect(row.book_translations[0]).not.toHaveProperty('description');
    expect(row.translation).not.toHaveProperty('description');
    expect(row.book_categories).toMatchObject({ id: live.category_id });
    expect(row.media).toMatchObject({ id: live.cover_image_id, media_variants: [] });
    expect(row.media).not.toHaveProperty('file_size');
    expect(res.body.data.pagination).toMatchObject({ page: 1, limit: 100, total: expect.any(Number), pages: expect.any(Number) });
  });

  it('hides series parts and counts only the visible ones in parts_count', async () => {
    const { parent, parts } = await newSeries([true, false]);
    const [published, draft] = parts;

    const pub = await api(`${BASE}?limit=100`);
    expect(idsOf(pub)).toContain(parent.id);
    expect(idsOf(pub)).not.toContain(published.id);
    expect(pub.body.data.items.find((i: { id: string }) => i.id === parent.id).parts_count).toBe(1);

    const adm = await admin('/admin?limit=100');
    expect(idsOf(adm)).toEqual(expect.arrayContaining([parent.id]));
    expect(idsOf(adm)).not.toContain(draft.id);
    expect(adm.body.data.items.find((i: { id: string }) => i.id === parent.id).parts_count).toBe(2);
  });

  it('filters by category and is_publication, and resolves the translation by Accept-Language', async () => {
    const category = await newCategory();
    const title = uid();
    const mine = await create({ category_id: category, is_publication: true, translations: [ar(`${title}-ar`), en(`${title}-en`)] });
    const plain = await create({ category_id: category });

    const res = await api(`${BASE}?category_id=${category}&is_publication=true`, { lang: 'en' });
    expect(idsOf(res)).toEqual([mine.id]);
    expect(res.body.data.items[0].translation).toMatchObject({ lang: 'en', title: `${title}-en` });
    expect(idsOf(await api(`${BASE}?category_id=${category}&is_publication=false`))).toEqual([plain.id]);
    expect(idsOf(await api(`${BASE}?category_id=${category}`)).sort()).toEqual([mine.id, plain.id].sort());
  });

  it('searches titles case-insensitively', async () => {
    const needle = uid();
    const hit = await create({ translations: [ar(`Title ${needle.toUpperCase()}`)] });
    await create();
    expect(idsOf(await api(`${BASE}?search=${needle}`))).toEqual([hit.id]);
  });

  it('paginates with a stable order', async () => {
    await create();
    await create();
    const page1 = await api(`${BASE}?page=1&limit=1`);
    const page2 = await api(`${BASE}?page=2&limit=1`);
    expect(idsOf(page1)).toHaveLength(1);
    expect(idsOf(page1)[0]).not.toBe(idsOf(page2)[0]);
  });

  it('rejects bad query parameters', async () => {
    expect(errorsOf(await api(`${BASE}?category_id=nope`))).toEqual(['category_id must be a UUID']);
    expect(errorsOf(await api(`${BASE}?search=a`))).toEqual(['search must be longer than or equal to 2 characters']);
    expect(errorsOf(await api(`${BASE}?is_publication=yes`))).toEqual(['is_publication must be a boolean value']);
    expect(errorsOf(await api(`${BASE}?limit=101`))).toEqual(['limit must not be greater than 100']);
    expect(errorsOf(await api(`${BASE}?extra=1`))).toEqual(['property extra should not exist']);
  });
});

describe('GET /books/admin', () => {
  it('includes drafts, keeps added_by, and needs books:read', async () => {
    const live = await create();
    const draft = await create({ is_published: false });

    const res = await admin('/admin?limit=100');
    expectSuccess(res);
    expect(idsOf(res)).toEqual(expect.arrayContaining([live.id, draft.id]));
    expectError(await api(`${BASE}/admin`), 401, 'UNAUTHORIZED');
    expectError(await api(`${BASE}/admin`, { token: await tokenWith(['books:create']) }), 403, 'FORBIDDEN');
  });

  it('GET /admin/:id returns a draft with every column and its draft parts, and 404s a trashed or missing book', async () => {
    const { parent, parts } = await newSeries([false], { is_published: false });
    const res = await admin(`/admin/${parent.id}`);
    expectSuccess(res);
    expect(res.body.data).toMatchObject({ id: parent.id, added_by: expect.any(String), parts_count: 1 });
    expect(res.body.data.parts.map((p: { id: string }) => p.id)).toEqual([parts[0].id]);

    expectError(await admin(`/admin/${MISSING}`), 404, 'NOT_FOUND', 'Book not found');
    expectError(await api(`${BASE}/admin/${MISSING}`), 401, 'UNAUTHORIZED');
  });
});

describe('GET /books/:id and /books/by-slug/:slug', () => {
  it('serves a published book without staff columns and caches it', async () => {
    const book = await create({ slug: uid(), translations: [ar(uid(), { description: 'full description' }), en(uid())] });
    const res = await api(`${BASE}/${book.id}`);
    expectSuccess(res);
    expect(res.body.message).toBe('Book fetched');
    expect(res.body.data).not.toHaveProperty('added_by');
    expect(res.body.data).not.toHaveProperty('parent_id');
    expect(res.body.data.media).not.toHaveProperty('file_size');
    expect(res.body.data.book_translations[0]).toMatchObject({ description: 'full description' });
    expect(res.body.data.translation).toMatchObject({ description: 'full description' });
    expect(res.headers.get('cache-control')).toBe('public, max-age=60, s-maxage=300');

    const bySlug = await api(`${BASE}/by-slug/${book.slug}`, { lang: 'en' });
    expectSuccess(bySlug);
    expect(bySlug.body.data.id).toBe(book.id);
    expect(bySlug.body.data.translation.lang).toBe('en');
    expect(bySlug.headers.get('cache-control')).toBe('public, max-age=60, s-maxage=300');
  });

  it('404s a draft, a trashed book and a missing id or slug; 400s a malformed id', async () => {
    const draft = await create({ is_published: false, slug: uid() });
    expectError(await api(`${BASE}/${draft.id}`), 404, 'NOT_FOUND', 'Book not found');
    expectError(await api(`${BASE}/by-slug/${draft.slug}`), 404, 'NOT_FOUND', 'Book not found');
    expectError(await api(`${BASE}/${MISSING}`), 404, 'NOT_FOUND', 'Book not found');
    expectError(await api(`${BASE}/by-slug/${uid()}`), 404, 'NOT_FOUND', 'Book not found');
    expectError(await api(`${BASE}/not-a-uuid`), 400, 'INVALID_IDENTIFIER', 'Invalid identifier format');

    const live = await create({ slug: uid() });
    expectSuccess(await del(live.id));
    expectError(await api(`${BASE}/${live.id}`), 404, 'NOT_FOUND', 'Book not found');
  });

  it('lists a series’ visible parts in part order on the parent, and links a part back to its parent', async () => {
    const parent = await create({ slug: uid() });
    const second = await create({ category_id: parent.category_id, parent_id: parent.id, part_number: 2, parts: 3 });
    const first = await create({ category_id: parent.category_id, parent_id: parent.id, part_number: 1, parts: 3 });
    const hidden = await create({ category_id: parent.category_id, parent_id: parent.id, part_number: 3, parts: 3, is_published: false });

    const res = await api(`${BASE}/${parent.id}`);
    expect(res.body.data.parts_count).toBe(2);
    expect(res.body.data.parts.map((p: { id: string }) => p.id)).toEqual([first.id, second.id]);
    expect(res.body.data.parts[0]).toMatchObject({ part_number: 1, translation: { lang: 'ar' }, media: { id: first.cover_image_id } });
    expect(res.body.data.parts[0]).not.toHaveProperty('added_by');
    expect(res.body.data).not.toHaveProperty('parent');
    expect((await admin(`/admin/${parent.id}`)).body.data.parts_count).toBe(3);

    const part = await api(`${BASE}/${first.id}`);
    // The `parts` column (series total) is shadowed by the `parts` array on every detail response, so a part has none.
    expect(part.body.data).not.toHaveProperty('parts');
    expect(part.body.data).toMatchObject({ part_number: 1, parent: { id: parent.id, slug: parent.slug, translation: { lang: 'ar' } } });
    expectError(await api(`${BASE}/${hidden.id}`), 404, 'NOT_FOUND');
  });

  it('keeps a part private while its series is unpublished or trashed', async () => {
    const { parent, parts } = await newSeries([true]);
    const part = parts[0];
    expectSuccess(await api(`${BASE}/${part.id}`));

    expectSuccess(await publish(parent.id, { is_published: false }));
    expectError(await api(`${BASE}/${part.id}`), 404, 'NOT_FOUND', 'Book not found');
    expectError(await api(`${BASE}/${part.id}/view`, { method: 'POST' }), 404, 'NOT_FOUND', 'Book not found');
    expectSuccess(await admin(`/admin/${part.id}`));

    expectSuccess(await publish(parent.id, { is_published: true }));
    expectSuccess(await api(`${BASE}/${part.id}`));
  });
});

describe('POST /books/:id/view', () => {
  it('counts a view on a published book and answers 201', async () => {
    const book = await create();
    const res = await api(`${BASE}/${book.id}/view`, { method: 'POST' });
    expectSuccess(res, 201);
    expect(res.body).toMatchObject({ message: 'View tracked', data: null });
    await api(`${BASE}/${book.id}/view`, { method: 'POST' });
    expect((await admin(`/admin/${book.id}`)).body.data.views).toBe(2);
  });

  it('404s a draft and a missing id', async () => {
    const draft = await create({ is_published: false });
    expectError(await api(`${BASE}/${draft.id}/view`, { method: 'POST' }), 404, 'NOT_FOUND', 'Book not found');
    expectError(await api(`${BASE}/${MISSING}/view`, { method: 'POST' }), 404, 'NOT_FOUND', 'Book not found');
    expect((await admin(`/admin/${draft.id}`)).body.data.views).toBe(0);
  });

  it('is limited to 30 a minute per IP', async () => {
    const ip = `10.99.${(Math.random() * 256) | 0}.${(Math.random() * 256) | 0}`;
    let last = 0;
    for (let i = 0; i < 31; i++) last = (await api(`${BASE}/${MISSING}/view`, { method: 'POST', ip })).status;
    expect(last).toBe(429);
  });
});

describe('PATCH /books/:id', () => {
  it('updates fields, upserts translations by language and keeps the rest', async () => {
    const book = await create({ pages: 10, pdf_url: 'https://example.test/keep.pdf' });
    const title = uid();

    const res = await patch(book.id, {
      pages: 20,
      document_languages: ['fa'],
      is_publication: true,
      translations: [en(title, { author: 'Z', is_default: false }), ar(`${title}-ar`)],
    });
    expectSuccess(res);
    expect(res.body.message).toBe('Book updated');
    expect(res.body.data).toMatchObject({ pages: 20, document_languages: ['fa'], is_publication: true, pdf_url: 'https://example.test/keep.pdf' });
    expect(res.body.data.book_translations).toHaveLength(2);
    expect(res.body.data.book_translations.find((t: { lang: string }) => t.lang === 'en')).toMatchObject({ title, author: 'Z', is_default: false });
  });

  it('moves the book to another live category and cover, and clears the pdf with null', async () => {
    const book = await create({ pdf_url: 'https://example.test/gone.pdf' });
    const otherCategory = await newCategory();
    const otherCover = await newMedia();
    const res = await patch(book.id, { category_id: otherCategory, cover_image_id: otherCover, pdf_url: null });
    expectSuccess(res);
    expect(res.body.data).toMatchObject({ category_id: otherCategory, cover_image_id: otherCover, pdf_url: null });
    expect(res.body.data.book_categories.id).toBe(otherCategory);
    expect(res.body.data.media.id).toBe(otherCover);
  });

  it('refuses a translation set that ends without exactly one default, and rolls everything back', async () => {
    const book = await create({ pages: 111 });
    const res = await patch(book.id, { pages: 222, translations: [en(uid(), { is_default: true })] });
    expectError(res, 400, 'BAD_REQUEST', 'Exactly one translation must have is_default: true');
    expect((await admin(`/admin/${book.id}`)).body.data).toMatchObject({ pages: 111 });
  });

  it('404s an unknown category, cover or og_image_id, a missing book and a trashed book', async () => {
    const book = await create();
    expectError(await patch(book.id, { category_id: MISSING }), 404, 'NOT_FOUND', 'Category not found');
    expectError(await patch(book.id, { cover_image_id: MISSING }), 404, 'NOT_FOUND', 'Cover image not found');
    expectError(await patch(book.id, { translations: [ar(uid(), { og_image_id: MISSING })] }), 404, 'NOT_FOUND', 'One or more og_image_id values do not match any media record');
    expectError(await patch(MISSING, { pages: 1 }), 404, 'NOT_FOUND', 'Book not found');
    expectSuccess(await del(book.id));
    expectError(await patch(book.id, { pages: 1 }), 404, 'NOT_FOUND', 'Book not found');
  });

  it('409s an ISBN or slug another book holds', async () => {
    const taken = await create({ isbn: uid(), slug: uid() });
    const book = await create({ is_published: false });
    expectError(await patch(book.id, { isbn: taken.isbn }), 409, 'CONFLICT', 'A book with that ISBN already exists');
    expectError(await patch(book.id, { slug: taken.slug }), 409, 'CONFLICT', `Slug "${taken.slug}" is already used by another book`);
    expectSuccess(await patch(book.id, { isbn: uid() }));
  });

  describe('slug lock', () => {
    it('refuses to rename the slug of a book that is and stays published', async () => {
      const book = await create({ slug: uid() });
      expectError(await patch(book.id, { slug: uid() }), 409, 'SLUG_LOCKED_WHILE_PUBLISHED', 'cannot be changed');
      expectSuccess(await patch(book.id, { slug: book.slug, pages: 5 }));
    });

    it('allows the first slug, a rename on a draft and a rename in the request that unpublishes', async () => {
      const noSlug = await create();
      expectSuccess(await patch(noSlug.id, { slug: uid() }));

      const draft = await create({ slug: uid(), is_published: false });
      const renamed = uid();
      expect((await patch(draft.id, { slug: renamed })).body.data.slug).toBe(renamed);

      const live = await create({ slug: uid() });
      const next = uid();
      expect((await patch(live.id, { slug: next, is_published: false })).body.data).toMatchObject({ slug: next, is_published: false });
    });
  });

  describe('series fields', () => {
    it('validates part_number and parts as they will be after the patch', async () => {
      const { parts } = await newSeries([true, true]);
      expectError(await patch(parts[0].id, { part_number: null }), 400, 'BAD_REQUEST', 'part_number and parts must be set together — send both, or neither');
      expectError(await patch(parts[0].id, { part_number: 3 }), 400, 'BAD_REQUEST', 'part_number (3) cannot exceed parts (2)');
      expectError(await patch(parts[0].id, { part_number: 2 }), 409, 'CONFLICT', 'That part number is already used by another part of this series');
      expectSuccess(await patch(parts[0].id, { part_number: null, parts: null }));
    });

    it('refuses a book as its own parent (any letter case), a parent that is a part, and a parent for a book with parts', async () => {
      const { parent, parts } = await newSeries([true]);
      const other = await create();
      expectError(await patch(other.id, { parent_id: other.id.toUpperCase() }), 400, 'BAD_REQUEST', 'A book cannot be its own parent');
      expectError(await patch(other.id, { parent_id: parts[0].id }), 400, 'BAD_REQUEST', 'parent_id must point at a top-level book — that book is itself a part of a series');
      expectError(await patch(parent.id, { parent_id: other.id }), 400, 'BAD_REQUEST', 'Cannot set a parent — this book already has its own parts');
      expectError(await patch(other.id, { parent_id: MISSING }), 404, 'NOT_FOUND', 'Parent book not found');
    });

    it('attaches a book to a series and detaches it with null', async () => {
      const { parent } = await newSeries([true]);
      const loose = await create({ category_id: parent.category_id });

      const attached = await patch(loose.id, { parent_id: parent.id, part_number: 2, parts: 2 });
      expectSuccess(attached);
      expect(attached.body.data.parent).toMatchObject({ id: parent.id });
      expect(idsOf(await admin('/admin?limit=100'))).not.toContain(loose.id);

      const detached = await patch(loose.id, { parent_id: null, part_number: null, parts: null });
      expectSuccess(detached);
      expect(detached.body.data).not.toHaveProperty('parent');
      expect(idsOf(await admin('/admin?limit=100'))).toContain(loose.id);
    });
  });

  it('rejects bad bodies and needs books:update', async () => {
    const book = await create();
    expect(errorsOf(await patch(book.id, { category_id: 'nope' }))).toEqual(['category_id must be a UUID']);
    expect(errorsOf(await patch(book.id, { pdf_url: 'nope' }))).toEqual(['pdf_url must be an http(s) URL']);
    expect(errorsOf(await patch(book.id, { parent_id: 'nope' }))).toEqual(['parent_id must be a UUID']);
    expect(errorsOf(await patch(book.id, { translations: [{ lang: 'ar', title: '' }] }))).toEqual(['translations.0.title must be longer than or equal to 1 characters']);
    expect(errorsOf(await patch(book.id, { extra: 1 }))).toEqual(['property extra should not exist']);
    expectError(await api(`${BASE}/${book.id}`, { method: 'PATCH', body: {} }), 401, 'UNAUTHORIZED');
    expectError(await api(`${BASE}/${book.id}`, { method: 'PATCH', token: await tokenWith(['books:read']), body: {} }), 403, 'FORBIDDEN');
  });
});

describe('PATCH /books/:id/publish', () => {
  it('publishes and unpublishes, and answers "already" for a no-op', async () => {
    const book = await create({ is_published: false });

    const on = await publish(book.id, { is_published: true });
    expectSuccess(on);
    expect(on.body).toMatchObject({ message: 'Book published', data: { id: book.id, is_published: true } });
    expectSuccess(await api(`${BASE}/${book.id}`));

    const again = await publish(book.id, { is_published: true });
    expectSuccess(again);
    expect(again.body.message).toBe('Book already in requested state');

    const off = await publish(book.id, { is_published: false });
    expect(off.body).toMatchObject({ message: 'Book unpublished', data: { is_published: false } });
    expectError(await api(`${BASE}/${book.id}`), 404, 'NOT_FOUND');
  });

  it('404s a missing or trashed book; validates the body; needs books:update', async () => {
    const book = await create();
    expectError(await publish(MISSING, { is_published: true }), 404, 'NOT_FOUND', 'Book not found');
    expect(errorsOf(await publish(book.id, { is_published: 'yes' }))).toEqual(['is_published must be a boolean value']);
    expectError(await api(`${BASE}/${book.id}/publish`, { method: 'PATCH', token: await tokenWith(['books:read']), body: { is_published: true } }), 403, 'FORBIDDEN');
    expectSuccess(await del(book.id));
    expectError(await publish(book.id, { is_published: true }), 404, 'NOT_FOUND', 'Book not found');
  });
});

describe('DELETE, trash and restore', () => {
  it('soft-deletes, lists the book in the trash with its original slug and ISBN, and restores it', async () => {
    const book = await create({ slug: uid(), isbn: uid() });

    const res = await del(book.id);
    expectSuccess(res);
    expect(res.body).toMatchObject({ message: 'Book deleted', data: null });
    expectError(await del(book.id), 404, 'NOT_FOUND', 'Book not found');

    const trash = await admin('/trash?limit=100');
    expectSuccess(trash);
    expect(trash.body.message).toBe('Trash fetched');
    const row = trash.body.data.items.find((i: { id: string }) => i.id === book.id);
    expect(row).toMatchObject({ slug: book.slug, isbn: book.isbn, deleted_at: expect.stringMatching(ISO_DATE) });
    expect(row).not.toHaveProperty('added_by');
    expect(row.book_translations[0]).not.toHaveProperty('description');

    const back = await restore(book.id);
    expectSuccess(back);
    expect(back.body).toMatchObject({ message: 'Book restored', data: null });
    expectSuccess(await api(`${BASE}/${book.id}`));
    expect((await admin(`/admin/${book.id}`)).body.data).toMatchObject({ slug: book.slug, isbn: book.isbn });
    expectError(await restore(book.id), 404, 'NOT_FOUND', 'Deleted book not found');
  });

  it('frees the slug and ISBN of a trashed book, and refuses to restore over a book that took them', async () => {
    const book = await create({ slug: uid(), isbn: uid() });
    expectSuccess(await del(book.id));

    const taker = await create({ slug: book.slug, isbn: book.isbn });
    expectError(await restore(book.id), 409, 'CONFLICT', `Cannot restore: ISBN ${book.isbn} is now used by another book`);

    expectSuccess(await patch(taker.id, { isbn: uid(), is_published: false }));
    expectError(await restore(book.id), 409, 'CONFLICT', `Cannot restore: slug "${book.slug}" is now used by another book`);

    expectSuccess(await del(taker.id));
    expectSuccess(await restore(book.id));
  });

  it('refuses to restore a book whose category is in the trash', async () => {
    const category = await newCategory();
    const book = await create({ category_id: category });
    await del(book.id);
    // The category only blocks deletion while it has LIVE books, so it can go to the trash now.
    expectSuccess(await api(`${CATEGORIES}/${category}`, { method: 'DELETE', token: await adminToken() }));

    expectError(await restore(book.id), 409, 'CONFLICT', 'Cannot restore: the parent category was deleted — restore the category first');

    expectSuccess(await api(`${CATEGORIES}/${category}/restore`, { method: 'POST', token: await adminToken() }));
    expectSuccess(await restore(book.id));
  });

  it('refuses to delete a series that still has live parts, until they are deleted', async () => {
    const { parent, parts } = await newSeries([true, true]);
    expectError(await del(parent.id), 409, 'CONFLICT', 'Cannot delete: this book is a series with 2 live part(s) — delete or detach the parts first');

    expectSuccess(await del(parts[0].id));
    expectError(await del(parent.id), 409, 'CONFLICT', 'Cannot delete: this book is a series with 1 live part(s)');
    expectSuccess(await del(parts[1].id));
    expectSuccess(await del(parent.id));
  });

  it('shows a trashed part as its own trash row and restores it only under a live series and a free part number', async () => {
    const { parent, parts } = await newSeries([true]);
    const part = parts[0];
    expectSuccess(await del(part.id));
    expect(idsOf(await admin('/trash?limit=100'))).toContain(part.id);

    const taker = await create({ category_id: parent.category_id, parent_id: parent.id, part_number: 1, parts: 1 });
    expectError(await restore(part.id), 409, 'CONFLICT', 'Cannot restore: part number 1 is now used by another part of the series');
    expectSuccess(await del(taker.id));

    expectSuccess(await del(parent.id));
    expectError(await restore(part.id), 409, 'CONFLICT', 'Cannot restore: the series this part belongs to was deleted — restore the series first');

    expectSuccess(await restore(parent.id));
    expectSuccess(await restore(part.id));
  });

  it('401s and 403s on the destructive routes', async () => {
    const book = await create();
    const weak = await tokenWith(['books:read']);
    for (const [method, path] of [
      ['GET', '/trash'],
      ['DELETE', `/${book.id}`],
      ['POST', `/${book.id}/restore`],
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
