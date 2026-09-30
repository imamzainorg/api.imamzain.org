import { ExecutionContext, Injectable } from "@nestjs/common";
import { ThrottlerGuard } from "@nestjs/throttler";
import { createHash } from "crypto";

/** Name of the API-wide throttler; per-route `@Throttle({ default: … })` overrides never touch it. */
export const GLOBAL_THROTTLER = "global";

/** Default API-wide ceiling per client IP per 15 minutes (override with THROTTLE_GLOBAL_LIMIT; 0 disables). */
export const DEFAULT_GLOBAL_THROTTLE_LIMIT = 3_000;

export const THROTTLE_WINDOW_MS = 900_000;

/**
 * Resolve the global per-IP ceiling from the environment. Kept as a function
 * (not a module constant) so the value is read at module-factory time and can
 * be exercised in tests.
 */
export function resolveGlobalThrottleLimit(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.THROTTLE_GLOBAL_LIMIT;
  if (raw === undefined || raw === "") return DEFAULT_GLOBAL_THROTTLE_LIMIT;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_GLOBAL_THROTTLE_LIMIT;
}

/**
 * `ThrottlerGuard` keys every bucket on `<Controller>-<handler>-<name>-<ip>`,
 * so the "1000 requests / 15 min per IP" ceiling the docs promised was really
 * a per-route ceiling — ~210 independent buckets per IP, no ceiling at all
 * for someone walking the API. This subclass keeps that per-route keying for
 * the `default` throttler (the `@Throttle` overrides on login, forms, contest
 * etc. rely on it) and gives the `global` throttler a key that ignores the
 * handler: one bucket per client across the whole API.
 */
@Injectable()
export class GlobalThrottlerGuard extends ThrottlerGuard {
  protected generateKey(context: ExecutionContext, suffix: string, name: string): string {
    if (name === GLOBAL_THROTTLER) {
      return createHash("sha256").update(`${GLOBAL_THROTTLER}-${suffix}`).digest("hex");
    }
    return super.generateKey(context, suffix, name);
  }
}
