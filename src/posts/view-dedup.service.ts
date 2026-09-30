import { randomBytes } from 'node:crypto';
import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../common/redis/redis.service';
import { deriveKey, hmacHex } from '../common/utils/derive-key.util';

/** One counted view per (visitor, resource) per this many seconds. */
export const VIEW_DEDUP_WINDOW_SECONDS = 30 * 60;

/** Upper bound on the in-process fallback map; the oldest claims are evicted first. */
export const VIEW_DEDUP_MAX_LOCAL_ENTRIES = 10_000;

// Distinct from every other purpose derived from JWT_SECRET (see KEY_INFO).
const DEDUP_KEY_INFO = 'imamzain/view-dedup/v1';

/**
 * Bounded set of keys that were claimed within the last `windowMs`.
 *
 * Every claim gets the same window, so insertion order equals expiry order:
 * the oldest entry is always the first to expire, and both the expiry sweep and
 * the size-cap eviction only ever look at the front of the map.
 */
export class ExpiringClaimSet {
  private readonly claims = new Map<string, number>();

  constructor(
    private readonly windowMs: number,
    private readonly maxEntries: number,
  ) {}

  get size(): number {
    return this.claims.size;
  }

  /** True when `key` was not claimed inside the window (and is now); false on a repeat. */
  claim(key: string, now = Date.now()): boolean {
    const expiresAt = this.claims.get(key);
    if (expiresAt !== undefined && expiresAt > now) return false;

    // An expired entry has to move to the back to keep insertion order equal to expiry order.
    this.claims.delete(key);
    for (const [k, exp] of this.claims) {
      if (exp > now) break;
      this.claims.delete(k);
    }
    while (this.claims.size >= this.maxEntries) {
      const oldest = this.claims.keys().next();
      if (oldest.done) break;
      this.claims.delete(oldest.value);
    }
    this.claims.set(key, now + this.windowMs);
    return true;
  }

  release(key: string): void {
    this.claims.delete(key);
  }
}

/**
 * Decides whether a public "view" beacon should be counted.
 *
 * The counters feed the public `?sort=views` ranking and the endpoint is
 * anonymous, so an IP-only throttle (30/min) still lets one visitor add
 * ~43,000 views a day. This keeps one counted view per client IP per resource
 * per 30 minutes.
 *
 * Backend: Redis (`SET NX EX`) when REDIS_URL is configured, so every replica
 * agrees; otherwise, or if Redis errors, a bounded in-process map. The raw IP
 * is never stored anywhere: it is HMAC-ed first. The HMAC key derives from
 * JWT_SECRET so replicas sharing a Redis produce the same digest; without it a
 * random per-process key is used (fine for the in-process map, which is
 * per-process anyway).
 */
@Injectable()
export class ViewDedupService {
  private readonly logger = new Logger(ViewDedupService.name);
  private readonly hashKey: Buffer;
  private readonly local = new ExpiringClaimSet(VIEW_DEDUP_WINDOW_SECONDS * 1000, VIEW_DEDUP_MAX_LOCAL_ENTRIES);

  constructor(
    private readonly redis: RedisService,
    @Optional() config?: ConfigService,
  ) {
    const secret = config?.get<string>('JWT_SECRET');
    this.hashKey = secret ? deriveKey(secret, DEDUP_KEY_INFO) : randomBytes(32);
  }

  /**
   * True when this is the first view of `resourceId` from `ip` inside the
   * window (count it); false when it is a repeat (do not count it). An unknown
   * IP cannot be deduplicated and always counts.
   */
  async claim(scope: string, resourceId: string, ip: string | undefined | null): Promise<boolean> {
    if (!ip) return true;
    const key = this.keyFor(scope, resourceId, ip);

    const client = this.redis.getClient();
    if (client) {
      try {
        return (await client.set(key, '1', 'EX', VIEW_DEDUP_WINDOW_SECONDS, 'NX')) === 'OK';
      } catch (err) {
        // A Redis blip must not drop or double-count views: degrade to the
        // per-process map until it recovers.
        this.logger.warn(`Redis view-dedup claim failed, using the in-process map: ${err}`);
      }
    }
    return this.local.claim(key);
  }

  /** Forget a claim — used when the view turned out not to apply (unknown or unpublished resource). */
  async release(scope: string, resourceId: string, ip: string | undefined | null): Promise<void> {
    if (!ip) return;
    const key = this.keyFor(scope, resourceId, ip);
    this.local.release(key);
    const client = this.redis.getClient();
    if (!client) return;
    try {
      await client.del(key);
    } catch (err) {
      this.logger.warn(`Redis view-dedup release failed: ${err}`);
    }
  }

  private keyFor(scope: string, resourceId: string, ip: string): string {
    return `view-dedup:${scope}:${resourceId}:${hmacHex(this.hashKey, ip).slice(0, 32)}`;
  }
}
