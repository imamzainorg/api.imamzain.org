import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtStrategy, invalidateJwtUserCache } from './jwt.strategy';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';

// The strategy is handed the request so it can tell which route is being called.
const req = { originalUrl: '/api/v1/posts' };

const userRow = (over: Record<string, unknown> = {}) => ({
  id: 'user-1',
  username: 'admin',
  token_version: 1,
  deleted_at: null,
  must_change_password: false,
  ...over,
});

describe('JwtStrategy', () => {
  let strategy: JwtStrategy;
  let prisma: any;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JwtStrategy,
        {
          provide: PrismaService,
          useValue: {
            users: { findUnique: jest.fn() },
          },
        },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue('test-secret') },
        },
        {
          provide: RedisService,
          useValue: {
            isEnabled: jest.fn().mockReturnValue(false),
            publish: jest.fn().mockResolvedValue(undefined),
            subscribe: jest.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile();

    strategy = module.get<JwtStrategy>(JwtStrategy);
    prisma = module.get(PrismaService);
  });

  afterEach(() => {
    jest.clearAllMocks();
    // Each test uses a fresh user id, but invalidate just in case to keep the
    // in-process cache from leaking across cases.
    invalidateJwtUserCache('user-1');
    invalidateJwtUserCache('ghost');
    invalidateJwtUserCache('u1');
  });

  it('returns user payload when user exists', async () => {
    prisma.users.findUnique.mockResolvedValue(userRow());

    const result = await strategy.validate(req, {
      sub: 'user-1',
      username: 'admin',
      permissions: ['users:read'],
    });

    expect(result).toEqual({ id: 'user-1', username: 'admin', permissions: ['users:read'] });
  });

  it('throws UnauthorizedException when user not found', async () => {
    prisma.users.findUnique.mockResolvedValue(null);

    await expect(
      strategy.validate(req, { sub: 'ghost', username: 'ghost', permissions: [] }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('queries by sub via findUnique with the cached fields', async () => {
    prisma.users.findUnique.mockResolvedValue(userRow({ id: 'u1', username: 'u' }));

    await strategy.validate(req, { sub: 'u1', username: 'u', permissions: [] });

    expect(prisma.users.findUnique).toHaveBeenCalledWith({
      where: { id: 'u1' },
      select: { id: true, username: true, token_version: true, deleted_at: true, must_change_password: true },
    });
  });

  it('serves the second call from cache without re-querying the DB', async () => {
    prisma.users.findUnique.mockResolvedValue(userRow({ id: 'cache-hit-user', username: 'cache-hit' }));
    const payload = { sub: 'cache-hit-user', username: 'cache-hit', permissions: ['posts:read'] };

    const first = await strategy.validate(req, payload);
    const second = await strategy.validate(req, payload);

    expect(prisma.users.findUnique).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
    invalidateJwtUserCache('cache-hit-user');
  });

  it('rejects soft-deleted users', async () => {
    prisma.users.findUnique.mockResolvedValue(
      userRow({ id: 'gone-user', username: 'gone', deleted_at: new Date() }),
    );

    await expect(
      strategy.validate(req, { sub: 'gone-user', username: 'gone', permissions: [] }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('rejects tokens with an out-of-date token_version', async () => {
    prisma.users.findUnique.mockResolvedValue(userRow({ id: 'tv-user', username: 'tv', token_version: 5 }));

    await expect(
      strategy.validate(req, { sub: 'tv-user', username: 'tv', permissions: [], token_version: 4 }),
    ).rejects.toThrow(UnauthorizedException);
    invalidateJwtUserCache('tv-user');
  });

  describe('forced password change after an admin reset', () => {
    const original = process.env.ENFORCE_PASSWORD_CHANGE_AFTER_RESET;
    const flagged = () => userRow({ id: 'reset-user', username: 'reset', must_change_password: true });
    const payload = { sub: 'reset-user', username: 'reset', permissions: ['posts:read'] };

    afterEach(() => {
      if (original === undefined) delete process.env.ENFORCE_PASSWORD_CHANGE_AFTER_RESET;
      else process.env.ENFORCE_PASSWORD_CHANGE_AFTER_RESET = original;
      invalidateJwtUserCache('reset-user');
    });

    describe('enforcement OFF (the default)', () => {
      beforeEach(() => {
        delete process.env.ENFORCE_PASSWORD_CHANGE_AFTER_RESET;
      });

      it('lets a flagged account use every route', async () => {
        prisma.users.findUnique.mockResolvedValue(flagged());

        await expect(strategy.validate({ originalUrl: '/api/v1/posts' }, payload)).resolves.toEqual({
          id: 'reset-user',
          username: 'reset',
          permissions: ['posts:read'],
        });
      });

      it('treats the word false the same as unset', async () => {
        process.env.ENFORCE_PASSWORD_CHANGE_AFTER_RESET = 'false';
        prisma.users.findUnique.mockResolvedValue(flagged());

        await expect(strategy.validate({ originalUrl: '/api/v1/users' }, payload)).resolves.toBeDefined();
      });
    });

    describe('enforcement ON', () => {
      beforeEach(() => {
        process.env.ENFORCE_PASSWORD_CHANGE_AFTER_RESET = 'true';
      });

      it('answers 403 PASSWORD_CHANGE_REQUIRED on any other route', async () => {
        prisma.users.findUnique.mockResolvedValue(flagged());

        const err = await strategy.validate({ originalUrl: '/api/v1/posts?page=2' }, payload).catch((e) => e);

        expect(err).toBeInstanceOf(ForbiddenException);
        expect(err.getStatus()).toBe(403);
        expect(err.getResponse()).toMatchObject({ code: 'PASSWORD_CHANGE_REQUIRED' });
      });

      it.each([
        '/api/v1/auth/me',
        '/api/v1/auth/me/password',
        '/api/v1/auth/logout',
        '/api/v1/auth/refresh',
      ])('still lets the flagged account reach %s', async (originalUrl) => {
        prisma.users.findUnique.mockResolvedValue(flagged());

        await expect(strategy.validate({ originalUrl }, payload)).resolves.toBeDefined();
      });

      it('does not touch an account that is not flagged', async () => {
        prisma.users.findUnique.mockResolvedValue(userRow({ id: 'reset-user', username: 'reset' }));

        await expect(strategy.validate({ originalUrl: '/api/v1/posts' }, payload)).resolves.toBeDefined();
      });

      it('applies right after the flag is set, once the cache entry is invalidated', async () => {
        prisma.users.findUnique.mockResolvedValueOnce(userRow({ id: 'reset-user', username: 'reset' }));
        await strategy.validate({ originalUrl: '/api/v1/posts' }, payload);

        invalidateJwtUserCache('reset-user');
        prisma.users.findUnique.mockResolvedValueOnce(flagged());

        await expect(strategy.validate({ originalUrl: '/api/v1/posts' }, payload)).rejects.toThrow(ForbiddenException);
      });

      it('still rejects a stale token_version before the password gate', async () => {
        prisma.users.findUnique.mockResolvedValue({ ...flagged(), token_version: 9 });

        await expect(
          strategy.validate({ originalUrl: '/api/v1/auth/me' }, { ...payload, token_version: 3 }),
        ).rejects.toThrow(UnauthorizedException);
      });
    });
  });
});
