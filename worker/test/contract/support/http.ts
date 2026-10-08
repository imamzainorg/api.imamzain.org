import { expect, it } from 'vitest';
import { HARNESS_JWT_SECRET } from '../../harness/config';
import { adminToken as mint, connect, type Query } from '../../harness/token';

/**
 * Black-box client for the contract suite. Every test runs unchanged against Nest and against the
 * Worker; BASE_URL picks the target and DATABASE_URL is that target's DB (test/contract/run.ts and
 * test/check.ts set both). Tests make their own data with unique names and never assume an empty DB,
 * so the suite can run twice on one DB and on the scrubbed prod copy alike.
 */
function env(name: string, shown = name): string {
  const value = process.env[name];
  if (!value) throw new Error(`${shown} is not set; run the suite through \`npm run contract\` or \`npm run check:<group>\``);
  return value;
}

/** BASE_URL, as passed on by vitest.contract.config.ts. */
export const BASE_URL = env('CONTRACT_TARGET', 'BASE_URL').replace(/\/$/, '');

/** Which server the suite runs against: set by the runner, nest when run by hand. */
export const TARGET: 'nest' | 'worker' = process.env.CONTRACT_IMPL === 'worker' ? 'worker' : 'nest';

/** A test of an intentional fix (plan rule 6): Nest still has the old behaviour, so it only runs on the Worker. */
export const workerOnly = TARGET === 'worker' ? it : it.skip;

export const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export interface ApiOptions {
  method?: string;
  body?: unknown;
  token?: string;
  /** Accept-Language. */
  lang?: string;
  headers?: Record<string, string>;
  /** Client IP. Default: a fresh one per call, so per-IP throttles never couple tests; share one to test a limit. */
  ip?: string;
}

export interface ApiResponse {
  status: number;
  headers: Headers;
  text: string;
  /** Parsed JSON, or undefined. `any` so tests can assert on fields directly. */
  body: any;
}

export const randomIp = () => `10.${(Math.random() * 256) | 0}.${(Math.random() * 256) | 0}.${(Math.random() * 256) | 0}`;

/**
 * Nest (trust proxy 1) reads the client IP from X-Forwarded-For, the Worker from CF-Connecting-IP; the
 * same header pair works on both.
 */
export async function api(path: string, opts: ApiOptions = {}): Promise<ApiResponse> {
  const ip = opts.ip ?? randomIp();
  const headers: Record<string, string> = { 'x-forwarded-for': ip, 'cf-connecting-ip': ip, ...opts.headers };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  if (opts.lang) headers['accept-language'] = opts.lang;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(BASE_URL + path, {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    redirect: 'manual',
  });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = undefined;
  }
  return { status: res.status, headers: res.headers, text, body };
}

/** Runs `fn` with a query function on the target's DB: for setup the API can't do (e.g. rows of an unported group). */
export async function withDb<T>(fn: (q: Query) => Promise<T>): Promise<T> {
  const db = connect(env('DATABASE_URL'));
  try {
    return await fn(db.q);
  } finally {
    await db.close();
  }
}

let token: Promise<string> | undefined;
/** A token for the DB's first live super-admin (all permissions), minted with the harness secret. */
export function adminToken(): Promise<string> {
  token ??= withDb((q) => mint(q, process.env.JWT_SECRET ?? HARNESS_JWT_SECRET));
  return token;
}

/** The same user with only `permissions`, for 403 tests. */
export function tokenWith(permissions: string[]): Promise<string> {
  return withDb((q) => mint(q, process.env.JWT_SECRET ?? HARNESS_JWT_SECRET, permissions));
}

/** Nest's success envelope: the handler's object with `success` and `timestamp` appended. */
export function expectSuccess(res: ApiResponse, status = 200): void {
  expect(res.status, res.text).toBe(status);
  expect(res.headers.get('content-type')).toBe('application/json; charset=utf-8');
  expect(res.body).toMatchObject({ success: true, timestamp: expect.stringMatching(ISO_DATE) });
  expect(Object.keys(res.body).at(-1)).toBe('timestamp');
}

/** The error envelope, including the `error` text the CMS shows users (D5) when given. */
export function expectError(res: ApiResponse, status: number, code: string, error?: string | RegExp): void {
  expect(res.status, res.text).toBe(status);
  expect(res.headers.get('content-type')).toBe('application/json; charset=utf-8');
  expect(res.body).toMatchObject({ success: false, code, timestamp: expect.stringMatching(ISO_DATE), path: expect.any(String) });
  if (error !== undefined) expect(res.body.error).toMatch(error);
}
