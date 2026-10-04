import { createMiddleware } from 'hono/factory';
import type { AppEnv } from './types';

// Exactly what helmet 8 emits for the directives in Nest's main.ts: those first, then its remaining defaults.
const CSP = [
  "default-src 'self'",
  "script-src 'self' https://cdn.jsdelivr.net",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "connect-src 'self'",
  "font-src 'self' https:",
  "object-src 'none'",
  "frame-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
  "script-src-attr 'none'",
  'upgrade-insecure-requests',
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
