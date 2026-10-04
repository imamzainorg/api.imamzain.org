/**
 * Write scenarios: scripted sequences replayed step by step on both targets after the read corpus,
 * e.g. create → update → publish → delete → restore. One file per group, `scenarios/<group>.ts`:
 *
 *   import type { Scenario } from '../scenario';
 *   export default [
 *     {
 *       name: 'lifecycle',
 *       steps: [
 *         { method: 'POST', path: '/api/v1/post-categories', body: { translations: [...] }, capture: { cat: 'data.id' } },
 *         { method: 'PATCH', path: '/api/v1/post-categories/{{cat}}', body: { ... } },
 *         { method: 'DELETE', path: '/api/v1/post-categories/{{cat}}' },
 *         { method: 'GET', path: '/api/v1/post-categories/{{cat}}', auth: 'anon' },
 *       ],
 *     },
 *   ] satisfies Scenario[];
 *
 * `{{name}}` in a path or a body string is filled per target with the value `capture` took from that
 * target's response, so A and B each work on their own rows. Ids a scenario creates differ between A
 * and B; the comparison pairs them (compare.ts). Literal values (slugs, titles) can be fixed: every
 * run starts from fresh copies of the template.
 */
export interface Step {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  body?: unknown;
  /** name → dotted path into the JSON response body, e.g. `data.id` or `data.items.0.id`. */
  capture?: Record<string, string>;
  /** Default `admin`. */
  auth?: 'admin' | 'anon';
  lang?: string;
}

export interface Scenario {
  name: string;
  steps: Step[];
}

/** Replaces `{{name}}` in every string inside `value`. Throws on a name nothing captured. */
export function fill<T>(value: T, vars: Record<string, string>): T {
  if (typeof value === 'string') {
    return value.replace(/\{\{(\w+)\}\}/g, (_, name: string) => {
      if (!(name in vars)) throw new Error(`scenario: {{${name}}} was never captured`);
      return vars[name];
    }) as T;
  }
  if (Array.isArray(value)) return value.map((v) => fill(v, vars)) as T;
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fill(v, vars)])) as T;
  return value;
}

export function pick(body: unknown, dotted: string): string | undefined {
  let at: unknown = body;
  for (const part of dotted.split('.')) at = at && typeof at === 'object' ? (at as Record<string, unknown>)[part] : undefined;
  return at === undefined || at === null ? undefined : String(at);
}
