import type { Scenario } from '../scenario';

const BASE = '/api/v1/books';
const CATEGORIES = '/api/v1/book-categories';
const MISSING = '00000000-0000-4000-8000-000000000000';
const ar = (title: string, extra: Record<string, unknown> = {}) => ({ lang: 'ar', title, is_default: true, ...extra });
const en = (title: string) => ({ lang: 'en', title });
const category = (slug: string) => ({ translations: [{ lang: 'ar', title: slug, slug }] });

export default [
  {
    name: 'lifecycle',
    steps: [
      { method: 'POST', path: CATEGORIES, body: category('diff-books-a'), capture: { cat_a: 'data.id' } },
      { method: 'POST', path: CATEGORIES, body: category('diff-books-b'), capture: { cat_b: 'data.id' } },
      // The cover is borrowed from an existing book: media is not ported yet, so the scenario can't create one.
      { method: 'GET', path: `${BASE}/admin?limit=1`, capture: { cover: 'data.items.0.cover_image_id' } },
      {
        method: 'POST',
        path: BASE,
        body: {
          category_id: '{{cat_a}}',
          cover_image_id: '{{cover}}',
          slug: 'diff-books-series',
          isbn: 'diff-isbn-1',
          pages: 100,
          publish_year: '2020',
          pdf_url: 'https://example.test/diff/a.pdf',
          document_languages: ['ar'],
          is_publication: true,
          translations: [ar('Diff ar', { author: 'A', publisher: 'P', description: 'Diff description', series: 'S' }), en('Diff en')],
        },
        capture: { b: 'data.id' },
      },
      { method: 'POST', path: BASE, body: { category_id: MISSING, cover_image_id: '{{cover}}', translations: [ar('No category')] } },
      { method: 'POST', path: BASE, body: { category_id: '{{cat_a}}', cover_image_id: MISSING, translations: [ar('No cover')] } },
      { method: 'POST', path: BASE, body: { category_id: '{{cat_a}}', cover_image_id: '{{cover}}', translations: [en('No default')] } },
      { method: 'POST', path: BASE, body: { category_id: '{{cat_a}}', cover_image_id: '{{cover}}', isbn: 'diff-isbn-1', translations: [ar('Dup isbn')] } },
      { method: 'POST', path: BASE, body: { category_id: '{{cat_a}}', cover_image_id: '{{cover}}', slug: 'diff-books-series', translations: [ar('Dup slug')] } },
      { method: 'POST', path: BASE, body: { category_id: '{{cat_a}}', cover_image_id: '{{cover}}', part_number: 3, parts: 2, translations: [ar('Bad parts')] } },
      { method: 'POST', path: BASE, body: { category_id: 'nope', cover_image_id: 'nope', pdf_url: 'nope', slug: 'Bad Slug', translations: [] } },
      // Parts of the series: numbered, one draft by inheritance, then the one-level and numbering rules.
      {
        method: 'POST',
        path: BASE,
        body: { category_id: '{{cat_a}}', cover_image_id: '{{cover}}', parent_id: '{{b}}', part_number: 1, parts: 2, translations: [ar('Diff part 1')] },
        capture: { p1: 'data.id' },
      },
      {
        method: 'POST',
        path: BASE,
        body: { category_id: '{{cat_a}}', cover_image_id: '{{cover}}', parent_id: '{{b}}', part_number: 2, parts: 2, is_published: false, translations: [ar('Diff part 2')] },
        capture: { p2: 'data.id' },
      },
      { method: 'POST', path: BASE, body: { category_id: '{{cat_a}}', cover_image_id: '{{cover}}', parent_id: '{{b}}', part_number: 1, parts: 2, translations: [ar('Dup number')] } },
      { method: 'POST', path: BASE, body: { category_id: '{{cat_a}}', cover_image_id: '{{cover}}', parent_id: '{{p1}}', translations: [ar('Grandchild')] } },
      { method: 'POST', path: BASE, body: { category_id: '{{cat_a}}', cover_image_id: '{{cover}}', parent_id: MISSING, translations: [ar('Orphan')] } },
      { method: 'GET', path: `${BASE}/{{b}}`, auth: 'anon', lang: 'en' },
      { method: 'GET', path: `${BASE}/admin/{{b}}`, lang: 'en' },
      { method: 'GET', path: `${BASE}/{{p1}}`, auth: 'anon' },
      { method: 'GET', path: `${BASE}/{{p2}}`, auth: 'anon' },
      { method: 'GET', path: `${BASE}/by-slug/diff-books-series`, auth: 'anon' },
      { method: 'GET', path: `${BASE}?category_id={{cat_a}}&is_publication=true`, auth: 'anon' },
      { method: 'GET', path: `${BASE}/admin?category_id={{cat_a}}` },
      { method: 'POST', path: `${BASE}/{{p1}}/view`, auth: 'anon' },
      { method: 'PATCH', path: `${BASE}/{{b}}`, body: { category_id: '{{cat_b}}', pages: 200, translations: [en('Diff en 2'), ar('Diff ar 2')] } },
      { method: 'PATCH', path: `${BASE}/{{b}}`, body: { slug: 'diff-books-renamed' } },
      { method: 'PATCH', path: `${BASE}/{{b}}`, body: { translations: [{ ...en('Second default'), is_default: true }] } },
      { method: 'PATCH', path: `${BASE}/{{b}}`, body: { category_id: MISSING } },
      { method: 'PATCH', path: `${BASE}/{{b}}`, body: { cover_image_id: MISSING } },
      { method: 'PATCH', path: `${BASE}/{{b}}`, body: { parent_id: '{{p1}}' } },
      { method: 'PATCH', path: `${BASE}/{{b}}`, body: { parent_id: '{{b}}' } },
      { method: 'PATCH', path: `${BASE}/{{p1}}`, body: { part_number: 2 } },
      { method: 'PATCH', path: `${BASE}/{{p1}}`, body: { part_number: null } },
      { method: 'PATCH', path: `${BASE}/{{p1}}`, body: { pdf_url: null } },
      { method: 'DELETE', path: `${BASE}/{{b}}` },
      { method: 'PATCH', path: `${BASE}/{{b}}/publish`, body: { is_published: false } },
      { method: 'PATCH', path: `${BASE}/{{b}}/publish`, body: { is_published: false } },
      { method: 'PATCH', path: `${BASE}/{{b}}/publish`, body: { is_published: 'yes' } },
      { method: 'GET', path: `${BASE}/{{p1}}`, auth: 'anon' },
      { method: 'POST', path: `${BASE}/{{p1}}/view`, auth: 'anon' },
      { method: 'PATCH', path: `${BASE}/{{b}}`, body: { slug: 'diff-books-renamed-draft' } },
      { method: 'PATCH', path: `${BASE}/{{b}}/publish`, body: { is_published: true } },
      { method: 'DELETE', path: `${BASE}/{{p1}}` },
      { method: 'DELETE', path: `${BASE}/{{p2}}` },
      { method: 'DELETE', path: `${BASE}/{{b}}` },
      { method: 'DELETE', path: `${BASE}/{{b}}` },
      { method: 'GET', path: `${BASE}/trash?limit=100` },
      { method: 'POST', path: `${BASE}/{{p1}}/restore` },
      { method: 'POST', path: `${BASE}/{{b}}/restore` },
      { method: 'POST', path: `${BASE}/{{p1}}/restore` },
      { method: 'POST', path: `${BASE}/{{p2}}/restore` },
      { method: 'POST', path: `${BASE}/{{b}}/restore` },
      { method: 'DELETE', path: `${CATEGORIES}/{{cat_a}}` },
      { method: 'GET', path: `${BASE}/{{b}}`, auth: 'anon' },
    ],
  },
] satisfies Scenario[];
