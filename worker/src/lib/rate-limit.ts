import type { Context } from 'hono';
import { createMiddleware } from 'hono/factory';
import { tooManyRequests } from './errors';
import type { AppEnv } from './types';

/** One Rate Limiting binding per limit tier (wrangler.jsonc); the binding's limit is fixed, so the tier IS the limit. */
export type RateTier = 'RL_GLOBAL' | 'RL_120' | 'RL_60' | 'RL_30' | 'RL_20' | 'RL_10' | 'RL_5' | 'RL_VIEW';

/** RL_GLOBAL's limit per 60 s in wrangler.jsonc (Nest's 3,000 / 15 min per IP). */
const GLOBAL_PER_MINUTE = 200;
const TIER_BY_LIMIT: Record<number, RateTier> = { 120: 'RL_120', 60: 'RL_60', 30: 'RL_30', 20: 'RL_20', 10: 'RL_10', 5: 'RL_5' };

/**
 * Nest's `@Throttle({ default: { limit, ttl } })` → the binding tier for that route. The bindings only
 * have 60 s windows (D6), so the limit keeps its count and the window becomes 60 s whatever Nest's
 * ttl was: a 15-min or 1-h limit is looser here (login's 10 / 15 min becomes 10 / min); the DB-backed
 * login and confirm limits are unchanged. `null`: the mapped limit is at or above RL_GLOBAL's 200 / min,
 * which already caps it, so no per-route bucket (Nest's default 1,000 / 15 min on every route, forms'
 * 300 / h).
 */
export function tierFor(limit: number): RateTier | null {
  if (limit >= GLOBAL_PER_MINUTE) return null;
  const tier = TIER_BY_LIMIT[limit];
  if (!tier) throw new Error(`No rate-limit binding for ${limit} per 60 s; add one to wrangler.jsonc`);
  return tier;
}

/** True when the call is within the tier's limit for `key`. */
export async function withinLimit(env: Env, tier: RateTier, key: string): Promise<boolean> {
  return (await env[tier].limit({ key })).success;
}

/**
 * Throttle guard. Global tier: one bucket per client IP across the API (Nest's `global` throttler).
 * Other tiers: one bucket per client per route (Nest's per-route `default` throttler). A hit is a
 * 429 `RATE_LIMITED` with Nest's message; the binding has 60 s windows, so Retry-After is 60.
 * `key` overrides the bucket (D7 view dedup uses `ip:resource`).
 */
export function rateLimit(tier: RateTier, key?: (c: Context<AppEnv>) => string) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const ip = c.get('ip');
    const bucket = key ? key(c) : tier === 'RL_GLOBAL' ? ip : `${c.req.method}:${c.req.routePath}:${ip}`;
    if (!(await withinLimit(c.env, tier, bucket))) {
      c.header(tier === 'RL_GLOBAL' ? 'Retry-After-global' : 'Retry-After', '60');
      throw tooManyRequests();
    }
    await next();
  });
}
