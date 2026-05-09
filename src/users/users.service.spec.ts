import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { UsersService } from './users.service';
import { PrismaService } from '../prisma/prisma.service';

jest.mock('bcryptjs');

const baseUser = {
  id: 'user-1',
  username: 'alice',
  password_hash: '$2a$12$hash',
  created_at: new Date(),
  updated_at: new Date(),
  deleted_at: null,
  user_roles: [],
};

describe('UsersService', () => {
  let service: UsersService;
  let prisma: any;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        {
          provide: PrismaService,
          useValue: {
            users: {
              findMany: jest.fn(),
              findFirst: jest.fn(),
              count: jest.fn(),
              create: jest.fn(),
              update: jest.fn(),
            },
            user_roles: {
              upsert: jest.fn(),
              delete: jest.fn(),
            },
            roles: { findUnique: jest.fn() },
            audit_logs: { create: jest.fn().mockResolvedValue({}) },
          },
        },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
    prisma = module.get(PrismaService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('findAll', () => {
    it('returns paginated users', async () => {
      prisma.users.findMany.mockResolvedValue([baseUser]);
      prisma.users.count.mockResolvedValue(1);

      const result = await service.findAll(1, 10);

      expect(result.data.items).toHaveLength(1);
      expect(result.data.pagination).toEqual({ page: 1, limit: 10, total: 1, pages: 1 });
    });

    it('calculates skip from page and limit', async () => {
      prisma.users.findMany.mockResolvedValue([]);
      prisma.users.count.mockResolvedValue(0);

      await service.findAll(3, 10);

      expect(prisma.users.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 20, take: 10 }),
      );
    });
  });

  describe('findOne', () => {
    it('returns user with aggregated permissions', async () => {
      const userWithRoles = {
        ...baseUser,
        user_roles: [
          {
            roles: {
              name: 'Admin',
              role_permissions: [{ permissions: { name: 'users:read' } }],
            },
          },
        ],
      };
      prisma.users.findFirst.mockResolvedValue(userWithRoles);

      const result = await service.findOne('user-1');

      expect(result.data.id).toBe('user-1');
      expect(result.data.permissions).toContain('users:read');
      expect(result.data).not.toHaveProperty('password_hash');
    });

    it('throws NotFoundException when user not found', async () => {
      prisma.users.findFirst.mockResolvedValue(null);

      await expect(service.findOne('ghost')).rejects.toThrow(NotFoundException);
    });
  });

  describe('create', () => {
    it('creates user and returns without password_hash', async () => {
      prisma.users.findFirst.mockResolvedValue(null);
      (bcrypt.hash as jest.Mock).mockResolvedValue('$2a$12$newhash');
      prisma.users.create.mockResolvedValue({ ...baseUser, password_hash: '$2a$12$newhash' });

      const result = await service.create({ username: 'alice', password: 'secret' }, 'actor-1');

      expect(result.data).not.toHaveProperty('password_hash');
      expect(result.message).toBe('User created');
    });

    it('throws ConflictException when username already taken', async () => {
      prisma.users.findFirst.mockResolvedValue(baseUser);

      await expect(
        service.create({ username: 'alice', password: 'secret' }, 'actor-1'),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('update', () => {
    it('updates user successfully', async () => {
      prisma.users.findFirst.mockResolvedValueOnce(baseUser).mockResolvedValue(null);
      prisma.users.update.mockResolvedValue({ ...baseUser, username: 'alice2', password_hash: 'hash' });

      const result = await service.update('user-1', { username: 'alice2' }, 'actor-1');

      expect(result.data).not.toHaveProperty('password_hash');
    });

    it('throws NotFoundException when user not found', async () => {
      prisma.users.findFirst.mockResolvedValue(null);

      await expect(service.update('ghost', {}, 'actor-1')).rejects.toThrow(NotFoundException);
    });

    it('throws ConflictException when new username is taken', async () => {
      prisma.users.findFirst
        .mockResolvedValueOnce(baseUser)
        .mockResolvedValueOnce({ ...baseUser, id: 'user-2', username: 'bob' });

      await expect(
        service.update('user-1', { username: 'bob' }, 'actor-1'),
      ).rejects.toThrow(ConflictException);
    });

    it('does not check username conflict when username is unchanged', async () => {
      prisma.users.findFirst.mockResolvedValueOnce(baseUser);
      prisma.users.update.mockResolvedValue({ ...baseUser, password_hash: 'hash' });

      await service.update('user-1', { username: 'alice' }, 'actor-1');

      expect(prisma.users.findFirst).toHaveBeenCalledTimes(1);
    });
  });

  describe('softDelete', () => {
    it('sets deleted_at on the user', async () => {
      prisma.users.findFirst.mockResolvedValue(baseUser);
      prisma.users.update.mockResolvedValue({});

      const result = await service.softDelete('user-1', 'actor-1');

      expect(prisma.users.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ deleted_at: expect.any(Date) }) }),
      );
      expect(result.message).toBe('User deleted');
    });

    it('throws NotFoundException when user not found', async () => {
      prisma.users.findFirst.mockResolvedValue(null);

      await expect(service.softDelete('ghost', 'actor-1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('assignRole', () => {
    it('upserts user_roles record', async () => {
      prisma.users.findFirst.mockResolvedValue(baseUser);
      prisma.roles.findUnique.mockResolvedValue({ id: 'role-1', name: 'Admin' });
      prisma.user_roles.upsert.mockResolvedValue({});

      const result = await service.assignRole('user-1', { role_id: 'role-1' }, 'actor-1');

      expect(prisma.user_roles.upsert).toHaveBeenCalled();
      expect(result.message).toBe('Role assigned');
    });

    it('throws NotFoundException when user not found', async () => {
      prisma.users.findFirst.mockResolvedValue(null);
      prisma.roles.findUnique.mockResolvedValue({ id: 'role-1', name: 'Admin' });

      await expect(
        service.assignRole('ghost', { role_id: 'role-1' }, 'actor-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when role not found', async () => {
      prisma.users.findFirst.mockResolvedValue(baseUser);
      prisma.roles.findUnique.mockResolvedValue(null);

      await expect(
        service.assignRole('user-1', { role_id: 'ghost' }, 'actor-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('removeRole', () => {
    it('deletes user_roles record', async () => {
      prisma.users.findFirst.mockResolvedValue(baseUser);
      prisma.user_roles.delete.mockResolvedValue({});

      const result = await service.removeRole('user-1', 'role-1', 'actor-1');

      expect(prisma.user_roles.delete).toHaveBeenCalled();
      expect(result.message).toBe('Role removed');
    });

    it('throws NotFoundException when user not found', async () => {
      prisma.users.findFirst.mockResolvedValue(null);

      await expect(service.removeRole('ghost', 'role-1', 'actor-1')).rejects.toThrow(NotFoundException);
    });
  });
});
