import type { Scenario } from '../scenario';

const BASE = '/api/v1/newsletter';

// Subscribe isn't replayed: the Worker claims a confirmation where the hermetic Nest (no SMTP) doesn't, so
// the rows would differ by design. The lifecycle runs on the first subscriber the
// database already has.
export default [
  {
    name: 'subscriber-lifecycle',
    steps: [
      { method: 'GET', path: `${BASE}/subscribers?limit=1`, capture: { s: 'data.items.0.id' } },
      { method: 'POST', path: `${BASE}/subscribers/{{s}}/unsubscribe` },
      { method: 'POST', path: `${BASE}/subscribers/{{s}}/unsubscribe` },
      { method: 'GET', path: `${BASE}/subscribers?is_active=false&limit=100` },
      { method: 'POST', path: `${BASE}/subscribers/{{s}}/resubscribe` },
      { method: 'POST', path: `${BASE}/subscribers/{{s}}/resubscribe` },
      { method: 'DELETE', path: `${BASE}/subscribers/{{s}}` },
      { method: 'DELETE', path: `${BASE}/subscribers/{{s}}` },
      { method: 'POST', path: `${BASE}/subscribers/{{s}}/unsubscribe` },
      { method: 'GET', path: `${BASE}/subscribers/trash?limit=100` },
      { method: 'POST', path: `${BASE}/subscribers/{{s}}/restore` },
      { method: 'POST', path: `${BASE}/subscribers/{{s}}/restore` },
      { method: 'GET', path: `${BASE}/subscribers?limit=100` },
    ],
  },
  {
    name: 'public-tokens',
    steps: [
      { method: 'POST', path: `${BASE}/confirm`, auth: 'anon', body: { email: 'nobody@example.com', token: 'abc' } },
      { method: 'POST', path: `${BASE}/confirm`, auth: 'anon', body: { email: 'not-an-email', token: 'abc' } },
      { method: 'POST', path: `${BASE}/unsubscribe`, auth: 'anon', body: { email: 'nobody@example.com', token: 'abc' } },
      { method: 'POST', path: `${BASE}/unsubscribe`, auth: 'anon', body: { email: 'nobody@example.com', token: 'x'.repeat(257), extra: 1 } },
    ],
  },
] satisfies Scenario[];
