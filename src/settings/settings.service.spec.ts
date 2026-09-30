import 'reflect-metadata';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';
import { SettingKeyParamDto } from './dto/setting.dto';

const row = (over: Record<string, unknown> = {}) => ({
  key: 'k',
  value: 'v',
  type: 'string',
  description: null,
  is_public: true,
  updated_at: new Date('2026-01-01T00:00:00Z'),
  updated_by: 'staff-uuid',
  ...over,
});

describe('SettingsService', () => {
  let service: SettingsService;
  let prisma: any;
  let audit: { write: jest.Mock };

  beforeEach(() => {
    prisma = {
      site_settings: {
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        upsert: jest.fn().mockImplementation(async ({ create }: any) => row({ ...create })),
        delete: jest.fn().mockResolvedValue({}),
      },
    };
    audit = { write: jest.fn() };
    service = new SettingsService(prisma, audit as any);
  });

  describe('type=number validation (B-Set1)', () => {
    const put = (value: string) => service.upsert('n', { value, type: 'number' } as any, 'actor');

    it.each(['0', '42', '-7', '+7', '3.14', '.5', '5.', '1e5', '-2.5E-3', '007', '  12  ', '\t8\n'])(
      'accepts the finite decimal %j',
      async (value) => {
        await expect(put(value)).resolves.toBeDefined();
      },
    );

    it.each(['', '   ', '\t', '0x1A', '0b11', '0o7', 'Infinity', '-Infinity', 'NaN', '1e999', '1,5', '1 2', '12px', '--1', 'e5', '.', '+', '1_000'])(
      'rejects %j with a 400',
      async (value) => {
        await expect(put(value)).rejects.toBeInstanceOf(BadRequestException);
        expect(prisma.site_settings.upsert).not.toHaveBeenCalled();
      },
    );

    it('stores the trimmed text so padding never reaches the database', async () => {
      await put('  12.5 ');

      expect(prisma.site_settings.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ value: '12.5' }),
          update: expect.objectContaining({ value: '12.5' }),
        }),
      );
    });

    it('validates against the stored type when the setting already exists', async () => {
      prisma.site_settings.findUnique.mockResolvedValue(row({ type: 'number', value: '1' }));

      await expect(service.upsert('n', { value: '0x1A' } as any, 'actor')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('leaves string settings exactly as typed (no trimming)', async () => {
      await service.upsert('s', { value: '  padded  ' } as any, 'actor');

      expect(prisma.site_settings.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ create: expect.objectContaining({ value: '  padded  ' }) }),
      );
    });
  });

  describe('type=boolean validation', () => {
    const put = (value: string) => service.upsert('b', { value, type: 'boolean' } as any, 'actor');

    it.each(['true', 'false'])('accepts %j', async (value) => {
      await expect(put(value)).resolves.toBeDefined();
    });

    it.each(['', ' true', 'true ', 'TRUE', 'False', '1', '0', 'yes', 'null'])('rejects %j', async (value) => {
      await expect(put(value)).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('public reads (S23)', () => {
    it('does not expose updated_by, and keeps every other field', async () => {
      prisma.site_settings.findMany.mockResolvedValue([row({ key: 'site_name', value: 'Imam Zain' })]);

      const { data } = await service.findPublic();

      expect(data).toEqual([
        {
          key: 'site_name',
          value: 'Imam Zain',
          type: 'string',
          description: null,
          is_public: true,
          updated_at: new Date('2026-01-01T00:00:00Z'),
        },
      ]);
      expect(data[0]).not.toHaveProperty('updated_by');
    });

    it('still decodes typed values on the public path', async () => {
      prisma.site_settings.findMany.mockResolvedValue([
        row({ key: 'n', type: 'number', value: '2.5' }),
        row({ key: 'b', type: 'boolean', value: 'true' }),
        row({ key: 'j', type: 'json', value: '[1,2]' }),
      ]);

      const { data } = await service.findPublic();

      expect(data.map((d) => d.value)).toEqual([2.5, true, [1, 2]]);
    });

    it('the admin list keeps updated_by (the CMS shows who changed a setting)', async () => {
      prisma.site_settings.findMany.mockResolvedValue([row()]);

      const { data } = await service.findAll();

      expect(data[0]).toHaveProperty('updated_by', 'staff-uuid');
    });

    it('a write clears the public cache as well as the admin one', async () => {
      prisma.site_settings.findMany.mockResolvedValue([row({ value: 'old' })]);
      await service.findPublic();
      await service.findPublic();
      expect(prisma.site_settings.findMany).toHaveBeenCalledTimes(1); // second call served from cache

      await service.upsert('k', { value: 'new' } as any, 'actor');
      prisma.site_settings.findMany.mockResolvedValue([row({ value: 'new' })]);
      const { data } = await service.findPublic();

      expect(prisma.site_settings.findMany).toHaveBeenCalledTimes(2);
      expect(data[0]!.value).toBe('new');
    });

    it('a delete clears the public cache too', async () => {
      prisma.site_settings.findMany.mockResolvedValue([row()]);
      await service.findPublic();
      prisma.site_settings.findUnique.mockResolvedValue(row());

      await service.delete('k', 'actor');
      prisma.site_settings.findMany.mockResolvedValue([]);
      const { data } = await service.findPublic();

      expect(data).toEqual([]);
    });
  });
});

describe('SettingsController :key parameter', () => {
  const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
  const validate = (key: unknown) => pipe.transform({ key }, { type: 'param', metatype: SettingKeyParamDto });

  it.each(['findOne', 'upsert', 'delete'] as const)('binds %s to SettingKeyParamDto', (handler) => {
    const paramTypes = Reflect.getMetadata('design:paramtypes', SettingsController.prototype, handler);
    expect(paramTypes[0]).toBe(SettingKeyParamDto);
  });

  it('accepts a key of up to 100 characters', async () => {
    await expect(validate('a'.repeat(100))).resolves.toEqual({ key: 'a'.repeat(100) });
  });

  it('rejects a key longer than 100 characters with a 400', async () => {
    await expect(validate('a'.repeat(101))).rejects.toBeInstanceOf(BadRequestException);
  });
});
