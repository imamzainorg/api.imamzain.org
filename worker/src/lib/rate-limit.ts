import type { Context } from 'hono';
import { createMiddleware } from 'hono/factory';
import { tooManyRequests } from './errors';
import type { AppEnv } from './types';

/** One Rate Limiting binding per limit tier (wrangler.jsonc); the binding's limit is fixed, so the tier IS the limit. */
export type RateTier = 'RL_GLOBAL' | 'RL_60' | 'RL_30' | 'RL_10' | 'RL_5' | 'RL_VIEW';

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
