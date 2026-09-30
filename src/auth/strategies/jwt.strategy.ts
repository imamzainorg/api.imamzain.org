import { ForbiddenException, Injectable, OnModuleInit, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';
import { TtlCache } from '../../common/utils/ttl-cache.util';
import { isPasswordChangeEnforced, isPasswordChangeExemptPath } from '../auth-config.util';

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

/** The one algorithm access tokens are signed and verified with (see AuthModule). */
export const JWT_ALGORITHM = 'HS256' as const;

interface CachedUser {
  id: string;
  username: string;
  token_version: number;
  deleted: boolean;
  must_change_password: boolean;
}

const userCache = new TtlCache<CachedUser>(USER_CACHE_TTL_MS);

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
  userCache.delete(userId);
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
      // Never let the token's own header choose the verification algorithm.
      algorithms: [JWT_ALGORITHM],
      // validate() needs the request to tell which route is being called (the
      // forced-password-change gate exempts a handful of them).
      passReqToCallback: true,
    });
  }

  async onModuleInit(): Promise<void> {
    redisRef = this.redis;
    await this.redis.subscribe(JWT_CACHE_CHANNEL, (_channel, userId) => {
      userCache.delete(userId);
    });
  }

  async validate(
    req: { originalUrl?: string; url?: string },
    payload: { sub: string; username: string; permissions: string[]; token_version?: number },
  ) {
    let cached = userCache.get(payload.sub);
    if (!cached) {
      const row = await this.prisma.users.findUnique({
        where: { id: payload.sub },
        select: { id: true, username: true, token_version: true, deleted_at: true, must_change_password: true },
      });
      if (!row) throw new UnauthorizedException();
      cached = {
        id: row.id,
        username: row.username,
        token_version: row.token_version,
        deleted: row.deleted_at !== null,
        must_change_password: row.must_change_password,
      };
      userCache.set(row.id, cached);
    }

    if (cached.deleted) throw new UnauthorizedException();

    if (payload.token_version !== undefined && cached.token_version !== payload.token_version) {
      throw new UnauthorizedException('Token has been invalidated');
    }

    // An admin set this password, so it is not a secret the user chose. Opt-in
    // (see isPasswordChangeEnforced): until the CMS ships its change-password
    // screen, blocking here would lock every reset user out.
    if (
      cached.must_change_password &&
      isPasswordChangeEnforced() &&
      !isPasswordChangeExemptPath(req.originalUrl ?? req.url)
    ) {
      throw new ForbiddenException({
        message: 'You must change your password before continuing',
        code: 'PASSWORD_CHANGE_REQUIRED',
      });
    }

    return { id: cached.id, username: cached.username, permissions: payload.permissions };
  }
}
