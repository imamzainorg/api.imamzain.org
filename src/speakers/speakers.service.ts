import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import { AUDIT_ACTIONS } from '../common/audit/audit.actions';
import { resolveTranslation } from '../common/utils/translation.util';
import { buildPaginationMeta, resolvePagination } from '../common/utils/pagination.util';
import { CreateSpeakerDto, SpeakerQueryDto, SpeakerTranslationDto, UpdateSpeakerDto } from './dto/speaker.dto';

// Includes the per-language rows plus a filtered count of the speaker's live,
// published audios — drives the "N lectures" badge on the public list.
const SPEAKER_INCLUDE = {
  speaker_translations: true,
  _count: { select: { audios: { where: { is_published: true, deleted_at: null } } } },
} satisfies Prisma.speakersInclude;

type SpeakerRow = Prisma.speakersGetPayload<{ include: typeof SPEAKER_INCLUDE }>;

/**
 * First-class speaker (lecturer/خطيب) entity for the audio library. i18n via
 * `speaker_translations` (name per language). Soft-delete (blocked while live
 * audios still reference it), restore, and trash — mirroring book-categories,
 * minus slugs (speakers are addressed by UUID only).
 */
@Injectable()
export class SpeakersService {
  private readonly logger = new Logger(SpeakersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private shape(row: SpeakerRow, lang: string | null) {
    const { _count, ...rest } = row;
    return {
      ...rest,
      translation: resolveTranslation(row.speaker_translations, lang),
      audio_count: _count.audios,
    };
  }

  private validateDefault(translations: SpeakerTranslationDto[]) {
    const defaultCount = translations.filter((t) => t.is_default).length;
    if (defaultCount !== 1) throw new BadRequestException('Exactly one translation must have is_default: true');
  }

  // ── Public reads ────────────────────────────────────────────────────────────

  async findAll(query: SpeakerQueryDto, lang: string | null) {
    const { page, limit, skip } = resolvePagination(query);
    const where: Prisma.speakersWhereInput = { deleted_at: null };
    if (query.search) {
      where.speaker_translations = { some: { name: { contains: query.search, mode: 'insensitive' } } };
    }
    const [rows, total] = await Promise.all([
      this.prisma.speakers.findMany({
        where,
        include: SPEAKER_INCLUDE,
        orderBy: [{ created_at: 'desc' }, { id: 'asc' }],
        skip,
        take: limit,
      }),
      this.prisma.speakers.count({ where }),
    ]);
    const items = rows.map((r) => this.shape(r, lang));
    return { message: 'Speakers fetched', data: { items, pagination: buildPaginationMeta(page, limit, total) } };
  }

  async findOne(id: string, lang: string | null) {
    const speaker = await this.prisma.speakers.findFirst({ where: { id, deleted_at: null }, include: SPEAKER_INCLUDE });
    if (!speaker) throw new NotFoundException('Speaker not found');
    return { message: 'Speaker fetched', data: this.shape(speaker, lang) };
  }

  // ── Writes ──────────────────────────────────────────────────────────────────

  async create(dto: CreateSpeakerDto, actorId: string, lang: string | null) {
    this.validateDefault(dto.translations);

    let created;
    try {
      created = await this.prisma.$transaction(async (tx) => {
        const speaker = await tx.speakers.create({ data: {} });
        await tx.speaker_translations.createMany({
          data: dto.translations.map((t) => ({
            speaker_id: speaker.id,
            lang: t.lang,
            name: t.name,
            is_default: t.is_default ?? false,
          })),
        });
        return speaker;
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('Duplicate translation language for this speaker');
      }
      throw err;
    }

    await this.audit.write({
      actorId,
      action: AUDIT_ACTIONS.SPEAKER_CREATED,
      resourceType: 'speaker',
      resourceId: created.id,
      changes: { method: 'POST', path: '/api/v1/speakers' },
    });

    const { data } = await this.findOne(created.id, lang);
    return { message: 'Speaker created', data };
  }

  async update(id: string, dto: UpdateSpeakerDto, actorId: string, lang: string | null) {
    const speaker = await this.prisma.speakers.findFirst({ where: { id, deleted_at: null }, select: { id: true } });
    if (!speaker) throw new NotFoundException('Speaker not found');

    if (dto.translations) {
      await this.prisma.$transaction(async (tx) => {
        for (const t of dto.translations!) {
          const trData = { name: t.name, is_default: t.is_default ?? false };
          await tx.speaker_translations.upsert({
            where: { speaker_id_lang: { speaker_id: id, lang: t.lang } },
            create: { speaker_id: id, lang: t.lang, ...trData },
            update: trData,
          });
        }
        const defaults = await tx.speaker_translations.count({ where: { speaker_id: id, is_default: true } });
        if (defaults !== 1) throw new BadRequestException('Exactly one translation must have is_default: true');
        await tx.speakers.update({ where: { id }, data: { updated_at: new Date() } });
      });
    }

    await this.audit.write({
      actorId,
      action: AUDIT_ACTIONS.SPEAKER_UPDATED,
      resourceType: 'speaker',
      resourceId: id,
      changes: { method: 'PATCH', path: `/api/v1/speakers/${id}` },
    });

    const { data } = await this.findOne(id, lang);
    return { message: 'Speaker updated', data };
  }

  /** List soft-deleted speakers. */
  async findTrash(page: number, limit: number, lang: string | null) {
    const skip = (page - 1) * limit;
    const where: Prisma.speakersWhereInput = { deleted_at: { not: null } };
    const [rows, total] = await Promise.all([
      this.prisma.speakers.findMany({
        where,
        include: SPEAKER_INCLUDE,
        orderBy: [{ deleted_at: 'desc' }, { id: 'asc' }],
        skip,
        take: limit,
      }),
      this.prisma.speakers.count({ where }),
    ]);
    const items = rows.map((r) => this.shape(r, lang));
    return { message: 'Trash fetched', data: { items, pagination: buildPaginationMeta(page, limit, total) } };
  }

  /** Restore a soft-deleted speaker. */
  async restore(id: string, actorId: string) {
    const speaker = await this.prisma.speakers.findFirst({ where: { id, deleted_at: { not: null } }, select: { id: true } });
    if (!speaker) throw new NotFoundException('Deleted speaker not found');

    await this.prisma.speakers.update({ where: { id }, data: { deleted_at: null, updated_at: new Date() } });

    await this.audit.write({
      actorId,
      action: AUDIT_ACTIONS.SPEAKER_RESTORED,
      resourceType: 'speaker',
      resourceId: id,
      changes: { method: 'POST', path: `/api/v1/speakers/${id}/restore` },
    });

    return { message: 'Speaker restored', data: null };
  }

  async softDelete(id: string, actorId: string) {
    const speaker = await this.prisma.speakers.findFirst({ where: { id, deleted_at: null }, select: { id: true } });
    if (!speaker) throw new NotFoundException('Speaker not found');

    // Block deletion while live audios still point at this speaker — the editor
    // must reassign or delete those first (mirrors category block-on-children).
    const audioCount = await this.prisma.audios.count({ where: { speaker_id: id, deleted_at: null } });
    if (audioCount > 0) throw new ConflictException('Cannot delete a speaker that still has audios — reassign them first');

    await this.prisma.speakers.update({ where: { id }, data: { deleted_at: new Date() } });

    await this.audit.write({
      actorId,
      action: AUDIT_ACTIONS.SPEAKER_DELETED,
      resourceType: 'speaker',
      resourceId: id,
      changes: { method: 'DELETE', path: `/api/v1/speakers/${id}` },
    });

    return { message: 'Speaker deleted', data: null };
  }
}
