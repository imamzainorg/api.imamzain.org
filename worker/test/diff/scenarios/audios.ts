import type { Scenario } from '../scenario';

const BASE = '/api/v1/audios';
const MISSING = '00000000-0000-4000-8000-000000000000';
const ar = (title: string, extra: Record<string, unknown> = {}) => ({ lang: 'ar', title, is_default: true, ...extra });
const en = (title: string) => ({ lang: 'en', title });

export default [
  {
    name: 'lifecycle',
    steps: [
      { method: 'POST', path: '/api/v1/speakers', body: { translations: [{ lang: 'ar', name: 'Diff speaker', is_default: true }] }, capture: { spk: 'data.id' } },
      {
        method: 'POST',
        path: BASE,
        body: { speaker_id: '{{spk}}', audio_url: 'https://example.test/diff/a.mp3', slug: 'diff-audio', duration_seconds: 60, size_mb: 1.5, peaks: [0, 0.5, 1], translations: [ar('Diff ar'), en('Diff en')] },
        capture: { a: 'data.id' },
      },
      { method: 'POST', path: BASE, body: { audio_url: 'https://example.test/diff/b.mp3', slug: 'diff-audio', translations: [ar('Dup slug')] } },
      { method: 'POST', path: BASE, body: { audio_url: 'https://example.test/diff/a.mp3', translations: [ar('Dup url')] } },
      { method: 'POST', path: BASE, body: { speaker_id: MISSING, audio_url: 'https://example.test/diff/c.mp3', translations: [ar('No speaker')] } },
      { method: 'POST', path: BASE, body: { audio_url: 'https://example.test/diff/d.mp3', translations: [en('No default')] } },
      { method: 'POST', path: BASE, body: { audio_url: 'nope', slug: 'Bad Slug', peaks: [2], translations: [] } },
      { method: 'PATCH', path: `${BASE}/{{a}}`, body: { duration_seconds: 90, translations: [en('Diff en 2'), ar('Diff ar 2')] } },
      { method: 'PATCH', path: `${BASE}/{{a}}`, body: { translations: [en('Second default')].map((t) => ({ ...t, is_default: true })) } },
      { method: 'PATCH', path: `${BASE}/{{a}}`, body: { speaker_id: MISSING } },
      { method: 'PATCH', path: `${BASE}/{{a}}`, body: { speaker_id: null, pdf_url: null } },
      { method: 'GET', path: `${BASE}/{{a}}`, auth: 'anon', lang: 'en' },
      { method: 'GET', path: `${BASE}/by-slug/diff-audio`, auth: 'anon' },
      { method: 'GET', path: `${BASE}?search=Diff`, auth: 'anon' },
      { method: 'POST', path: `${BASE}/{{a}}/view`, auth: 'anon' },
      { method: 'PATCH', path: `${BASE}/{{a}}/publish`, body: { is_published: false } },
      { method: 'PATCH', path: `${BASE}/{{a}}/publish`, body: { is_published: false } },
      { method: 'PATCH', path: `${BASE}/{{a}}/publish`, body: { is_published: 'yes' } },
      { method: 'GET', path: `${BASE}/{{a}}`, auth: 'anon' },
      { method: 'POST', path: `${BASE}/{{a}}/view`, auth: 'anon' },
      { method: 'GET', path: `${BASE}/admin/{{a}}` },
      { method: 'GET', path: `${BASE}/admin?is_published=false&limit=100` },
      { method: 'PATCH', path: `${BASE}/{{a}}/publish`, body: { is_published: true } },
      { method: 'DELETE', path: `${BASE}/{{a}}` },
      { method: 'DELETE', path: `${BASE}/{{a}}` },
      { method: 'POST', path: BASE, body: { audio_url: 'https://example.test/diff/a.mp3', slug: 'diff-audio', translations: [ar('Reused')] }, capture: { b: 'data.id' } },
      { method: 'GET', path: `${BASE}/trash?limit=100` },
      { method: 'POST', path: `${BASE}/{{a}}/restore` },
      { method: 'DELETE', path: `${BASE}/{{b}}` },
      { method: 'POST', path: `${BASE}/{{a}}/restore` },
      { method: 'POST', path: `${BASE}/{{a}}/restore` },
      { method: 'GET', path: `${BASE}/{{a}}`, auth: 'anon' },
      { method: 'DELETE', path: `${BASE}/{{a}}` },
      { method: 'DELETE', path: `/api/v1/speakers/{{spk}}` },
      { method: 'POST', path: `${BASE}/{{a}}/restore` },
    ],
  },
] satisfies Scenario[];
