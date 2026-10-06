import type { Scenario } from '../scenario';

const BASE = '/api/v1/speakers';

export default [
  {
    name: 'lifecycle',
    steps: [
      {
        method: 'POST',
        path: BASE,
        body: { translations: [{ lang: 'ar', name: 'متحدث الفرق', is_default: true }, { lang: 'en', name: 'Diff speaker' }] },
        capture: { spk: 'data.id' },
      },
      { method: 'GET', path: `${BASE}/{{spk}}`, auth: 'anon', lang: 'en' },
      { method: 'GET', path: `${BASE}?search=diff`, auth: 'anon' },
      { method: 'PATCH', path: `${BASE}/{{spk}}`, body: { translations: [{ lang: 'en', name: 'Renamed' }] } },
      // No default / duplicate language: the 400 and 409 the CMS shows.
      { method: 'POST', path: BASE, body: { translations: [{ lang: 'ar', name: 'A' }] } },
      { method: 'POST', path: BASE, body: { translations: [{ lang: 'ar', name: 'A', is_default: true }, { lang: 'ar', name: 'B' }] } },
      { method: 'PATCH', path: `${BASE}/{{spk}}`, body: { translations: [{ lang: 'en', name: 'Two defaults', is_default: true }] } },
      { method: 'DELETE', path: `${BASE}/{{spk}}` },
      { method: 'GET', path: `${BASE}/{{spk}}`, auth: 'anon' },
      { method: 'GET', path: `${BASE}/trash?limit=100` },
      { method: 'POST', path: `${BASE}/{{spk}}/restore` },
      { method: 'GET', path: `${BASE}/{{spk}}`, auth: 'anon' },
      { method: 'POST', path: `${BASE}/{{spk}}/restore` },
    ],
  },
] satisfies Scenario[];
