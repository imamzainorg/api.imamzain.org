import { Injectable, Logger, NotFoundException, OnApplicationBootstrap } from "@nestjs/common";
import { languages, Prisma } from "@prisma/client";
import {
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from "class-validator";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../common/audit/audit.service";
import { AUDIT_ACTIONS } from "../common/audit/audit.actions";
import { TtlCache } from "../common/utils/ttl-cache.util";

// Languages change on the order of "once per release" — basically static at
// runtime. The cache TTL is longer than settings because the table is even
// less mutable; we still want a TTL rather than infinite caching so an admin
// add/remove eventually propagates without a redeploy.
const LANGUAGES_CACHE_TTL_MS = 300_000;

export class CreateLanguageDto {
  @IsString()
  @MinLength(2)
  @MaxLength(10)
  code!: string;

  @IsString()
  @MinLength(1)
  name!: string;

  @IsString()
  @MinLength(1)
  native_name!: string;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}

export class UpdateLanguageDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  native_name?: string;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}

@Injectable()
export class LanguagesService implements OnApplicationBootstrap {
  private readonly logger = new Logger(LanguagesService.name);
  private readonly cache = new TtlCache<languages[]>(LANGUAGES_CACHE_TTL_MS);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Pre-warm at boot so the first request doesn't pay the cold-cache cost. */
  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.findAll(false);
      await this.findAll(true);
    } catch (err) {
      this.logger.warn(`Languages cache pre-warm failed: ${err}`);
    }
  }

  async findAll(includeInactive = false) {
    const cacheKey = includeInactive ? 'all' : 'active';
    const cached = this.cache.get(cacheKey);
    if (cached) return { message: "Languages fetched", data: cached };

    const where: Prisma.languagesWhereInput = { deleted_at: null };
    if (!includeInactive) where.is_active = true;

    const rows = await this.prisma.languages.findMany({ where });
    this.cache.set(cacheKey, rows);
    return { message: "Languages fetched", data: rows };
  }

  async create(dto: CreateLanguageDto, actorId: string) {
    const language = await this.prisma.languages.create({
      data: {
        code: dto.code,
        name: dto.name,
        native_name: dto.native_name,
        is_active: dto.is_active ?? true,
      },
    });
    this.cache.clear();

    this.audit.write({
      actorId,
      action: AUDIT_ACTIONS.LANGUAGE_CREATED,
      resourceType: "language",
      changes: { method: "POST", path: "/api/v1/languages", code: language.code },
    });

    return { message: "Language created", data: language };
  }

  async update(code: string, dto: UpdateLanguageDto, actorId: string) {
    const existing = await this.prisma.languages.findFirst({
      where: { code, deleted_at: null },
    });
    if (!existing) throw new NotFoundException("Language not found");

    // Explicit field allowlist — DTO additions can't silently leak into
    // the row.
    const updateData: Prisma.languagesUpdateInput = {};
    if (dto.name !== undefined) updateData.name = dto.name;
    if (dto.native_name !== undefined) updateData.native_name = dto.native_name;
    if (dto.is_active !== undefined) updateData.is_active = dto.is_active;

    const updated = await this.prisma.languages.update({
      where: { code },
      data: updateData,
    });
    this.cache.clear();

    this.audit.write({
      actorId,
      action: AUDIT_ACTIONS.LANGUAGE_UPDATED,
      resourceType: "language",
      changes: { method: "PATCH", path: `/api/v1/languages/${code}`, code },
    });

    return { message: "Language updated", data: updated };
  }

  async softDelete(code: string, actorId: string) {
    const existing = await this.prisma.languages.findFirst({
      where: { code, deleted_at: null },
    });
    if (!existing) throw new NotFoundException("Language not found");

    await this.prisma.languages.update({
      where: { code },
      data: { deleted_at: new Date() },
    });
    this.cache.clear();

    this.audit.write({
      actorId,
      action: AUDIT_ACTIONS.LANGUAGE_DELETED,
      resourceType: "language",
      changes: { method: "DELETE", path: `/api/v1/languages/${code}`, code },
    });

    return { message: "Language deleted", data: null };
  }
}
