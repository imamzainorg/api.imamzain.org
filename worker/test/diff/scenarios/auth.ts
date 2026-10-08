import type { Scenario } from '../scenario';

const BASE = '/api/v1/auth';

export default [
  {
    name: 'sign-in',
    steps: [
      { method: 'POST', path: '/api/v1/users', body: { username: 'diff-auth-user', password: 'diff-password-1' } },
      { method: 'POST', path: `${BASE}/login`, auth: 'anon', body: { username: ' diff-auth-user ', password: 'diff-password-1' }, capture: { refresh: 'data.refresh_token' } },
      { method: 'POST', path: `${BASE}/login`, auth: 'anon', body: { username: 'diff-auth-user', password: 'wrong-password' } },
      { method: 'POST', path: `${BASE}/login`, auth: 'anon', body: { username: 'DIFF-AUTH-USER', password: 'diff-password-1' } },
      { method: 'POST', path: `${BASE}/login`, auth: 'anon', body: { username: 'ab', password: '' } },
      { method: 'POST', path: `${BASE}/refresh`, auth: 'anon', body: { refresh_token: '{{refresh}}' } },
      { method: 'POST', path: `${BASE}/refresh`, auth: 'anon', body: { refresh_token: 'unknown' } },
      { method: 'POST', path: `${BASE}/logout`, auth: 'anon' },
    ],
  },
] satisfies Scenario[];
