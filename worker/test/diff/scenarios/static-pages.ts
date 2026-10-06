import type { Scenario } from '../scenario';

const BASE = '/api/v1/static-pages';
const ar = (title: string, extra: Record<string, unknown> = {}) => ({
  lang: 'ar',
  title,
  body: '<p onclick="x()">نص <strong>الصفحة</strong></p><script>alert(1)</script>',
  is_default: true,
  ...extra,
});
const en = (title: string) => ({ lang: 'en', title, body: '<h2 id="intro">Intro</h2><a href="#intro" target="_blank">top</a>' });

export default [
  {
    name: 'lifecycle',
    steps: [
      { method: 'POST', path: BASE, body: { slug: 'diff-page', translations: [ar('صفحة الفرق'), en('Diff page')], display_order: 7 }, capture: { pg: 'data.id' } },
      { method: 'GET', path: `${BASE}/{{pg}}`, auth: 'anon', lang: 'en' },
      { method: 'GET', path: `${BASE}/by-slug/diff-page`, auth: 'anon' },
      { method: 'GET', path: `${BASE}/admin?limit=100` },
      { method: 'GET', path: `${BASE}/admin?is_published=false` },
      { method: 'GET', path: `${BASE}/admin?is_published=yes` },
      // Duplicate slug, no default, two languages the same, an og image that does not exist.
      { method: 'POST', path: BASE, body: { slug: 'diff-page', translations: [ar('Again')] } },
      { method: 'POST', path: BASE, body: { slug: 'diff-nodefault', translations: [{ lang: 'ar', title: 'A', body: '<p>a</p>' }] } },
      { method: 'POST', path: BASE, body: { slug: 'diff-duplang', translations: [ar('A'), { lang: 'ar', title: 'B', body: '<p>b</p>' }] } },
      { method: 'POST', path: BASE, body: { slug: 'diff-og', translations: [ar('A', { og_image_id: '00000000-0000-4000-8000-000000000000' })] } },
      { method: 'POST', path: BASE, body: { slug: 'Bad Slug', translations: [] } },
      // A published page's slug is locked; unpublishing in the same request lifts the lock.
      { method: 'PATCH', path: `${BASE}/{{pg}}`, body: { slug: 'diff-renamed' } },
      { method: 'PATCH', path: `${BASE}/{{pg}}`, body: { display_order: 2, translations: [{ lang: 'en', title: 'Diff page 2', body: '<p>two</p>' }] } },
      { method: 'PATCH', path: `${BASE}/{{pg}}`, body: { translations: [{ lang: 'en', title: 'Two defaults', body: '<p>x</p>', is_default: true }] } },
      { method: 'PATCH', path: `${BASE}/{{pg}}/publish`, body: { is_published: true } },
      { method: 'PATCH', path: `${BASE}/{{pg}}`, body: { slug: 'diff-renamed', is_published: false } },
      { method: 'GET', path: `${BASE}/{{pg}}`, auth: 'anon' },
      { method: 'GET', path: `${BASE}/by-slug/diff-renamed`, auth: 'anon' },
      { method: 'GET', path: `${BASE}/admin/{{pg}}` },
      { method: 'PATCH', path: `${BASE}/{{pg}}/publish`, body: { is_published: true } },
      { method: 'PATCH', path: `${BASE}/{{pg}}/publish`, body: { is_published: 'yes' } },
      { method: 'DELETE', path: `${BASE}/{{pg}}` },
      { method: 'DELETE', path: `${BASE}/{{pg}}` },
      { method: 'GET', path: `${BASE}/{{pg}}`, auth: 'anon' },
      { method: 'GET', path: `${BASE}/trash?limit=100` },
      // The slug is free again while the page sits in the trash; restoring then conflicts.
      { method: 'POST', path: BASE, body: { slug: 'diff-renamed', translations: [ar('Taker')] }, capture: { taker: 'data.id' } },
      { method: 'POST', path: `${BASE}/{{pg}}/restore` },
      { method: 'DELETE', path: `${BASE}/{{taker}}` },
      { method: 'POST', path: `${BASE}/{{pg}}/restore` },
      { method: 'POST', path: `${BASE}/{{pg}}/restore` },
      { method: 'GET', path: `${BASE}/by-slug/diff-renamed`, auth: 'anon' },
    ],
  },
] satisfies Scenario[];
