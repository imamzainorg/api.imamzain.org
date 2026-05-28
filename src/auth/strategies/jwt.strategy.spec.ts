import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtStrategy, invalidateJwtUserCache } from './jwt.strategy';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';

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
    prisma.users.findUnique.mockResolvedValue({ id: 'user-1', username: 'admin', token_version: 1, deleted_at: null });

    const result = await strategy.validate({
      sub: 'user-1',
      username: 'admin',
      permissions: ['users:read'],
    });

    expect(result).toEqual({ id: 'user-1', username: 'admin', permissions: ['users:read'] });
  });

  it('throws UnauthorizedException when user not found', async () => {
    prisma.users.findUnique.mockResolvedValue(null);

    await expect(
      strategy.validate({ sub: 'ghost', username: 'ghost', permissions: [] }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('queries by sub via findUnique with the cached fields', async () => {
    prisma.users.findUnique.mockResolvedValue({ id: 'u1', username: 'u', token_version: 1, deleted_at: null });

    await strategy.validate({ sub: 'u1', username: 'u', permissions: [] });

    expect(prisma.users.findUnique).toHaveBeenCalledWith({
      where: { id: 'u1' },
      select: { id: true, username: true, token_version: true, deleted_at: true },
    });
  });

  it('rejects soft-deleted users', async () => {
    prisma.users.findUnique.mockResolvedValue({
      id: 'gone-user',
      username: 'gone',
      token_version: 1,
      deleted_at: new Date(),
    });

    await expect(
      strategy.validate({ sub: 'gone-user', username: 'gone', permissions: [] }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('rejects tokens with an out-of-date token_version', async () => {
    prisma.users.findUnique.mockResolvedValue({ id: 'tv-user', username: 'tv', token_version: 5, deleted_at: null });

    await expect(
      strategy.validate({ sub: 'tv-user', username: 'tv', permissions: [], token_version: 4 }),
    ).rejects.toThrow(UnauthorizedException);
    invalidateJwtUserCache('tv-user');
  });
});
