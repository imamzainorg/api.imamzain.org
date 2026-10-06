import type { Scenario } from '../scenario';

const BASE = '/api/v1/gallery';
const MISSING = '00000000-0000-4000-8000-000000000000';
const ar = (title: string, extra: Record<string, unknown> = {}) => ({ lang: 'ar', title, description: 'وصف', ...extra });
const en = (title: string) => ({ lang: 'en', title });

// The images need media rows: the scenario borrows two ids from the corpus through `media_a` / `media_b`.
export default [
  {
    name: 'lifecycle',
    steps: [
      { method: 'GET', path: '/api/v1/gallery/admin?limit=100', capture: { media_a: 'data.items.0.media_id' } },
      // The first gallery image's media is taken, so a create for it conflicts; the unused ones are found in the trash/list.
      { method: 'POST', path: BASE, body: { media_id: '{{media_a}}', translations: [ar('Dup')] } },
      { method: 'POST', path: BASE, body: { media_id: MISSING, translations: [ar('A')] } },
      { method: 'POST', path: BASE, body: { media_id: 'nope', translations: [] } },
      { method: 'POST', path: BASE, body: { media_id: '{{media_a}}', tags: ['x'.repeat(201)], taken_at: 'x', translations: [ar('A'), ar('B')] } },
      { method: 'PATCH', path: `${BASE}/{{media_a}}`, body: { author: 'Diff Author', tags: ['diff-a', 'diff-b'], locations: ['Karbala'], taken_at: '2024-01-02', translations: [en('Diff en'), ar('Diff ar')] } },
      { method: 'PATCH', path: `${BASE}/{{media_a}}`, body: { category_id: MISSING } },
      { method: 'PATCH', path: `${BASE}/{{media_a}}`, body: { translations: [ar('X', { og_image_id: MISSING })] } },
      { method: 'PATCH', path: `${BASE}/{{media_a}}`, body: { media_id: MISSING } },
      { method: 'GET', path: `${BASE}?tags=diff-a&tags=diff-b`, auth: 'anon' },
      { method: 'GET', path: `${BASE}?locations=Karbala&limit=5`, auth: 'anon', lang: 'en' },
      { method: 'GET', path: `${BASE}/{{media_a}}`, auth: 'anon', lang: 'en' },
      { method: 'POST', path: `${BASE}/{{media_a}}/view`, auth: 'anon' },
      { method: 'GET', path: `${BASE}/{{media_a}}`, auth: 'anon' },
      { method: 'PATCH', path: `${BASE}/{{media_a}}/publish`, body: { is_published: false } },
      { method: 'PATCH', path: `${BASE}/{{media_a}}/publish`, body: { is_published: false } },
      { method: 'PATCH', path: `${BASE}/{{media_a}}/publish`, body: { is_published: 'yes' } },
      { method: 'GET', path: `${BASE}/{{media_a}}`, auth: 'anon' },
      { method: 'POST', path: `${BASE}/{{media_a}}/view`, auth: 'anon' },
      { method: 'GET', path: `${BASE}/admin/{{media_a}}` },
      { method: 'PATCH', path: `${BASE}/{{media_a}}/publish`, body: { is_published: true } },
      { method: 'DELETE', path: `${BASE}/{{media_a}}` },
      { method: 'DELETE', path: `${BASE}/{{media_a}}` },
      { method: 'POST', path: BASE, body: { media_id: '{{media_a}}', translations: [ar('Again')] } },
      { method: 'GET', path: `${BASE}/trash?limit=100` },
      { method: 'POST', path: `${BASE}/{{media_a}}/restore` },
      { method: 'POST', path: `${BASE}/{{media_a}}/restore` },
      { method: 'GET', path: `${BASE}/{{media_a}}`, auth: 'anon' },
    ],
  },
] satisfies Scenario[];
