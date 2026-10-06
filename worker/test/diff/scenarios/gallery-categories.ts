import type { Scenario } from '../scenario';

const BASE = '/api/v1/gallery-categories';

export default [
  {
    name: 'lifecycle',
    steps: [
      {
        method: 'POST',
        path: BASE,
        body: { translations: [{ lang: 'ar', title: 'تصنيف الفرق', slug: 'diff-cat' }, { lang: 'en', title: 'Diff category', slug: 'diff-cat' }] },
        capture: { cat: 'data.id' },
      },
      { method: 'GET', path: `${BASE}/{{cat}}`, auth: 'anon', lang: 'en' },
      { method: 'PATCH', path: `${BASE}/{{cat}}`, body: { translations: [{ lang: 'en', title: 'Renamed', slug: 'diff-cat-renamed', description: 'x' }] } },
      // Slug clash and duplicate language: the 409s the CMS shows.
      { method: 'POST', path: BASE, body: { translations: [{ lang: 'ar', title: 'Clash', slug: 'diff-cat' }] } },
      { method: 'POST', path: BASE, body: { translations: [{ lang: 'ar', title: 'A', slug: 'diff-a' }, { lang: 'ar', title: 'B', slug: 'diff-b' }] } },
      { method: 'DELETE', path: `${BASE}/{{cat}}` },
      { method: 'GET', path: `${BASE}/{{cat}}`, auth: 'anon' },
      { method: 'GET', path: `${BASE}/trash?limit=100` },
      { method: 'POST', path: `${BASE}/{{cat}}/restore` },
      { method: 'GET', path: `${BASE}/{{cat}}`, auth: 'anon' },
      { method: 'POST', path: `${BASE}/{{cat}}/restore` },
    ],
  },
] satisfies Scenario[];
