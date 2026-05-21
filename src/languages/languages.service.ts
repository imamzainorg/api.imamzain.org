import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
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
export class LanguagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async findAll(includeInactive = false) {
    const where: Prisma.languagesWhereInput = { deleted_at: null };
    if (!includeInactive) where.is_active = true;

    const languages = await this.prisma.languages.findMany({ where });
    return { message: "Languages fetched", data: languages };
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

    await this.audit.write({
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

    await this.audit.write({
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

    await this.audit.write({
      actorId,
      action: AUDIT_ACTIONS.LANGUAGE_DELETED,
      resourceType: "language",
      changes: { method: "DELETE", path: `/api/v1/languages/${code}`, code },
    });

    return { message: "Language deleted", data: null };
  }
}
