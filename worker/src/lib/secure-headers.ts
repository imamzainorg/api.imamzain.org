import { createMiddleware } from 'hono/factory';
import type { AppEnv } from './types';

// helmet 8 defaults merged with the directives in Nest's main.ts, in helmet's output order.
const CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "font-src 'self' https:",
  "form-action 'self'",
  "frame-ancestors 'self'",
  "img-src 'self' data: https:",
  "object-src 'none'",
  "script-src 'self' https://cdn.jsdelivr.net",
  "script-src-attr 'none'",
  "style-src 'self' 'unsafe-inline'",
  'upgrade-insecure-requests',
  "connect-src 'self'",
  "frame-src 'none'",
].join(';');

const HEADERS: Record<string, string> = {
  'Content-Security-Policy': CSP,
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Origin-Agent-Cluster': '?1',
  'Referrer-Policy': 'no-referrer',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'X-Content-Type-Options': 'nosniff',
  'X-DNS-Prefetch-Control': 'off',
  'X-Download-Options': 'noopen',
  'X-Frame-Options': 'SAMEORIGIN',
  'X-Permitted-Cross-Domain-Policies': 'none',
  'X-XSS-Protection': '0',
};

/** What `helmet()` set in Nest. */
export const secureHeaders = createMiddleware<AppEnv>(async (c, next) => {
  await next();
  for (const [k, v] of Object.entries(HEADERS)) c.header(k, v);
});
