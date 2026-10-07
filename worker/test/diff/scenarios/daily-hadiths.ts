import type { Scenario } from '../scenario';

const BASE = '/api/v1/daily-hadiths';
const MISSING = '00000000-0000-4000-8000-000000000000';
const ar = (content: string, source?: string) => ({ lang: 'ar', content, ...(source ? { source } : {}) });
const en = (content: string) => ({ lang: 'en', content });

export default [
  {
    name: 'lifecycle',
    steps: [
      { method: 'POST', path: BASE, body: { display_date: '2999-05-15', translations: [ar('Diff ar', 'src'), en('Diff en')] }, capture: { a: 'data.id' } },
      { method: 'POST', path: BASE, body: { translations: [ar('Unscheduled')] }, capture: { b: 'data.id' } },
      { method: 'POST', path: BASE, body: { display_date: '2999-05-15', translations: [ar('Dup date')] } },
      { method: 'POST', path: BASE, body: { display_date: '2999-02-30', translations: [ar('Bad date')] } },
      { method: 'POST', path: BASE, body: { translations: [ar('x'), { lang: 'AR', content: 'y' }] } },
      { method: 'POST', path: BASE, body: { translations: [{ lang: 'zz', content: 'x' }] } },
      { method: 'POST', path: BASE, body: { display_date: 'nope', translations: [] } },
      { method: 'PATCH', path: `${BASE}/{{a}}`, body: { translations: [en('Diff en 2'), { lang: 'fa', content: 'Diff fa' }] } },
      { method: 'PATCH', path: `${BASE}/{{b}}`, body: { display_date: '2999-05-15' } },
      { method: 'PATCH', path: `${BASE}/{{b}}`, body: { display_date: '2999-05-16' } },
      { method: 'PATCH', path: `${BASE}/{{b}}`, body: { display_date: 20260501 } },
      { method: 'PATCH', path: `${BASE}/${MISSING}`, body: { display_date: null } },
      { method: 'GET', path: `${BASE}?date=2999-05-15`, auth: 'anon', lang: 'en' },
      { method: 'GET', path: `${BASE}?from=2999-05-01&to=2999-05-31`, auth: 'anon' },
      { method: 'GET', path: `${BASE}?date=2999-05-15&from=2999-05-01&to=2999-05-31`, auth: 'anon' },
      { method: 'GET', path: `${BASE}?from=2999-05-01`, auth: 'anon' },
      { method: 'GET', path: `${BASE}?from=2999-06-01&to=2999-05-01`, auth: 'anon' },
      { method: 'GET', path: `${BASE}?date=2999-02-30`, auth: 'anon' },
      { method: 'GET', path: `${BASE}/admin/{{a}}`, lang: 'fa' },
      { method: 'GET', path: `${BASE}/admin?limit=100` },
      { method: 'PATCH', path: `${BASE}/{{b}}`, body: { display_date: null } },
      { method: 'DELETE', path: `${BASE}/{{a}}` },
      { method: 'DELETE', path: `${BASE}/{{a}}` },
      { method: 'POST', path: BASE, body: { display_date: '2999-05-15', translations: [ar('Takes the date')] }, capture: { c: 'data.id' } },
      { method: 'GET', path: `${BASE}/trash?limit=100` },
      { method: 'POST', path: `${BASE}/{{a}}/restore` },
      { method: 'POST', path: `${BASE}/{{a}}/restore` },
      { method: 'DELETE', path: `${BASE}/{{c}}` },
      { method: 'DELETE', path: `${BASE}/{{b}}` },
      { method: 'POST', path: `${BASE}/{{b}}/restore` },
      { method: 'POST', path: `${BASE}/{{c}}/restore` },
      { method: 'DELETE', path: `${BASE}/{{a}}` },
      { method: 'DELETE', path: `${BASE}/{{b}}` },
      { method: 'DELETE', path: `${BASE}/{{c}}` },
    ],
  },
] satisfies Scenario[];
