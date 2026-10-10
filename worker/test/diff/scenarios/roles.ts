import type { Scenario } from '../scenario';

const BASE = '/api/v1/roles';

export default [
  {
    name: 'lifecycle',
    steps: [
      { method: 'POST', path: BASE, body: { name: ' diff-role ', translations: [{ lang: 'ar', title: 'دور' }] }, capture: { role: 'data.id' } },
      { method: 'GET', path: `${BASE}/{{role}}`, lang: 'en' },
      // Same name in another case; same language twice.
      { method: 'POST', path: BASE, body: { name: 'DIFF-ROLE', translations: [{ lang: 'ar', title: 'x' }] } },
      { method: 'POST', path: BASE, body: { name: 'diff-role-2', translations: [{ lang: 'ar', title: 'x' }, { lang: 'ar', title: 'y' }] } },
      { method: 'PATCH', path: `${BASE}/{{role}}`, body: { name: 'Diff-Role', translations: [{ lang: 'ar', title: 'دور جديد' }, { lang: 'en', title: 'Role' }] } },
      { method: 'GET', path: `${BASE}/permissions?limit=1`, capture: { perm: 'data.items.0.id' } },
      { method: 'POST', path: `${BASE}/{{role}}/permissions`, body: { permissionId: '{{perm}}' } },
      { method: 'POST', path: `${BASE}/{{role}}/permissions`, body: { permissionId: '{{perm}}' } },
      { method: 'GET', path: `${BASE}?limit=100` },
      { method: 'DELETE', path: `${BASE}/{{role}}/permissions/{{perm}}` },
      { method: 'DELETE', path: `${BASE}/{{role}}/permissions/{{perm}}` },
      { method: 'DELETE', path: `${BASE}/{{role}}` },
      { method: 'GET', path: `${BASE}/{{role}}` },
      { method: 'DELETE', path: `${BASE}/{{role}}` },
    ],
  },
] satisfies Scenario[];
