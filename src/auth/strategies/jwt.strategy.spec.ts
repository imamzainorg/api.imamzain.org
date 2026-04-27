import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { JwtStrategy } from './jwt.strategy';
import { PrismaService } from '../../prisma/prisma.service';

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
            users: { findFirst: jest.fn() },
          },
        },
      ],
    }).compile();

    strategy = module.get<JwtStrategy>(JwtStrategy);
    prisma = module.get(PrismaService);
  });

  afterEach(() => jest.clearAllMocks());

  it('returns user payload when user exists', async () => {
    prisma.users.findFirst.mockResolvedValue({ id: 'user-1', username: 'admin', deleted_at: null });

    const result = await strategy.validate({
      sub: 'user-1',
      username: 'admin',
      permissions: ['users:read'],
    });

    expect(result).toEqual({ id: 'user-1', username: 'admin', permissions: ['users:read'] });
  });

  it('throws UnauthorizedException when user not found', async () => {
    prisma.users.findFirst.mockResolvedValue(null);

    await expect(
      strategy.validate({ sub: 'ghost', username: 'ghost', permissions: [] }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('queries by sub and deleted_at null', async () => {
    prisma.users.findFirst.mockResolvedValue({ id: 'u1', username: 'u', deleted_at: null });

    await strategy.validate({ sub: 'u1', username: 'u', permissions: [] });

    expect(prisma.users.findFirst).toHaveBeenCalledWith({
      where: { id: 'u1', deleted_at: null },
    });
  });
});
