import type { Scenario } from '../scenario';

const BASE = '/api/v1/search';
const q = (term: string, extra = '') => `${BASE}?q=${encodeURIComponent(term)}${extra}`;

// Read-only: every search is a GET, replayed on both targets over the prod copy's real content.
const get = (path: string, lang?: string) => ({ method: 'GET' as const, path, auth: 'anon' as const, ...(lang ? { lang } : {}) });

export default [
  {
    name: 'queries',
    steps: [
      get(q('الإمام')),
      get(q('الإمام'), 'en'),
      get(q('زين العابدين'), 'ar'),
      get(q('الصحيفة السجادية'), 'ar'),
      get(q('الصحيفة السجادية'), 'en'),
      get(q('دعاء'), 'fa'),
      get(q('صلاة', '&limit=3')),
      get(q('كتاب', '&types=book,academic_paper')),
      get(q('محاضرة', '&types=audio&limit=50')),
      get(q('imam')),
      get(q('imam', '&types=post&types=gallery_image'), 'en'),
      get(q('  الإمام  ')),
      get(q('zzzzzzqqq')),
      get(q('a')),
      get(q('')),
      get(q('x'.repeat(201))),
      get(`${BASE}`),
      get(q('الإمام', '&types=video')),
      get(q('الإمام', '&types=post,post')),
      get(q('الإمام', '&limit=51')),
      get(q('الإمام', '&limit=0')),
      get(q('الإمام', '&unknown=1')),
    ],
  },
] satisfies Scenario[];
