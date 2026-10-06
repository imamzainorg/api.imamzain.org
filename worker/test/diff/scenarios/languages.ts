import type { Scenario } from '../scenario';

const BASE = '/api/v1/languages';

export default [
  {
    name: 'lifecycle',
    steps: [
      { method: 'POST', path: BASE, body: { code: ' QJ ', name: 'Diff', native_name: 'فرق' } },
      { method: 'POST', path: BASE, body: { code: 'qj', name: 'Clash', native_name: 'Clash' } },
      { method: 'GET', path: `${BASE}/all` },
      { method: 'PATCH', path: `${BASE}/qj`, body: { name: 'Renamed', is_active: false } },
      { method: 'GET', path: BASE, auth: 'anon' },
      { method: 'POST', path: BASE, body: { code: 'q1', name: 'Bad', native_name: 'Bad' } },
      { method: 'DELETE', path: `${BASE}/qj` },
      { method: 'DELETE', path: `${BASE}/qj` },
      { method: 'PATCH', path: `${BASE}/qj`, body: { name: 'Gone' } },
      { method: 'POST', path: BASE, body: { code: 'qj', name: 'Revived', native_name: 'Revived', is_active: false } },
      { method: 'GET', path: `${BASE}/all` },
    ],
  },
] satisfies Scenario[];
