import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { HARNESS_JWT_SECRET, WORKER_DIR, rel } from '../harness/config';
import type { Stack } from '../harness/servers';
import { adminToken, connect } from '../harness/token';
import { compare, IdMap, type Captured } from './compare';
import { buildCorpus, requestLabel, type OpenApi } from './corpus';
import { writeReport, type Exchange, type Summary } from './report';
import { fill, pick, type Scenario } from './scenario';

const DIFF_DIR = path.join(WORKER_DIR, 'test/diff');

let ipCounter = 0;
/** A fresh client IP per read (one per scenario for writes), so no throttle bucket fills on either target. */
function nextIp(): string {
  const n = ++ipCounter;
  return `10.${(n >> 16) & 255}.${(n >> 8) & 255}.${n & 255}`;
}

interface Send {
  method: string;
  path: string;
  lang: string | null;
  token: string | null;
  ip: string;
  body?: unknown;
}

/**
 * The same request to either target. Nest (trust proxy 1) reads the client IP from X-Forwarded-For;
 * the Worker from CF-Connecting-IP, which it forwards to its Nest as X-Forwarded-For.
 */
async function send(base: string, r: Send): Promise<Captured & { json: unknown }> {
  const headers: Record<string, string> = { 'x-forwarded-for': r.ip, 'cf-connecting-ip': r.ip };
  if (r.lang) headers['accept-language'] = r.lang;
  if (r.token) headers.authorization = `Bearer ${r.token}`;
  if (r.body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(base + r.path, {
    method: r.method,
    headers,
    body: r.body === undefined ? undefined : JSON.stringify(r.body),
    redirect: 'manual',
    signal: AbortSignal.timeout(30_000),
  });
  const body = await res.text();
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    json = undefined;
  }
  return { status: res.status, contentType: res.headers.get('content-type') ?? '', etag: res.headers.get('etag'), body, json };
}

async function loadScenarios(group: string): Promise<Scenario[]> {
  const file = path.join(DIFF_DIR, 'scenarios', `${group}.ts`);
  return fs.existsSync(file) ? (await import(pathToFileURL(file).href)).default : [];
}

/**
 * Replays `group`'s corpus, then its write scenarios, against Nest and the Worker and writes
 * reports/<group>.md. `runStart` must predate the stack's start: dates the servers generate after it
 * (Nest's cached R2 check time included) count as generated.
 */
export async function runDiff(group: string, stack: Stack, dbA: string, runStart: number, source: string): Promise<Summary> {
  const ids = new IdMap();
  const exchanges: Exchange[] = [];
  const db = connect(dbA);
  let corpus;
  let token;
  try {
    token = await adminToken(db.q, HARNESS_JWT_SECRET);
    const openapi = (await (await fetch(`${stack.nest}/openapi.json`)).json()) as OpenApi;
    corpus = await buildCorpus(group, openapi, db.q);
  } finally {
    await db.close();
  }
  const scenarios = await loadScenarios(group);
  if (corpus.requests.length + corpus.skipped.length + scenarios.length === 0) {
    throw new Error(`unknown group "${group}": no GET route in Nest's OpenAPI belongs to it and it has no scenarios`);
  }

  for (const r of corpus.requests) {
    const req = { method: 'GET', path: r.path, lang: r.lang, token: r.admin ? token : null, ip: nextIp() };
    const [a, b] = await Promise.all([send(stack.nest, req), send(stack.worker, req)]);
    exchanges.push({ label: r.label, statusA: a.status, statusB: b.status, diffs: compare(a, b, { ids, runStart, allowNewIds: false }) });
  }

  for (const sc of scenarios) {
    const vars = { a: {} as Record<string, string>, b: {} as Record<string, string> };
    const ip = nextIp();
    for (const [i, step] of sc.steps.entries()) {
      const label = `scenario ${sc.name} #${i + 1} ${requestLabel(step.method, step.path, step.lang ?? null, step.auth !== 'anon')}`;
      try {
        const base = { method: step.method, lang: step.lang ?? null, token: step.auth === 'anon' ? null : token, ip };
        const [a, b] = await Promise.all([
          send(stack.nest, { ...base, path: fill(step.path, vars.a), body: fill(step.body, vars.a) }),
          send(stack.worker, { ...base, path: fill(step.path, vars.b), body: fill(step.body, vars.b) }),
        ]);
        for (const [name, at] of Object.entries(step.capture ?? {})) {
          const va = pick(a.json, at);
          const vb = pick(b.json, at);
          if (va !== undefined) vars.a[name] = va;
          if (vb !== undefined) vars.b[name] = vb;
        }
        exchanges.push({ label, statusA: a.status, statusB: b.status, diffs: compare(a, b, { ids, runStart, allowNewIds: true }) });
      } catch (err) {
        exchanges.push({ label, statusA: 0, statusB: 0, diffs: [{ field: 'scenario aborted', a: (err as Error).message, b: '' }] });
        break;
      }
    }
  }

  return writeReport({ group, exchanges, skipped: corpus.skipped, scenarios: scenarios.length }, path.join(DIFF_DIR, 'reports'), source);
}

export const summaryLine = (s: Summary) =>
  `${s.requests} requests, ${s.same} same, ${s.diffs} diffs (${s.unexplained} unexplained) → ${rel(s.report)}`;
