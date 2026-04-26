import { Injectable, NotFoundException } from '@nestjs/common';
import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';

export class CreateLanguageDto {
  @IsString()
  @MinLength(2)
  @MaxLength(10)
  code: string;

  @IsString()
  @MinLength(1)
  name: string;

  @IsString()
  @MinLength(1)
  native_name: string;

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
  constructor(private readonly prisma: PrismaService) {}

  async findAll(includeInactive = false) {
    const where: any = { deleted_at: null };
    if (!includeInactive) where.is_active = true;

    const languages = await this.prisma.languages.findMany({ where });
    return { message: 'Languages fetched', data: languages };
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

    try {
      await this.prisma.audit_logs.create({
        data: {
          user_id: actorId,
          action: 'LANGUAGE_CREATED',
          resource_type: 'language',
          resource_id: null,
          changes: { method: 'POST', path: '/api/v1/languages', code: language.code },
        },
      });
    } catch {}

    return { message: 'Language created', data: language };
  }

  async update(code: string, dto: UpdateLanguageDto, actorId: string) {
    const existing = await this.prisma.languages.findFirst({ where: { code, deleted_at: null } });
    if (!existing) throw new NotFoundException('Language not found');

    const updated = await this.prisma.languages.update({
      where: { code },
      data: dto,
    });

    try {
      await this.prisma.audit_logs.create({
        data: {
          user_id: actorId,
          action: 'LANGUAGE_UPDATED',
          resource_type: 'language',
          resource_id: null,
          changes: { method: 'PATCH', path: `/api/v1/languages/${code}`, code },
        },
      });
    } catch {}

    return { message: 'Language updated', data: updated };
  }

  async softDelete(code: string, actorId: string) {
    const existing = await this.prisma.languages.findFirst({ where: { code, deleted_at: null } });
    if (!existing) throw new NotFoundException('Language not found');

    await this.prisma.languages.update({ where: { code }, data: { deleted_at: new Date() } });

    try {
      await this.prisma.audit_logs.create({
        data: {
          user_id: actorId,
          action: 'LANGUAGE_DELETED',
          resource_type: 'language',
          resource_id: null,
          changes: { method: 'DELETE', path: `/api/v1/languages/${code}`, code },
        },
      });
    } catch {}

    return { message: 'Language deleted', data: null };
  }
}
