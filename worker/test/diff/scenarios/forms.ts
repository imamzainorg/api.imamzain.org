import type { Scenario } from '../scenario';

const BASE = '/api/v1/forms';

export default [
  {
    name: 'proxy-visit',
    steps: [
      { method: 'POST', path: `${BASE}/proxy-visit`, auth: 'anon', body: { visitor_name: 'Diff Visitor', visitor_phone: '+9647801234567', visitor_country: 'IQ' }, capture: { v: 'data.id' } },
      { method: 'POST', path: `${BASE}/proxy-visit`, auth: 'anon', body: { visitor_name: 'D', visitor_phone: '0780', visitor_country: 'iq' } },
      { method: 'PATCH', path: `${BASE}/proxy-visits/{{v}}`, body: { status: 'APPROVED', processed_at: '2026-01-15T14:30:00Z' } },
      { method: 'PATCH', path: `${BASE}/proxy-visits/{{v}}`, body: { status: 'PENDING', notes: 'undo' } },
      { method: 'PATCH', path: `${BASE}/proxy-visits/{{v}}`, body: { status: 'REJECTED' } },
      { method: 'PATCH', path: `${BASE}/proxy-visits/{{v}}`, body: { status: 'COMPLETED' } },
      { method: 'GET', path: `${BASE}/proxy-visits?status=REJECTED&limit=100` },
      { method: 'DELETE', path: `${BASE}/proxy-visits/{{v}}` },
      { method: 'PATCH', path: `${BASE}/proxy-visits/{{v}}`, body: { notes: 'gone' } },
      { method: 'GET', path: `${BASE}/proxy-visits/trash?limit=100` },
      { method: 'POST', path: `${BASE}/proxy-visits/{{v}}/restore` },
      { method: 'POST', path: `${BASE}/proxy-visits/{{v}}/restore` },
    ],
  },
  {
    name: 'contact',
    steps: [
      { method: 'POST', path: `${BASE}/contact`, auth: 'anon', body: { name: 'Diff Sender', email: 'diff@example.com', message: 'A message for the diff run' }, capture: { s: 'data.id' } },
      { method: 'POST', path: `${BASE}/contact`, auth: 'anon', body: { name: 'D', email: 'a@b', country: 'de', message: 'short' } },
      { method: 'PATCH', path: `${BASE}/contacts/{{s}}`, body: { status: 'RESPONDED', responded_at: '2026-01-15T14:30:00Z', notes: 'called' } },
      { method: 'PATCH', path: `${BASE}/contacts/{{s}}`, body: { status: 'SPAM' } },
      { method: 'GET', path: `${BASE}/contacts?status=SPAM&limit=100` },
      { method: 'DELETE', path: `${BASE}/contacts/{{s}}` },
      { method: 'GET', path: `${BASE}/contacts/trash?limit=100` },
      { method: 'POST', path: `${BASE}/contacts/{{s}}/restore` },
    ],
  },
] satisfies Scenario[];
