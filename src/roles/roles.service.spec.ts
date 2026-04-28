import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { RolesService } from './roles.service';
import { PrismaService } from '../prisma/prisma.service';

const baseRole = { id: 'role-1', name: 'Admin' };

describe('RolesService', () => {
  let service: RolesService;
  let prisma: any;

  const mockTx = {
    roles: { create: jest.fn(), update: jest.fn(), delete: jest.fn() },
    role_translations: { createMany: jest.fn(), upsert: jest.fn(), deleteMany: jest.fn() },
    role_permissions: { deleteMany: jest.fn() },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RolesService,
        {
          provide: PrismaService,
          useValue: {
            roles: {
              findMany: jest.fn(),
              findUnique: jest.fn(),
              findFirst: jest.fn(),
              create: jest.fn(),
              update: jest.fn(),
              delete: jest.fn(),
            },
            role_translations: { createMany: jest.fn(), upsert: jest.fn(), deleteMany: jest.fn() },
            role_permissions: {
              upsert: jest.fn(),
              delete: jest.fn(),
              deleteMany: jest.fn(),
            },
            user_roles: { count: jest.fn() },
            permissions: { findMany: jest.fn() },
            audit_logs: { create: jest.fn().mockResolvedValue({}) },
            $transaction: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<RolesService>(RolesService);
    prisma = module.get(PrismaService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('findAll', () => {
    it('filters role and permission translations by lang when Accept-Language is set', async () => {
      const role = { ...baseRole, role_translations: [{ lang: 'ar', title: 'مدير' }], role_permissions: [] };
      prisma.roles.findMany.mockResolvedValue([role]);

      const result = await service.findAll('ar');

      expect(prisma.roles.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          include: expect.objectContaining({
            role_translations: { where: { lang: 'ar' } },
          }),
        }),
      );
      expect(result.data[0].role_translations[0].lang).toBe('ar');
    });

    it('returns all translations when no lang specified', async () => {
      prisma.roles.findMany.mockResolvedValue([baseRole]);

      await service.findAll(null);

      expect(prisma.roles.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          include: expect.objectContaining({ role_translations: true }),
        }),
      );
    });
  });

  describe('findOne', () => {
    it('filters translations by lang and returns role', async () => {
      const role = { ...baseRole, role_translations: [{ lang: 'en', title: 'Admin' }], role_permissions: [] };
      prisma.roles.findUnique.mockResolvedValue(role);

      const result = await service.findOne('role-1', 'en');

      expect(prisma.roles.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          include: expect.objectContaining({
            role_translations: { where: { lang: 'en' } },
          }),
        }),
      );
      expect(result.data.id).toBe('role-1');
      expect(result.data.role_translations[0].lang).toBe('en');
    });

    it('returns all translations when no lang specified', async () => {
      prisma.roles.findUnique.mockResolvedValue(baseRole);

      await service.findOne('role-1', null);

      expect(prisma.roles.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          include: expect.objectContaining({ role_translations: true }),
        }),
      );
    });

    it('throws NotFoundException when not found', async () => {
      prisma.roles.findUnique.mockResolvedValue(null);

      await expect(service.findOne('ghost', null)).rejects.toThrow(NotFoundException);
    });
  });

  describe('create', () => {
    it('creates role with translations inside a transaction', async () => {
      prisma.roles.findFirst.mockResolvedValue(null);
      mockTx.roles.create.mockResolvedValue(baseRole);
      mockTx.role_translations.createMany.mockResolvedValue({});
      prisma.$transaction.mockImplementation((cb) => cb(mockTx));

      const result = await service.create(
        { name: 'Admin', translations: [{ lang: 'ar', title: 'مدير' }] },
        'actor-1',
      );

      expect(mockTx.roles.create).toHaveBeenCalled();
      expect(mockTx.role_translations.createMany).toHaveBeenCalled();
      expect(result.data.id).toBe('role-1');
    });

    it('throws ConflictException when name already exists', async () => {
      prisma.roles.findFirst.mockResolvedValue(baseRole);

      await expect(
        service.create({ name: 'Admin', translations: [] }, 'actor-1'),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('update', () => {
    it('updates role name and upserts translations', async () => {
      prisma.roles.findUnique.mockResolvedValue(baseRole);
      prisma.roles.findFirst.mockResolvedValue(null);
      mockTx.roles.update.mockResolvedValue({ ...baseRole, name: 'SuperAdmin' });
      mockTx.role_translations.upsert.mockResolvedValue({});
      prisma.$transaction.mockImplementation((cb) => cb(mockTx));

      const result = await service.update(
        'role-1',
        { name: 'SuperAdmin', translations: [{ lang: 'ar', title: 'مدير عام' }] },
        'actor-1',
      );

      expect(mockTx.roles.update).toHaveBeenCalled();
      expect(result.message).toBe('Role updated');
    });

    it('throws NotFoundException when role not found', async () => {
      prisma.roles.findUnique.mockResolvedValue(null);

      await expect(service.update('ghost', {}, 'actor-1')).rejects.toThrow(NotFoundException);
    });

    it('throws ConflictException when new name already taken', async () => {
      prisma.roles.findUnique.mockResolvedValue(baseRole);
      prisma.roles.findFirst.mockResolvedValue({ id: 'role-2', name: 'Editor' });

      await expect(
        service.update('role-1', { name: 'Editor' }, 'actor-1'),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('delete', () => {
    it('deletes role and its translations + permissions in a transaction', async () => {
      prisma.roles.findUnique.mockResolvedValue(baseRole);
      prisma.user_roles.count.mockResolvedValue(0);
      mockTx.role_permissions.deleteMany.mockResolvedValue({});
      mockTx.role_translations.deleteMany.mockResolvedValue({});
      mockTx.roles.delete.mockResolvedValue({});
      prisma.$transaction.mockImplementation((cb) => cb(mockTx));

      const result = await service.delete('role-1', 'actor-1');

      expect(mockTx.role_permissions.deleteMany).toHaveBeenCalled();
      expect(mockTx.role_translations.deleteMany).toHaveBeenCalled();
      expect(mockTx.roles.delete).toHaveBeenCalled();
      expect(result.message).toBe('Role deleted');
    });

    it('throws NotFoundException when role not found', async () => {
      prisma.roles.findUnique.mockResolvedValue(null);

      await expect(service.delete('ghost', 'actor-1')).rejects.toThrow(NotFoundException);
    });

    it('throws ConflictException when role is assigned to users', async () => {
      prisma.roles.findUnique.mockResolvedValue(baseRole);
      prisma.user_roles.count.mockResolvedValue(3);

      await expect(service.delete('role-1', 'actor-1')).rejects.toThrow(ConflictException);
    });
  });

  describe('assignPermission', () => {
    it('upserts role_permissions record', async () => {
      prisma.roles.findUnique.mockResolvedValue(baseRole);
      prisma.role_permissions.upsert.mockResolvedValue({});

      const result = await service.assignPermission('role-1', { permissionId: 'perm-1' }, 'actor-1');

      expect(prisma.role_permissions.upsert).toHaveBeenCalled();
      expect(result.message).toBe('Permission assigned');
    });

    it('throws NotFoundException when role not found', async () => {
      prisma.roles.findUnique.mockResolvedValue(null);

      await expect(
        service.assignPermission('ghost', { permissionId: 'perm-1' }, 'actor-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('removePermission', () => {
    it('deletes role_permissions record', async () => {
      prisma.role_permissions.delete.mockResolvedValue({});

      const result = await service.removePermission('role-1', 'perm-1', 'actor-1');

      expect(prisma.role_permissions.delete).toHaveBeenCalled();
      expect(result.message).toBe('Permission removed');
    });
  });

  describe('findAllPermissions', () => {
    it('filters permission translations by lang when Accept-Language is set', async () => {
      const perm = { id: 'p1', name: 'users:read', permission_translations: [{ lang: 'ar', title: 'عرض المستخدمين' }] };
      prisma.permissions.findMany.mockResolvedValue([perm]);

      const result = await service.findAllPermissions('ar');

      expect(prisma.permissions.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          include: { permission_translations: { where: { lang: 'ar' } } },
        }),
      );
      expect(result.data[0].permission_translations[0].lang).toBe('ar');
    });

    it('returns all translations when no lang specified', async () => {
      prisma.permissions.findMany.mockResolvedValue([{ id: 'p1', name: 'users:read' }]);

      await service.findAllPermissions(null);

      expect(prisma.permissions.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          include: { permission_translations: true },
        }),
      );
    });
  });
});
