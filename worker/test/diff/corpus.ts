import type { Query } from '../harness/token';
import { samplers } from './samplers';

/** One request of the read corpus. `label` is stable across runs: explanations in the report match it. */
export interface CorpusRequest {
  label: string;
  path: string;
  lang: string | null;
  admin: boolean;
}

export interface OpenApi {
  paths: Record<string, Record<string, { parameters?: { name: string; in: string }[] }>>;
}

const PREFIX = '/api/v1';

/** Groups whose URLs don't start with the group name (src/contest, src/newsletter's campaigns, src/feeds). */
const GROUP_PREFIXES: [string, string][] = [
  ['/forms/qutuf-sajjadiya-contest', 'contest'],
  ['/newsletter/campaigns', 'campaigns'],
  ['/homepage', 'feeds'],
  ['/sitemap.xml', 'feeds'],
  ['/rss/', 'feeds'],
];

/** The plan's group for an API path: the first segment after /api/v1, except for GROUP_PREFIXES. */
export function groupOf(path: string): string {
  const p = path.startsWith(PREFIX) ? path.slice(PREFIX.length) : path;
  const hit = GROUP_PREFIXES.find(([prefix]) => p === prefix || p.startsWith(prefix.endsWith('/') ? prefix : `${prefix}/`));
  return hit ? hit[1] : p.split('/')[1] ?? '';
}

const LANGS = ['ar', 'en', null];
const MAX_COMBOS = 12;

function combos(lists: string[][]): string[][] {
  return lists.reduce<string[][]>((acc, list) => acc.flatMap((c) => list.map((v) => [...c, v])), [[]]).slice(0, MAX_COMBOS);
}

export const requestLabel = (method: string, path: string, lang: string | null, admin: boolean) =>
  `${method} ${path} [${lang ?? '-'} ${admin ? 'admin' : 'anon'}]`;

/**
 * Every GET route of `group` from Nest's OpenAPI document × sampled path parameters × lang (ar, en,
 * none) × anonymous / admin, plus `page=2&limit=5` on routes that paginate.
 */
export async function buildCorpus(group: string, openapi: OpenApi, q: Query): Promise<{ requests: CorpusRequest[]; skipped: string[] }> {
  const requests: CorpusRequest[] = [];
  const skipped: string[] = [];
  const add = (path: string, lang: string | null) => {
    for (const admin of [false, true]) requests.push({ label: requestLabel('GET', path, lang, admin), path, lang, admin });
  };

  for (const [route, ops] of Object.entries(openapi.paths).sort(([a], [b]) => a.localeCompare(b))) {
    const op = ops.get;
    if (!op || groupOf(route) !== group) continue;
    const params = [...route.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
    const missing = params.filter((p) => !samplers[group]?.[p]);
    if (missing.length) {
      skipped.push(`GET ${route}: no sampler for ${missing.map((p) => `{${p}}`).join(', ')} (test/diff/samplers.ts)`);
      continue;
    }
    const values = await Promise.all(params.map((p) => samplers[group][p](q)));
    const query = new Set((op.parameters ?? []).filter((p) => p.in === 'query').map((p) => p.name));
    for (const combo of combos(values)) {
      const path = params.reduce((acc, p, i) => acc.replace(`{${p}}`, encodeURIComponent(combo[i])), route);
      for (const lang of LANGS) add(path, lang);
      if (query.has('page') && query.has('limit')) add(`${path}?page=2&limit=5`, null);
    }
  }
  return { requests, skipped };
}
