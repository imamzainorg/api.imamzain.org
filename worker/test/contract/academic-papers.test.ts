import { describe, expect, it } from 'vitest';
import { adminToken, api, expectError, expectSuccess, ISO_DATE, tokenWith } from './support/http';

const BASE = '/api/v1/academic-papers';
const MISSING = '00000000-0000-4000-8000-000000000000';

/** A value no earlier run used: the suite runs twice on one DB in CI. */
const uid = () => `ap-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
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

async function newCategory(): Promise<string> {
  const slug = uid();
  const res = await api('/api/v1/academic-paper-categories', {
    method: 'POST',
    token: await adminToken(),
    body: { translations: [{ lang: 'ar', title: slug, slug }] },
  });
  expectSuccess(res, 201);
  return res.body.data.id;
}

async function create(body: Record<string, unknown> = {}) {
  const title = uid();
  const res = await post({ category_id: await newCategory(), translations: [ar(`${title}-ar`), en(`${title}-en`)], ...body });
  expectSuccess(res, 201);
  return res.body.data;
}

describe('POST /academic-papers', () => {
  it('creates the paper, defaults to published and answers 201 with the hydrated admin row', async () => {
    const category = await newCategory();
    const title = uid();
    const res = await post({
      category_id: category,
      published_year: '2021',
      pdf_url: 'https://example.test/papers/a.pdf',
      document_languages: ['ar', 'fa'],
      translations: [
        ar(`${title}-ar`, { abstract: 'ملخص', authors: ['A', 'B'], keywords: ['k1'], publication_venue: 'Journal', page_count: 12 }),
        en(`${title}-en`),
      ],
    });

    expectSuccess(res, 201);
    expect(res.body.message).toBe('Paper created');
    const data = res.body.data;
    expect(data).toMatchObject({
      category_id: category,
      published_year: '2021',
      pdf_url: 'https://example.test/papers/a.pdf',
      document_languages: ['ar', 'fa'],
      is_published: true,
      views: 0,
      deleted_at: null,
      created_at: expect.stringMatching(ISO_DATE),
      uploaded_by: expect.any(String),
      translation: { lang: 'ar', title: `${title}-ar`, abstract: 'ملخص', authors: ['A', 'B'], keywords: ['k1'], publication_venue: 'Journal', page_count: 12, is_default: true },
    });
    expect(data.academic_paper_translations).toHaveLength(2);
    expect(data.academic_paper_translations.find((t: { lang: string }) => t.lang === 'en')).toMatchObject({ abstract: null, authors: [], keywords: [], page_count: null, is_default: false });
    expect(data.academic_paper_categories.id).toBe(category);
    expect(data.academic_paper_categories.academic_paper_category_translations).toHaveLength(1);
  });

  it('accepts a minimal body and can create a draft', async () => {
    expect(await create()).toMatchObject({ published_year: null, pdf_url: null, document_languages: [] });
    expect(await create({ is_published: false })).toMatchObject({ is_published: false });
  });

  it('accepts a pdf_url without a scheme, as a bare @IsUrl() does', async () => {
    expect(await create({ pdf_url: 'example.test/papers/b.pdf' })).toMatchObject({ pdf_url: 'example.test/papers/b.pdf' });
  });

  it('refuses a translation set without exactly one default', async () => {
    const category = await newCategory();
    for (const translations of [[en(uid())], [ar(uid()), ar(uid(), { lang: 'en' })]]) {
      expectError(await post({ category_id: category, translations }), 400, 'BAD_REQUEST', 'Exactly one translation must have is_default = true');
    }
  });

  it('404s for an unknown or trashed category, and 409s a repeated language', async () => {
    expectError(await post({ category_id: MISSING, translations: [ar(uid())] }), 404, 'NOT_FOUND', 'Category not found');

    const trashed = await newCategory();
    expectSuccess(await api(`/api/v1/academic-paper-categories/${trashed}`, { method: 'DELETE', token: await adminToken() }));
    expectError(await post({ category_id: trashed, translations: [ar(uid())] }), 404, 'NOT_FOUND', 'Category not found');

    expectError(
      await post({ category_id: await newCategory(), translations: [ar(uid()), ar(uid(), { is_default: false })] }),
      409,
      'CONFLICT',
      'Duplicate translation language in the request',
    );
  });

  describe('validation', () => {
    const t = () => ar(uid());
    const ok = () => ({ category_id: MISSING, translations: [t()] });
    const cases: [string, () => unknown, string[]][] = [
      ['a missing category_id', () => ({ translations: [t()] }), ['category_id must be a UUID']],
      ['a malformed category_id', () => ({ ...ok(), category_id: 'nope' }), ['category_id must be a UUID']],
      ['a 65-char published_year', () => ({ ...ok(), published_year: 'x'.repeat(65) }), ['published_year must be shorter than or equal to 64 characters']],
      ['a bad pdf_url', () => ({ ...ok(), pdf_url: 'nope' }), ['pdf_url must be a URL address']],
      ['a 2049-char pdf_url', () => ({ ...ok(), pdf_url: `https://example.test/${'a'.repeat(2040)}` }), ['pdf_url must be shorter than or equal to 2048 characters']],
      // class-validator words @Length({ each }) from the array's length, not the element's.
      ['one long document language', () => ({ ...ok(), document_languages: ['arb'] }), ['each value in document_languages must be longer than or equal to 2 characters']],
      ['three document languages, one long', () => ({ ...ok(), document_languages: ['ar', 'en', 'fas'] }), ['each value in document_languages must be shorter than or equal to 2 characters']],
      ['two document languages, one long', () => ({ ...ok(), document_languages: ['ar', 'fas'] }), ['each value in document_languages must be longer than or equal to 2 and shorter than or equal to 2 characters']],
      ['51 document languages', () => ({ ...ok(), document_languages: Array.from({ length: 51 }, () => 'ar') }), ['document_languages must contain no more than 50 elements']],
      ['a non-boolean is_published', () => ({ ...ok(), is_published: 'yes' }), ['is_published must be a boolean value']],
      ['an empty list', () => ({ category_id: MISSING, translations: [] }), ['translations must contain at least 1 elements']],
      ['a 51-item list', () => ({ category_id: MISSING, translations: Array.from({ length: 51 }, t) }), ['translations must contain no more than 50 elements']],
      ['a three-letter lang', () => ({ ...ok(), translations: [{ ...t(), lang: 'abc' }] }), ['translations.0.lang must be shorter than or equal to 2 characters']],
      ['an empty title', () => ({ ...ok(), translations: [{ ...t(), title: '' }] }), ['translations.0.title must be longer than or equal to 1 characters']],
      ['a 501-char title', () => ({ ...ok(), translations: [{ ...t(), title: 'x'.repeat(501) }] }), ['translations.0.title must be shorter than or equal to 500 characters']],
      ['a 5001-char abstract', () => ({ ...ok(), translations: [{ ...t(), abstract: 'x'.repeat(5001) }] }), ['translations.0.abstract must be shorter than or equal to 5000 characters']],
      ['a 301-char author', () => ({ ...ok(), translations: [{ ...t(), authors: ['x'.repeat(301)] }] }), ['translations.0.each value in authors must be shorter than or equal to 300 characters']],
      ['51 authors', () => ({ ...ok(), translations: [{ ...t(), authors: Array.from({ length: 51 }, () => 'a') }] }), ['translations.0.authors must contain no more than 50 elements']],
      ['a 201-char keyword', () => ({ ...ok(), translations: [{ ...t(), keywords: ['x'.repeat(201)] }] }), ['translations.0.each value in keywords must be shorter than or equal to 200 characters']],
      ['a 501-char venue', () => ({ ...ok(), translations: [{ ...t(), publication_venue: 'x'.repeat(501) }] }), ['translations.0.publication_venue must be shorter than or equal to 500 characters']],
      ['a zero page_count', () => ({ ...ok(), translations: [{ ...t(), page_count: 0 }] }), ['translations.0.page_count must not be less than 1']],
      ['a fractional page_count', () => ({ ...ok(), translations: [{ ...t(), page_count: 1.5 }] }), ['translations.0.page_count must be an integer number']],
      ['an unknown translation key', () => ({ ...ok(), translations: [{ ...t(), extra: 1 }] }), ['translations.0.property extra should not exist']],
      ['an unknown key', () => ({ ...ok(), extra: 1 }), ['property extra should not exist']],
    ];

    it.each(cases)('rejects %s with Nest’s messages', async (_name, body, errors) => {
      const res = await post(body());
      expectError(res, 400, 'VALIDATION_FAILED', 'Validation failed');
      expect(errorsOf(res)).toEqual(errors);
    });
  });

  it('401s without a token and 403s without academic-papers:create', async () => {
    const body = { category_id: MISSING, translations: [ar(uid())] };
    expectError(await api(BASE, { method: 'POST', body }), 401, 'UNAUTHORIZED');
    expectError(await api(BASE, { method: 'POST', token: await tokenWith(['academic-papers:read']), body }), 403, 'FORBIDDEN');
  });
});

describe('GET /academic-papers', () => {
  it('lists published papers only, newest first, with slim translations and no uploader, and is CDN-cacheable', async () => {
    const live = await create({ translations: [ar(uid(), { abstract: 'long abstract' })] });
    const draft = await create({ is_published: false });
    const gone = await create();
    expectSuccess(await del(gone.id));

    const res = await api(`${BASE}?limit=100`);
    expectSuccess(res);
    expect(res.body.message).toBe('Papers fetched');
    expect(res.headers.get('cache-control')).toBe('public, max-age=60, s-maxage=300');
    expect(res.headers.get('vary')).toContain('Accept-Language');
    const ids = idsOf(res);
    expect(ids).toContain(live.id);
    expect(ids).not.toContain(draft.id);
    expect(ids).not.toContain(gone.id);
    const row = res.body.data.items.find((i: { id: string }) => i.id === live.id);
    expect(row).not.toHaveProperty('uploaded_by');
    expect(row.academic_paper_translations[0]).not.toHaveProperty('abstract');
    expect(row.academic_paper_categories).toMatchObject({ id: live.category_id });
    expect(res.body.data.pagination).toMatchObject({ page: 1, limit: 100, total: expect.any(Number), pages: expect.any(Number) });
  });

  it('keeps the uploader on the admin list', async () => {
    const paper = await create();
    const res = await admin('/admin?limit=100');
    expect(res.body.data.items.find((i: { id: string }) => i.id === paper.id)).toHaveProperty('uploaded_by');
  });

  it('paginates with a stable order', async () => {
    await create();
    await create();
    const page1 = await api(`${BASE}?page=1&limit=1`);
    const page2 = await api(`${BASE}?page=2&limit=1`);
    expect(idsOf(page1)).toHaveLength(1);
    expect(idsOf(page1)[0]).not.toBe(idsOf(page2)[0]);
  });

  it('filters by category and resolves the translation by Accept-Language', async () => {
    const category = await newCategory();
    const title = uid();
    const mine = await create({ category_id: category, translations: [ar(`${title}-ar`), en(`${title}-en`)] });
    await create();

    const res = await api(`${BASE}?category_id=${category}`, { lang: 'en' });
    expect(idsOf(res)).toEqual([mine.id]);
    expect(res.body.data.items[0].translation).toMatchObject({ lang: 'en', title: `${title}-en` });
  });

  it('searches titles and abstracts, case-insensitively', async () => {
    const needle = uid();
    const byTitle = await create({ translations: [ar(`Title ${needle.toUpperCase()}`)] });
    const byAbstract = await create({ translations: [ar(uid(), { abstract: `About ${needle}` })] });
    await create();

    expect(idsOf(await api(`${BASE}?search=${needle}`)).sort()).toEqual([byTitle.id, byAbstract.id].sort());
  });

  it('rejects bad query parameters', async () => {
    expect(errorsOf(await api(`${BASE}?category_id=nope`))).toEqual(['category_id must be a UUID']);
    expect(errorsOf(await api(`${BASE}?search=a`))).toEqual(['search must be longer than or equal to 2 characters']);
    expect(errorsOf(await api(`${BASE}?limit=101`))).toEqual(['limit must not be greater than 100']);
    expect(errorsOf(await api(`${BASE}?extra=1`))).toEqual(['property extra should not exist']);
  });
});

describe('GET /academic-papers/admin', () => {
  it('includes drafts and needs academic-papers:read', async () => {
    const live = await create();
    const draft = await create({ is_published: false });

    const res = await admin('/admin?limit=100');
    expectSuccess(res);
    expect(idsOf(res)).toEqual(expect.arrayContaining([live.id, draft.id]));
    expectError(await api(`${BASE}/admin`), 401, 'UNAUTHORIZED');
    expectError(await api(`${BASE}/admin`, { token: await tokenWith(['academic-papers:create']) }), 403, 'FORBIDDEN');
  });

  it('GET /admin/:id returns a draft with every column, 404s a trashed or missing paper', async () => {
    const draft = await create({ is_published: false });
    const res = await admin(`/admin/${draft.id}`);
    expectSuccess(res);
    expect(res.body.data).toMatchObject({ id: draft.id, uploaded_by: expect.any(String) });

    expectSuccess(await del(draft.id));
    expectError(await admin(`/admin/${draft.id}`), 404, 'NOT_FOUND', 'Paper not found');
    expectError(await admin(`/admin/${MISSING}`), 404, 'NOT_FOUND', 'Paper not found');
    expectError(await api(`${BASE}/admin/${MISSING}`), 401, 'UNAUTHORIZED');
  });
});

describe('GET /academic-papers/:id', () => {
  it('serves a published paper with the abstract but without the uploader, and caches it', async () => {
    const paper = await create({ translations: [ar(uid(), { abstract: 'full abstract' })] });
    const res = await api(`${BASE}/${paper.id}`);
    expectSuccess(res);
    expect(res.body.message).toBe('Paper fetched');
    expect(res.body.data).not.toHaveProperty('uploaded_by');
    expect(res.body.data.academic_paper_translations[0]).toMatchObject({ abstract: 'full abstract' });
    expect(res.body.data.translation).toMatchObject({ abstract: 'full abstract' });
    expect(res.headers.get('cache-control')).toBe('public, max-age=60, s-maxage=300');
  });

  it('404s a draft, a trashed paper and a missing id; 400s a malformed id', async () => {
    const draft = await create({ is_published: false });
    expectError(await api(`${BASE}/${draft.id}`), 404, 'NOT_FOUND', 'Paper not found');
    expectError(await api(`${BASE}/${MISSING}`), 404, 'NOT_FOUND', 'Paper not found');
    expectError(await api(`${BASE}/not-a-uuid`), 400, 'INVALID_IDENTIFIER', 'Invalid identifier format');

    const live = await create();
    expectSuccess(await del(live.id));
    expectError(await api(`${BASE}/${live.id}`), 404, 'NOT_FOUND', 'Paper not found');
  });
});

describe('POST /academic-papers/:id/view', () => {
  it('counts a view on a published paper and answers 201', async () => {
    const paper = await create();
    const res = await api(`${BASE}/${paper.id}/view`, { method: 'POST' });
    expectSuccess(res, 201);
    expect(res.body).toMatchObject({ message: 'View tracked', data: null });
    await api(`${BASE}/${paper.id}/view`, { method: 'POST' });
    expect((await admin(`/admin/${paper.id}`)).body.data.views).toBe(2);
  });

  it('404s a draft and a missing id', async () => {
    const draft = await create({ is_published: false });
    expectError(await api(`${BASE}/${draft.id}/view`, { method: 'POST' }), 404, 'NOT_FOUND', 'Paper not found');
    expectError(await api(`${BASE}/${MISSING}/view`, { method: 'POST' }), 404, 'NOT_FOUND', 'Paper not found');
    expect((await admin(`/admin/${draft.id}`)).body.data.views).toBe(0);
  });

  it('is limited to 30 a minute per IP', async () => {
    const ip = `10.99.${(Math.random() * 256) | 0}.${(Math.random() * 256) | 0}`;
    let last = 0;
    for (let i = 0; i < 31; i++) last = (await api(`${BASE}/${MISSING}/view`, { method: 'POST', ip })).status;
    expect(last).toBe(429);
  });
});

describe('PATCH /academic-papers/:id', () => {
  it('updates fields, upserts translations by language and keeps the rest', async () => {
    const paper = await create({ published_year: '2000', pdf_url: 'https://example.test/keep.pdf' });
    const title = uid();

    const res = await patch(paper.id, {
      published_year: '2024',
      document_languages: ['fa'],
      translations: [en(title, { abstract: 'new', authors: ['Z'], is_default: false }), ar(`${title}-ar`)],
    });
    expectSuccess(res);
    expect(res.body.message).toBe('Paper updated');
    expect(res.body.data).toMatchObject({ published_year: '2024', document_languages: ['fa'], pdf_url: 'https://example.test/keep.pdf' });
    expect(res.body.data.academic_paper_translations).toHaveLength(2);
    expect(res.body.data.academic_paper_translations.find((t: { lang: string }) => t.lang === 'en')).toMatchObject({ title, abstract: 'new', authors: ['Z'], is_default: false });
  });

  it('moves the paper to another live category, and clears the pdf with null', async () => {
    const paper = await create({ pdf_url: 'https://example.test/gone.pdf' });
    const other = await newCategory();
    const res = await patch(paper.id, { category_id: other, pdf_url: null });
    expectSuccess(res);
    expect(res.body.data).toMatchObject({ category_id: other, pdf_url: null });
    expect(res.body.data.academic_paper_categories.id).toBe(other);
  });

  it('refuses a translation set that ends without exactly one default, and rolls everything back', async () => {
    const paper = await create({ published_year: '1999' });
    const res = await patch(paper.id, { published_year: '2077', translations: [en(uid(), { is_default: true })] });
    expectError(res, 400, 'BAD_REQUEST', 'Exactly one translation must have is_default: true');
    expect((await admin(`/admin/${paper.id}`)).body.data).toMatchObject({ published_year: '1999' });
  });

  it('404s an unknown or trashed category, a missing paper and a trashed paper', async () => {
    const paper = await create();
    expectError(await patch(paper.id, { category_id: MISSING }), 404, 'NOT_FOUND', 'Category not found');

    const trashed = await newCategory();
    expectSuccess(await api(`/api/v1/academic-paper-categories/${trashed}`, { method: 'DELETE', token: await adminToken() }));
    expectError(await patch(paper.id, { category_id: trashed }), 404, 'NOT_FOUND', 'Category not found');

    expectError(await patch(MISSING, { published_year: '1' }), 404, 'NOT_FOUND', 'Paper not found');
    expectSuccess(await del(paper.id));
    expectError(await patch(paper.id, { published_year: '1' }), 404, 'NOT_FOUND', 'Paper not found');
  });

  it('rejects bad bodies and needs academic-papers:update', async () => {
    const paper = await create();
    expect(errorsOf(await patch(paper.id, { category_id: 'nope' }))).toEqual(['category_id must be a UUID']);
    expect(errorsOf(await patch(paper.id, { pdf_url: 'nope' }))).toEqual(['pdf_url must be a URL address']);
    expect(errorsOf(await patch(paper.id, { translations: [{ lang: 'ar', title: '' }] }))).toEqual(['translations.0.title must be longer than or equal to 1 characters']);
    expect(errorsOf(await patch(paper.id, { extra: 1 }))).toEqual(['property extra should not exist']);
    expectError(await api(`${BASE}/${paper.id}`, { method: 'PATCH', body: {} }), 401, 'UNAUTHORIZED');
    expectError(await api(`${BASE}/${paper.id}`, { method: 'PATCH', token: await tokenWith(['academic-papers:read']), body: {} }), 403, 'FORBIDDEN');
  });
});

describe('PATCH /academic-papers/:id/publish', () => {
  it('publishes and unpublishes, and answers "already" for a no-op', async () => {
    const paper = await create({ is_published: false });

    const on = await publish(paper.id, { is_published: true });
    expectSuccess(on);
    expect(on.body).toMatchObject({ message: 'Paper published', data: { id: paper.id, is_published: true } });
    expectSuccess(await api(`${BASE}/${paper.id}`));

    const again = await publish(paper.id, { is_published: true });
    expectSuccess(again);
    expect(again.body.message).toBe('Paper already in requested state');

    const off = await publish(paper.id, { is_published: false });
    expect(off.body).toMatchObject({ message: 'Paper unpublished', data: { is_published: false } });
    expectError(await api(`${BASE}/${paper.id}`), 404, 'NOT_FOUND');
  });

  it('404s a missing or trashed paper; validates the body; needs academic-papers:update', async () => {
    const paper = await create();
    expectError(await publish(MISSING, { is_published: true }), 404, 'NOT_FOUND', 'Paper not found');
    expect(errorsOf(await publish(paper.id, { is_published: 'yes' }))).toEqual(['is_published must be a boolean value']);
    expect(errorsOf(await publish(paper.id, {}))).toEqual(['is_published must be a boolean value']);
    expectError(await api(`${BASE}/${paper.id}/publish`, { method: 'PATCH', token: await tokenWith(['academic-papers:read']), body: { is_published: true } }), 403, 'FORBIDDEN');
    expectSuccess(await del(paper.id));
    expectError(await publish(paper.id, { is_published: true }), 404, 'NOT_FOUND', 'Paper not found');
  });
});

describe('DELETE, trash and restore', () => {
  it('soft-deletes, lists the paper in the trash with the uploader, and restores it', async () => {
    const paper = await create();

    const res = await del(paper.id);
    expectSuccess(res);
    expect(res.body).toMatchObject({ message: 'Paper deleted', data: null });
    expectError(await del(paper.id), 404, 'NOT_FOUND', 'Paper not found');

    const trash = await admin('/trash?limit=100');
    expectSuccess(trash);
    expect(trash.body.message).toBe('Trash fetched');
    const row = trash.body.data.items.find((i: { id: string }) => i.id === paper.id);
    expect(row).toMatchObject({ deleted_at: expect.stringMatching(ISO_DATE), uploaded_by: expect.any(String) });
    expect(row.academic_paper_translations[0]).not.toHaveProperty('abstract');

    const back = await restore(paper.id);
    expectSuccess(back);
    expect(back.body).toMatchObject({ message: 'Paper restored', data: null });
    expectSuccess(await api(`${BASE}/${paper.id}`));
    expectError(await restore(paper.id), 404, 'NOT_FOUND', 'Deleted paper not found');
  });

  it('refuses to restore a paper whose category is in the trash', async () => {
    const category = await newCategory();
    const paper = await create({ category_id: category });
    await del(paper.id);
    // The category only blocks deletion while it has LIVE papers, so it can go to the trash now.
    expectSuccess(await api(`/api/v1/academic-paper-categories/${category}`, { method: 'DELETE', token: await adminToken() }));

    expectError(await restore(paper.id), 409, 'CONFLICT', 'Cannot restore: the parent category was deleted — restore the category first');

    expectSuccess(await api(`/api/v1/academic-paper-categories/${category}/restore`, { method: 'POST', token: await adminToken() }));
    expectSuccess(await restore(paper.id));
  });

  it('401s and 403s on the destructive routes', async () => {
    const paper = await create();
    const weak = await tokenWith(['academic-papers:read']);
    for (const [method, path] of [
      ['GET', '/trash'],
      ['DELETE', `/${paper.id}`],
      ['POST', `/${paper.id}/restore`],
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
