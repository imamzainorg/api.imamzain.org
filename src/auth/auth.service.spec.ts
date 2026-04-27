import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';

jest.mock('bcryptjs');

const mockUser = {
  id: 'user-1',
  username: 'admin',
  password_hash: '$2a$12$hashed',
  created_at: new Date('2024-01-01'),
  deleted_at: null,
  user_roles: [
    {
      roles: {
        name: 'Admin',
        role_permissions: [
          { permissions: { name: 'users:read' } },
          { permissions: { name: 'users:write' } },
        ],
      },
    },
  ],
};

describe('AuthService', () => {
  let service: AuthService;
  let prisma: any;
  let jwtService: any;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: PrismaService,
          useValue: {
            users: {
              findFirst: jest.fn(),
              update: jest.fn(),
            },
            audit_logs: { create: jest.fn().mockResolvedValue({}) },
          },
        },
        {
          provide: JwtService,
          useValue: { sign: jest.fn().mockReturnValue('mock-jwt-token') },
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    prisma = module.get(PrismaService);
    jwtService = module.get(JwtService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('login', () => {
    it('returns accessToken and user on valid credentials', async () => {
      prisma.users.findFirst.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const result = await service.login(
        { username: 'admin', password: 'secret' },
        '127.0.0.1',
        'TestAgent',
      );

      expect(result.data.accessToken).toBe('mock-jwt-token');
      expect(result.data.user.username).toBe('admin');
      expect(result.data.user.roles).toContain('Admin');
      expect(result.data.user.permissions).toContain('users:read');
      expect(result.data.user.permissions).toContain('users:write');
    });

    it('deduplicates permissions coming from multiple roles', async () => {
      const multiRoleUser = {
        ...mockUser,
        user_roles: [
          {
            roles: {
              name: 'Admin',
              role_permissions: [{ permissions: { name: 'posts:read' } }],
            },
          },
          {
            roles: {
              name: 'Editor',
              role_permissions: [
                { permissions: { name: 'posts:read' } },
                { permissions: { name: 'posts:write' } },
              ],
            },
          },
        ],
      };
      prisma.users.findFirst.mockResolvedValue(multiRoleUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const result = await service.login(
        { username: 'admin', password: 'secret' },
        '127.0.0.1',
        'agent',
      );

      const perms = result.data.user.permissions;
      expect(perms.filter((p) => p === 'posts:read').length).toBe(1);
      expect(perms).toContain('posts:write');
    });

    it('throws UnauthorizedException when user not found', async () => {
      prisma.users.findFirst.mockResolvedValue(null);

      await expect(
        service.login({ username: 'ghost', password: 'x' }, '127.0.0.1', 'agent'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException on wrong password', async () => {
      prisma.users.findFirst.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(
        service.login({ username: 'admin', password: 'wrong' }, '127.0.0.1', 'agent'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('still succeeds even if audit_logs.create throws', async () => {
      prisma.users.findFirst.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      prisma.audit_logs.create.mockRejectedValue(new Error('DB error'));

      const result = await service.login(
        { username: 'admin', password: 'secret' },
        '127.0.0.1',
        'agent',
      );

      expect(result.data.accessToken).toBe('mock-jwt-token');
    });
  });

  describe('getMe', () => {
    it('returns profile with roles and permissions', async () => {
      prisma.users.findFirst.mockResolvedValue(mockUser);

      const result = await service.getMe('user-1');

      expect(result.data.id).toBe('user-1');
      expect(result.data.username).toBe('admin');
      expect(result.data.roles).toContain('Admin');
      expect(result.data.permissions).toContain('users:read');
    });

    it('throws UnauthorizedException when user not found', async () => {
      prisma.users.findFirst.mockResolvedValue(null);

      await expect(service.getMe('nonexistent')).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('changePassword', () => {
    it('updates password_hash on correct current password', async () => {
      prisma.users.findFirst.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      (bcrypt.hash as jest.Mock).mockResolvedValue('$2a$12$newhash');
      prisma.users.update.mockResolvedValue({});

      const result = await service.changePassword(
        'user-1',
        { currentPassword: 'old', newPassword: 'new' },
        '127.0.0.1',
      );

      expect(prisma.users.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'user-1' },
          data: expect.objectContaining({ password_hash: '$2a$12$newhash' }),
        }),
      );
      expect(result.message).toBe('Password changed successfully');
    });

    it('throws UnauthorizedException when user not found', async () => {
      prisma.users.findFirst.mockResolvedValue(null);

      await expect(
        service.changePassword('ghost', { currentPassword: 'x', newPassword: 'y' }, '127.0.0.1'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException on wrong current password', async () => {
      prisma.users.findFirst.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(
        service.changePassword('user-1', { currentPassword: 'wrong', newPassword: 'new' }, '127.0.0.1'),
      ).rejects.toThrow(UnauthorizedException);
    });
  });
});
