import { Injectable, OnModuleInit, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';

// In-process cache of the user row we need on every authenticated request.
// JWTs already prove the token was signed by us and not expired; the only
// reason to hit the DB is to verify the user hasn't been soft-deleted and
// the token_version is still current. Both change rarely (admin actions),
// so a short TTL is safe. Cuts ~one DB round-trip per authenticated request.
const USER_CACHE_TTL_MS = 30_000;

// Pub/sub channel name for cross-instance cache invalidation. When one
// instance handles a password change / admin reset / soft delete, it
// publishes the user id; every other instance (subscribed via RedisService)
// drops its local cache entry within milliseconds. Without Redis the
// invalidation is local-only, and other instances serve the stale row for
// up to USER_CACHE_TTL_MS — accepted trade for single-instance deployments.
const JWT_CACHE_CHANNEL = 'jwt-cache:invalidate';

interface CachedUser {
  id: string;
  username: string;
  token_version: number;
  deleted: boolean;
  expiresAt: number;
}

const userCache = new Map<string, CachedUser>();

function cacheGet(id: string): CachedUser | null {
  const entry = userCache.get(id);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    userCache.delete(id);
    return null;
  }
  return entry;
}

function cacheSet(id: string, user: Omit<CachedUser, 'expiresAt'>): void {
  // Trim aggressively when the map grows beyond a soft cap. A real LRU would
  // be better but this keeps the strategy file self-contained.
  if (userCache.size > 10_000) {
    const cutoff = Date.now();
    for (const [k, v] of userCache) {
      if (v.expiresAt < cutoff) userCache.delete(k);
    }
  }
  userCache.set(id, { ...user, expiresAt: Date.now() + USER_CACHE_TTL_MS });
}

function cacheDelete(id: string): void {
  userCache.delete(id);
}

// Module-level reference to the RedisService, populated in onModuleInit.
// Lets the free-function `invalidateJwtUserCache` publish without requiring
// every caller to inject the strategy.
let redisRef: RedisService | null = null;

/**
 * Invalidate the cached row for a user across all instances. Local cache is
 * dropped immediately; Redis publishes an invalidation message so peers
 * drop their copies as well. Safe to call when Redis isn't configured —
 * other instances will simply age out the entry after USER_CACHE_TTL_MS.
 */
export function invalidateJwtUserCache(userId: string): void {
  cacheDelete(userId);
  // Fire-and-forget across instances; ordering doesn't matter and a missed
  // publish just means the peer ages out the stale row naturally.
  void redisRef?.publish(JWT_CACHE_CHANNEL, userId);
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    config: ConfigService,
  ) {
    // env validation guarantees JWT_SECRET is present before this module
    // is instantiated. Falling back to '' would silently accept tokens
    // signed with the empty secret, so we throw instead.
    const secret = config.get<string>('JWT_SECRET');
    if (!secret) {
      throw new Error('JWT_SECRET is required');
    }
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
    });
  }

  async onModuleInit(): Promise<void> {
    redisRef = this.redis;
    await this.redis.subscribe(JWT_CACHE_CHANNEL, (_channel, userId) => {
      cacheDelete(userId);
    });
  }

  async validate(payload: { sub: string; username: string; permissions: string[]; token_version?: number }) {
    let cached = cacheGet(payload.sub);
    if (!cached) {
      const row = await this.prisma.users.findUnique({
        where: { id: payload.sub },
        select: { id: true, username: true, token_version: true, deleted_at: true },
      });
      if (!row) throw new UnauthorizedException();
      cached = {
        id: row.id,
        username: row.username,
        token_version: row.token_version,
        deleted: row.deleted_at !== null,
        expiresAt: 0,
      };
      cacheSet(row.id, cached);
    }

    if (cached.deleted) throw new UnauthorizedException();

    if (payload.token_version !== undefined && cached.token_version !== payload.token_version) {
      throw new UnauthorizedException('Token has been invalidated');
    }

    return { id: cached.id, username: cached.username, permissions: payload.permissions };
  }
}
