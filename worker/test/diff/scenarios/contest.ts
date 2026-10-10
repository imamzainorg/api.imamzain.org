import type { Scenario } from '../scenario';

const BASE = '/api/v1/forms/qutuf-sajjadiya-contest';

export default [
  {
    name: 'open-start-submit-close',
    steps: [
      // The dump has the contest closed.
      { method: 'POST', path: `${BASE}/start`, auth: 'anon', body: { name: 'Diff', contact: '+9647800000001', contactType: 'phone' } },
      { method: 'PUT', path: '/api/v1/settings/contest_open', body: { value: 'true', type: 'boolean' } },
      { method: 'POST', path: `${BASE}/start`, auth: 'anon', body: { name: 'Diff', contact: '+9647800000001', contactType: 'phone' }, capture: { attempt: 'data.attempt_id' } },
      { method: 'POST', path: `${BASE}/start`, auth: 'anon', body: { name: 'Diff', contact: '00964 780-000-0001', contactType: 'phone' } },
      { method: 'POST', path: `${BASE}/start`, auth: 'anon', body: { name: 'Diff', contact: 'x@y', contactType: 'email' } },
      { method: 'GET', path: `${BASE}/questions`, auth: 'anon', capture: { q: 'data.0.id' } },
      { method: 'POST', path: `${BASE}/submit`, auth: 'anon', body: { attempt_id: '{{attempt}}', answers: [{ question_id: '{{q}}', answer: 'A' }] } },
      { method: 'POST', path: `${BASE}/submit`, auth: 'anon', body: { attempt_id: '{{attempt}}', attempt_token: 'bad', answers: [{ question_id: '{{q}}', answer: 'A' }] } },
      { method: 'GET', path: `${BASE}/attempts?submitted=false&limit=5` },
      { method: 'PUT', path: '/api/v1/settings/contest_open', body: { value: 'false', type: 'boolean' } },
      { method: 'POST', path: `${BASE}/submit`, auth: 'anon', body: { attempt_id: '{{attempt}}', answers: [{ question_id: '{{q}}', answer: 'A' }] } },
    ],
  },
] satisfies Scenario[];
