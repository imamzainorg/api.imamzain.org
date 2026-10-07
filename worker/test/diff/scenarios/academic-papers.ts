import type { Scenario } from '../scenario';

const BASE = '/api/v1/academic-papers';
const CATEGORIES = '/api/v1/academic-paper-categories';
const MISSING = '00000000-0000-4000-8000-000000000000';
const ar = (title: string, extra: Record<string, unknown> = {}) => ({ lang: 'ar', title, is_default: true, ...extra });
const en = (title: string) => ({ lang: 'en', title });
const category = (slug: string) => ({ translations: [{ lang: 'ar', title: slug, slug }] });

export default [
  {
    name: 'lifecycle',
    steps: [
      { method: 'POST', path: CATEGORIES, body: category('diff-papers-a'), capture: { cat_a: 'data.id' } },
      { method: 'POST', path: CATEGORIES, body: category('diff-papers-b'), capture: { cat_b: 'data.id' } },
      {
        method: 'POST',
        path: BASE,
        body: {
          category_id: '{{cat_a}}',
          published_year: '2020',
          pdf_url: 'https://example.test/diff/a.pdf',
          document_languages: ['ar'],
          translations: [ar('Diff ar', { abstract: 'Diff abstract', authors: ['A'], keywords: ['k'], publication_venue: 'V', page_count: 3 }), en('Diff en')],
        },
        capture: { p: 'data.id' },
      },
      { method: 'POST', path: BASE, body: { category_id: MISSING, translations: [ar('No category')] } },
      { method: 'POST', path: BASE, body: { category_id: '{{cat_a}}', translations: [en('No default')] } },
      { method: 'POST', path: BASE, body: { category_id: '{{cat_a}}', translations: [ar('Dup lang'), ar('Dup lang 2')] } },
      { method: 'POST', path: BASE, body: { category_id: 'nope', pdf_url: 'nope', translations: [] } },
      { method: 'PATCH', path: `${BASE}/{{p}}`, body: { category_id: '{{cat_b}}', published_year: '2021', translations: [en('Diff en 2'), ar('Diff ar 2')] } },
      { method: 'PATCH', path: `${BASE}/{{p}}`, body: { translations: [{ ...en('Second default'), is_default: true }] } },
      { method: 'PATCH', path: `${BASE}/{{p}}`, body: { category_id: MISSING } },
      { method: 'PATCH', path: `${BASE}/{{p}}`, body: { pdf_url: null } },
      { method: 'GET', path: `${BASE}/{{p}}`, auth: 'anon', lang: 'en' },
      { method: 'GET', path: `${BASE}?search=abstract&category_id={{cat_b}}`, auth: 'anon' },
      { method: 'POST', path: `${BASE}/{{p}}/view`, auth: 'anon' },
      { method: 'PATCH', path: `${BASE}/{{p}}/publish`, body: { is_published: false } },
      { method: 'PATCH', path: `${BASE}/{{p}}/publish`, body: { is_published: false } },
      { method: 'PATCH', path: `${BASE}/{{p}}/publish`, body: { is_published: 'yes' } },
      { method: 'GET', path: `${BASE}/{{p}}`, auth: 'anon' },
      { method: 'POST', path: `${BASE}/{{p}}/view`, auth: 'anon' },
      { method: 'GET', path: `${BASE}/admin/{{p}}` },
      { method: 'PATCH', path: `${BASE}/{{p}}/publish`, body: { is_published: true } },
      { method: 'DELETE', path: `${BASE}/{{p}}` },
      { method: 'DELETE', path: `${BASE}/{{p}}` },
      { method: 'GET', path: `${BASE}/trash?limit=100` },
      { method: 'DELETE', path: `${CATEGORIES}/{{cat_b}}` },
      { method: 'POST', path: `${BASE}/{{p}}/restore` },
      { method: 'POST', path: `${CATEGORIES}/{{cat_b}}/restore` },
      { method: 'POST', path: `${BASE}/{{p}}/restore` },
      { method: 'POST', path: `${BASE}/{{p}}/restore` },
      { method: 'GET', path: `${BASE}/{{p}}`, auth: 'anon' },
    ],
  },
] satisfies Scenario[];
