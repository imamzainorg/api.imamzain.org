import { createMiddleware } from 'hono/factory';
import type { AppEnv } from './types';

const TIMESTAMP_KEY = ',"timestamp":"';
const TIMESTAMP_TAIL = /^,"timestamp":"[^"]{1,40}"}$/;

/** `envelopeEtag` from Nest: hash the body without the trailing `timestamp`, so an unchanged payload keeps its validator. */
export async function envelopeEtag(body: string): Promise<string> {
  const at = body.lastIndexOf(TIMESTAMP_KEY);
  const stable = at >= 0 && TIMESTAMP_TAIL.test(body.slice(at)) ? body.slice(0, at) : body;
  const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(stable));
  const b64 = btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `W/"${b64}"`;
}

/** Express's `fresh` check: any If-None-Match entry weakly equal to the ETag (or `*`). */
function isFresh(req: Request, etag: string): boolean {
  if (/(?:^|,)\s*no-cache\s*(?:,|$)/.test(req.headers.get('cache-control') ?? '')) return false;
  const inm = req.headers.get('if-none-match');
  if (!inm) return false;
  if (inm.trim() === '*') return true;
  const weak = (v: string) => v.trim().replace(/^W\//, '');
  return inm.split(',').some((v) => weak(v) === weak(etag));
}

/** Sets the ETag on every JSON/text/XML body and answers a matching GET/HEAD 2xx with a body-less 304. */
export const etag = createMiddleware<AppEnv>(async (c, next) => {
  await next();
  const res = c.res;
  if (!res.body || res.headers.has('ETag')) return;
  const type = res.headers.get('content-type') ?? '';
  if (!/json|text|xml/.test(type)) return;
  const tag = await envelopeEtag(await res.clone().text());
  c.header('ETag', tag);
  const method = c.req.method;
  if ((method === 'GET' || method === 'HEAD') && res.status >= 200 && res.status < 300 && isFresh(c.req.raw, tag)) {
    const headers = new Headers(c.res.headers);
    headers.delete('content-type');
    headers.delete('content-length');
    c.res = new Response(null, { status: 304, headers });
  }
});
