import type { Scenario } from '../scenario';

const BASE = '/api/v1/users';

export default [
  {
    name: 'lifecycle',
    steps: [
      { method: 'POST', path: BASE, body: { username: ' diff-user ', password: 'diff-password-1' }, capture: { user: 'data.id' } },
      { method: 'POST', path: BASE, body: { username: 'DIFF-USER', password: 'diff-password-1' } },
      { method: 'PATCH', path: `${BASE}/{{user}}`, body: { username: 'diff-user-renamed' } },
      { method: 'POST', path: '/api/v1/roles', body: { name: 'diff-user-role', translations: [{ lang: 'ar', title: 'دور' }] }, capture: { role: 'data.id' } },
      { method: 'POST', path: `${BASE}/{{user}}/roles`, body: { role_id: '{{role}}' } },
      { method: 'POST', path: `${BASE}/{{user}}/roles`, body: { role_id: '{{role}}' } },
      { method: 'GET', path: `${BASE}/{{user}}` },
      { method: 'DELETE', path: '/api/v1/roles/{{role}}' },
      { method: 'DELETE', path: `${BASE}/{{user}}/roles/{{role}}` },
      { method: 'DELETE', path: `${BASE}/{{user}}/roles/{{role}}` },
      { method: 'POST', path: `${BASE}/{{user}}/reset-password`, body: { new_password: 'reset-password-1' } },
      { method: 'DELETE', path: `${BASE}/{{user}}` },
      { method: 'GET', path: `${BASE}/{{user}}` },
      { method: 'GET', path: `${BASE}/trash?limit=100` },
      { method: 'POST', path: BASE, body: { username: 'diff-user-renamed', password: 'diff-password-1' }, capture: { taker: 'data.id' } },
      { method: 'POST', path: `${BASE}/{{user}}/restore` },
      { method: 'DELETE', path: `${BASE}/{{taker}}` },
      { method: 'POST', path: `${BASE}/{{user}}/restore` },
      { method: 'POST', path: `${BASE}/{{user}}/restore` },
      { method: 'GET', path: `${BASE}?limit=100` },
    ],
  },
] satisfies Scenario[];
