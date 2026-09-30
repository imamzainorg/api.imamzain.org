import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { LanguagesService } from './languages.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import { isActiveLanguage, resolveTranslation, setActiveLanguages } from '../common/utils/translation.util';

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
              findMany: jest.fn().mockResolvedValue([]),
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

  afterEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
    service.onModuleDestroy();
    // The live-language snapshot is module state: never let it leak between specs.
    setActiveLanguages(null);
  });

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
    it('creates language and logs audit with the language code as resource_id', async () => {
      prisma.languages.create.mockResolvedValue(baseLang);

      const result = await service.create(
        { code: 'ar', name: 'Arabic', native_name: 'العربية' },
        'actor-1',
      );

      expect(audit.write).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'LANGUAGE_CREATED',
          resourceType: 'language',
          resourceId: 'ar',
        }),
      );
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
    it('updates language and logs audit with the language code as resource_id', async () => {
      prisma.languages.findFirst.mockResolvedValue(baseLang);
      prisma.languages.update.mockResolvedValue({ ...baseLang, is_active: false });

      const result = await service.update('ar', { is_active: false }, 'actor-1');

      expect(audit.write).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'LANGUAGE_UPDATED',
          resourceType: 'language',
          resourceId: 'ar',
        }),
      );
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

  describe('live-language snapshot (public translation filtering)', () => {
    const liveRows = (...codes: string[]) => codes.map((code) => ({ code }));
    const rows = [
      { lang: 'ar', title: 'ar', is_default: true },
      { lang: 'fa', title: 'fa', is_default: false },
    ];

    it('is not set until something loads it, so nothing is filtered', () => {
      expect(isActiveLanguage('fa')).toBe(true);
      expect(resolveTranslation(rows, 'fa')?.lang).toBe('fa');
    });

    it('loads only active, non-deleted languages', async () => {
      prisma.languages.findMany.mockResolvedValue(liveRows('ar', 'en'));

      await service.refreshActiveLanguages();

      expect(prisma.languages.findMany).toHaveBeenCalledWith({
        where: { deleted_at: null, is_active: true },
        select: { code: true },
      });
      expect(isActiveLanguage('fa')).toBe(false);
      expect(resolveTranslation(rows, 'fa')?.lang).toBe('ar');
    });

    it('is loaded at boot and refreshed on a 60 s timer for the other replicas', async () => {
      jest.useFakeTimers();
      prisma.languages.findMany.mockResolvedValue(liveRows('ar', 'fa'));

      await service.onApplicationBootstrap();
      expect(isActiveLanguage('fa')).toBe(true);

      // Another replica retires Persian; this one only learns on the next tick.
      prisma.languages.findMany.mockResolvedValue(liveRows('ar'));
      expect(isActiveLanguage('fa')).toBe(true);
      await jest.advanceTimersByTimeAsync(60_000);

      expect(isActiveLanguage('fa')).toBe(false);
    });

    it('is refreshed at once when a language is deactivated on this replica', async () => {
      prisma.languages.findMany.mockResolvedValue(liveRows('ar', 'fa'));
      await service.refreshActiveLanguages();
      prisma.languages.findFirst.mockResolvedValue({ ...baseLang, code: 'fa' });
      prisma.languages.update.mockResolvedValue({ ...baseLang, code: 'fa', is_active: false });
      prisma.languages.findMany.mockResolvedValue(liveRows('ar'));

      await service.update('fa', { is_active: false }, 'actor-1');

      expect(isActiveLanguage('fa')).toBe(false);
    });

    it('is refreshed at once when a language is soft-deleted', async () => {
      prisma.languages.findMany.mockResolvedValue(liveRows('ar', 'fa'));
      await service.refreshActiveLanguages();
      prisma.languages.findFirst.mockResolvedValue({ ...baseLang, code: 'fa' });
      prisma.languages.findMany.mockResolvedValue(liveRows('ar'));

      await service.softDelete('fa', 'actor-1');

      expect(isActiveLanguage('fa')).toBe(false);
    });

    it('is refreshed at once when a language is created or restored', async () => {
      prisma.languages.findMany.mockResolvedValue(liveRows('ar'));
      await service.refreshActiveLanguages();
      prisma.languages.create.mockResolvedValue({ ...baseLang, code: 'fa' });
      prisma.languages.findMany.mockResolvedValue(liveRows('ar', 'fa'));

      await service.create({ code: 'fa', name: 'Persian', native_name: 'فارسی' }, 'actor-1');

      expect(isActiveLanguage('fa')).toBe(true);
    });

    it('keeps the previous snapshot when a refresh fails', async () => {
      prisma.languages.findMany.mockResolvedValue(liveRows('ar'));
      await service.refreshActiveLanguages();
      prisma.languages.findMany.mockRejectedValue(new Error('db down'));

      await expect(service.refreshActiveLanguages()).resolves.toBeUndefined();

      expect(isActiveLanguage('fa')).toBe(false);
    });
  });
});
