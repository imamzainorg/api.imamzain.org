import type { Scenario } from '../scenario';

const BASE = '/api/v1/stores';

export default [
  {
    name: 'lifecycle',
    steps: [
      {
        method: 'POST',
        path: BASE,
        body: {
          translations: [{ lang: 'ar', city_name: 'مدينة الفرق' }, { lang: 'en', city_name: 'Diff city' }],
          display_order: 5,
          locations: [{ phone: '1', display_order: 1, gps_link: 'https://maps.app.goo.gl/abc', translations: [{ lang: 'ar', name: 'مكتبة', address: 'شارع' }] }],
        },
        capture: { store: 'data.id', loc: 'data.store_locations.0.id' },
      },
      { method: 'GET', path: `${BASE}/{{store}}`, auth: 'anon', lang: 'en' },
      { method: 'PATCH', path: `${BASE}/{{store}}`, body: { display_order: 9, translations: [{ lang: 'en', city_name: 'Renamed' }] } },
      { method: 'POST', path: `${BASE}/{{store}}/locations`, body: { display_order: 2, translations: [{ lang: 'en', name: 'Second', address: 'Street' }] } },
      { method: 'PATCH', path: `${BASE}/{{store}}/locations/{{loc}}`, body: { phone: '2', translations: [{ lang: 'en', name: 'First', address: 'Road' }] } },
      { method: 'DELETE', path: `${BASE}/{{store}}/locations/{{loc}}` },
      { method: 'DELETE', path: `${BASE}/{{store}}/locations/{{loc}}` },
      { method: 'POST', path: BASE, body: { translations: [{ lang: 'ar', city_name: 'x' }], locations: [{ gps_link: 'nope', translations: [] }] } },
      { method: 'DELETE', path: `${BASE}/{{store}}` },
      { method: 'GET', path: `${BASE}/{{store}}`, auth: 'anon' },
      { method: 'GET', path: `${BASE}/trash?limit=100` },
      { method: 'POST', path: `${BASE}/{{store}}/restore` },
      { method: 'GET', path: `${BASE}/{{store}}`, auth: 'anon' },
      { method: 'POST', path: `${BASE}/{{store}}/restore` },
    ],
  },
] satisfies Scenario[];
