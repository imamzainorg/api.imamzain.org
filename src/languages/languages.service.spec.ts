import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { LanguagesService } from './languages.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit/audit.service';

const baseLang = {
  code: 'ar',
  name: 'Arabic',
  native_name: 'العربية',
  is_active: true,
  deleted_at: null,
};

describe('LanguagesService', () => {
  let service: LanguagesService;
  let prisma: any;
  let audit: { write: jest.Mock };

  beforeEach(async () => {
    audit = { write: jest.fn().mockResolvedValue(true) };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LanguagesService,
        {
          provide: PrismaService,
          useValue: {
            languages: {
              findMany: jest.fn(),
              findFirst: jest.fn(),
              findUnique: jest.fn().mockResolvedValue(null),
              create: jest.fn(),
              update: jest.fn().mockResolvedValue({}),
            },
            audit_logs: { create: jest.fn().mockResolvedValue({}) },
          },
        },
        { provide: AuditService, useValue: audit },
      ],
    }).compile();

    service = module.get<LanguagesService>(LanguagesService);
    prisma = module.get(PrismaService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('findAll', () => {
    it('returns only active languages by default', async () => {
      prisma.languages.findMany.mockResolvedValue([baseLang]);

      await service.findAll();

      expect(prisma.languages.findMany).toHaveBeenCalledWith({
        where: { deleted_at: null, is_active: true },
      });
    });

    it('returns all languages when includeInactive is true', async () => {
      prisma.languages.findMany.mockResolvedValue([baseLang]);

      await service.findAll(true);

      expect(prisma.languages.findMany).toHaveBeenCalledWith({
        where: { deleted_at: null },
      });
    });

    it('returns data array', async () => {
      prisma.languages.findMany.mockResolvedValue([baseLang]);

      const result = await service.findAll();

      expect(result.data).toEqual([baseLang]);
    });
  });

  describe('create', () => {
    it('creates language and logs audit without a resource_id (key is not a UUID)', async () => {
      prisma.languages.create.mockResolvedValue(baseLang);

      const result = await service.create(
        { code: 'ar', name: 'Arabic', native_name: 'العربية' },
        'actor-1',
      );

      expect(audit.write).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'LANGUAGE_CREATED',
          resourceType: 'language',
        }),
      );
      // No resourceId supplied — AuditService persists null in that case.
      const call = audit.write.mock.calls[0][0];
      expect(call.resourceId).toBeUndefined();
      expect(result.data.code).toBe('ar');
    });

    it('defaults is_active to true when not provided', async () => {
      prisma.languages.create.mockResolvedValue(baseLang);

      await service.create({ code: 'ar', name: 'Arabic', native_name: 'العربية' }, 'actor-1');

      expect(prisma.languages.create).toHaveBeenCalledWith({
        data: { code: 'ar', name: 'Arabic', native_name: 'العربية', is_active: true },
      });
    });
  });

  describe('update', () => {
    it('updates language and logs audit without a resource_id', async () => {
      prisma.languages.findFirst.mockResolvedValue(baseLang);
      prisma.languages.update.mockResolvedValue({ ...baseLang, is_active: false });

      const result = await service.update('ar', { is_active: false }, 'actor-1');

      expect(audit.write).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'LANGUAGE_UPDATED',
          resourceType: 'language',
        }),
      );
      const call = audit.write.mock.calls[0][0];
      expect(call.resourceId).toBeUndefined();
      expect(result.message).toBe('Language updated');
    });

    it('throws NotFoundException when language not found', async () => {
      prisma.languages.findFirst.mockResolvedValue(null);

      await expect(service.update('xx', { name: 'X' }, 'actor-1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('softDelete', () => {
    it('sets deleted_at on the language', async () => {
      prisma.languages.findFirst.mockResolvedValue(baseLang);

      const result = await service.softDelete('ar', 'actor-1');

      expect(prisma.languages.update).toHaveBeenCalledWith({
        where: { code: 'ar' },
        data: { deleted_at: expect.any(Date) },
      });
      expect(result.message).toBe('Language deleted');
    });

    it('throws NotFoundException when not found', async () => {
      prisma.languages.findFirst.mockResolvedValue(null);

      await expect(service.softDelete('xx', 'actor-1')).rejects.toThrow(NotFoundException);
    });
  });
});
