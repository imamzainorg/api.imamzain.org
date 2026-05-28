import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, OnApplicationBootstrap } from '@nestjs/common';
import { Prisma, site_setting_type } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import { AUDIT_ACTIONS } from '../common/audit/audit.actions';
import { TtlCache } from '../common/utils/ttl-cache.util';
import { UpsertSettingDto } from './dto/setting.dto';

// Settings change rarely (admin action) and are read on most CMS page loads.
// 60s is short enough that an admin's own change is visible after one refresh
// cycle, long enough to absorb the bursty fan-out a fresh dashboard render
// causes when it requests every public setting in parallel.
const SETTINGS_CACHE_TTL_MS = 60_000;

type SettingRow = Prisma.site_settingsGetPayload<{}>;

export interface DecodedSetting {
  key: string;
  value: string | number | boolean | unknown;
  type: site_setting_type;
  description: string | null;
  is_public: boolean;
  updated_at: Date;
  updated_by: string | null;
}

@Injectable()
export class SettingsService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SettingsService.name);
  private readonly cache = new TtlCache<DecodedSetting[]>(SETTINGS_CACHE_TTL_MS);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Warm the cache once before the app accepts traffic. Avoids the first
   * dashboard render eating a full settings table scan on cold start.
   * Best-effort: failures are logged but don't block boot.
   */
  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.findAll();
      await this.findPublic();
    } catch (err) {
      this.logger.warn(`Settings cache pre-warm failed: ${err}`);
    }
  }

  /**
   * Decode the text-stored `value` into the type declared on the row.
   * - string  → as-is
   * - number  → parseFloat (rejects NaN at write time, so this is safe)
   * - boolean → 'true' | 'false'
   * - json    → JSON.parse
   */
  private decode(row: SettingRow): DecodedSetting {
    let value: DecodedSetting['value'] = row.value;
    switch (row.type) {
      case 'number':
        value = Number(row.value);
        break;
      case 'boolean':
        value = row.value === 'true';
        break;
      case 'json':
        try {
          value = JSON.parse(row.value);
        } catch {
          // Should never happen — write path validates JSON. If it does, log
          // and return the raw string so the CMS at least sees something.
          this.logger.warn(`site_settings[${row.key}] is type=json but value is not valid JSON`);
          value = row.value;
        }
        break;
    }
    return { ...row, value };
  }

  /** Validate the raw string matches the declared type. */
  private assertValid(value: string, type: site_setting_type): void {
    switch (type) {
      case 'number': {
        const n = Number(value);
        if (!Number.isFinite(n)) {
          throw new BadRequestException(`Value "${value}" is not a finite number`);
        }
        break;
      }
      case 'boolean':
        if (value !== 'true' && value !== 'false') {
          throw new BadRequestException(`Value must be "true" or "false" for boolean settings`);
        }
        break;
      case 'json':
        try {
          JSON.parse(value);
        } catch {
          throw new BadRequestException('Value must be valid JSON for json settings');
        }
        break;
      case 'string':
        break;
    }
  }

  async findAll(): Promise<{ message: string; data: DecodedSetting[] }> {
    const cached = this.cache.get('all');
    if (cached) return { message: 'Settings fetched', data: cached };
    const rows = await this.prisma.site_settings.findMany({ orderBy: { key: 'asc' } });
    const decoded = rows.map((r) => this.decode(r));
    this.cache.set('all', decoded);
    return { message: 'Settings fetched', data: decoded };
  }

  async findPublic(): Promise<{ message: string; data: DecodedSetting[] }> {
    const cached = this.cache.get('public');
    if (cached) return { message: 'Public settings fetched', data: cached };
    const rows = await this.prisma.site_settings.findMany({
      where: { is_public: true },
      orderBy: { key: 'asc' },
    });
    const decoded = rows.map((r) => this.decode(r));
    this.cache.set('public', decoded);
    return { message: 'Public settings fetched', data: decoded };
  }

  async findOne(key: string): Promise<{ message: string; data: DecodedSetting }> {
    const row = await this.prisma.site_settings.findUnique({ where: { key } });
    if (!row) throw new NotFoundException('Setting not found');
    return { message: 'Setting fetched', data: this.decode(row) };
  }

  /**
   * Upsert by key. The `type` field can only be set on first write — changing
   * type after the fact would silently invalidate every stored value, so the
   * service refuses with 409. To "retype" a setting, delete and re-create.
   */
  async upsert(key: string, dto: UpsertSettingDto, actorId: string) {
    const existing = await this.prisma.site_settings.findUnique({ where: { key } });
    const targetType: site_setting_type = existing ? existing.type : dto.type ?? 'string';

    if (existing && dto.type && dto.type !== existing.type) {
      throw new ConflictException(
        `Setting "${key}" already exists with type "${existing.type}"; delete it first to change the type`,
      );
    }

    this.assertValid(dto.value, targetType);

    const row = await this.prisma.site_settings.upsert({
      where: { key },
      create: {
        key,
        value: dto.value,
        type: targetType,
        description: dto.description ?? null,
        is_public: dto.is_public ?? false,
        updated_by: actorId,
      },
      update: {
        value: dto.value,
        description: dto.description ?? existing?.description ?? null,
        is_public: dto.is_public ?? existing?.is_public ?? false,
        updated_at: new Date(),
        updated_by: actorId,
      },
    });

    this.cache.clear();

    this.audit.write({
      actorId,
      action: existing ? AUDIT_ACTIONS.SETTING_UPDATED : AUDIT_ACTIONS.SETTING_CREATED,
      resourceType: 'site_setting',
      changes: { method: 'PUT', path: `/api/v1/settings/${key}`, key },
    });

    return { message: existing ? 'Setting updated' : 'Setting created', data: this.decode(row) };
  }

  async delete(key: string, actorId: string) {
    const existing = await this.prisma.site_settings.findUnique({ where: { key } });
    if (!existing) throw new NotFoundException('Setting not found');

    await this.prisma.site_settings.delete({ where: { key } });
    this.cache.clear();

    this.audit.write({
      actorId,
      action: AUDIT_ACTIONS.SETTING_DELETED,
      resourceType: 'site_setting',
      changes: { method: 'DELETE', path: `/api/v1/settings/${key}`, key },
    });

    return { message: 'Setting deleted', data: null };
  }
}
