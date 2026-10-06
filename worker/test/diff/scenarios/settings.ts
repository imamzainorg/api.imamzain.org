import type { Scenario } from '../scenario';

const BASE = '/api/v1/settings';

export default [
  {
    name: 'lifecycle',
    steps: [
      { method: 'PUT', path: `${BASE}/diff_number`, body: { value: ' 42.5 ', type: 'number', description: 'Diff', is_public: true } },
      { method: 'PUT', path: `${BASE}/diff_number`, body: { value: '7' } },
      { method: 'PUT', path: `${BASE}/diff_number`, body: { value: 'x', type: 'string' } },
      { method: 'PUT', path: `${BASE}/diff_number`, body: { value: 'abc' } },
      { method: 'PUT', path: `${BASE}/diff_json`, body: { value: '{"a":[1]}', type: 'json' } },
      { method: 'PUT', path: `${BASE}/diff_json`, body: { value: '{nope' } },
      { method: 'PUT', path: `${BASE}/diff_bool`, body: { value: 'yes', type: 'boolean' } },
      { method: 'PUT', path: `${BASE}/diff_bool`, body: { value: 'x', type: 'date' } },
      { method: 'GET', path: `${BASE}/diff_number` },
      { method: 'GET', path: `${BASE}/public`, auth: 'anon' },
      { method: 'GET', path: BASE },
      { method: 'DELETE', path: `${BASE}/diff_number` },
      { method: 'DELETE', path: `${BASE}/diff_number` },
      { method: 'GET', path: `${BASE}/diff_number` },
      { method: 'GET', path: `${BASE}/public`, auth: 'anon' },
    ],
  },
] satisfies Scenario[];
