import type { Context } from 'hono';
import type { AppEnv } from './types';

/**
 * Fallthrough: anything not ported is fetched from the Nest origin (D11). The origin's own
 * X-Forwarded-For is replaced with the visitor's IP from CF-Connecting-IP, so a client-sent value
 * can't spoof it. Nest reads the client IP from the Nth-from-last entry (TRUST_PROXY_HOPS): with the
 * Worker in front, that is 2 on the origin, not the current 1.
 */
export async function proxyToOrigin(c: Context<AppEnv>): Promise<Response> {
  const incoming = new URL(c.req.url);
  const target = new URL(incoming.pathname + incoming.search, c.env.ORIGIN_URL);
  const headers = new Headers(c.req.raw.headers);
  const clientIp = headers.get('cf-connecting-ip');
  if (clientIp) headers.set('x-forwarded-for', clientIp);
  // Phase 6 switches Nest off only after 7 days with none of these in Workers Logs. Path only: no query.
  console.log({ event: 'fallthrough', method: c.req.method, path: incoming.pathname });
  return fetch(target, { method: c.req.method, headers, body: c.req.raw.body, redirect: 'manual', duplex: 'half' } as RequestInit);
}
