import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { R2Service } from '../storage/r2.service';
import { AuditService } from '../common/audit/audit.service';
import { AUDIT_ACTIONS } from '../common/audit/audit.actions';
import { softDeleteSuffix, stripSoftDeleteSuffix } from '../common/utils/soft-delete.util';
import { resolveTranslation } from '../common/utils/translation.util';
import { buildPaginationMeta, resolvePagination } from '../common/utils/pagination.util';
import {
  AudioAdminQueryDto,
  AudioQueryDto,
  AudioTranslationDto,
  CreateAudioDto,
  RequestAudioUploadUrlDto,
  ToggleAudioPublishDto,
  UpdateAudioDto,
} from './dto/audio.dto';

// Nested speaker shape — enough for "by this lecturer" links + per-language name.
const SPEAKER_SELECT = {
  id: true,
  speaker_translations: { select: { lang: true, name: true, is_default: true } },
} satisfies Prisma.speakersSelect;

// List payloads drop the heavy `peaks` waveform array (detail-only).
const AUDIO_LIST_SELECT = {
  id: true,
  speaker_id: true,
  audio_url: true,
  pdf_url: true,
  slug: true,
  duration_seconds: true,
  size_mb: true,
  is_published: true,
  created_at: true,
  updated_at: true,
  audio_translations: { select: { lang: true, title: true, is_default: true } },
  speakers: { select: SPEAKER_SELECT },
} satisfies Prisma.audiosSelect;

const AUDIO_DETAIL_SELECT = {
  ...AUDIO_LIST_SELECT,
  peaks: true,
} satisfies Prisma.audiosSelect;

type SpeakerRow = {
  id: string;
  speaker_translations: { lang: string; name: string; is_default: boolean }[];
};

/**
 * Audio lecture library. i18n via `audio_translations` (title per language) and
 * a first-class `speakers` entity (resolved per request language). Each row is
 * one recording with an MP3 URL, optional PDF, a single language-agnostic slug,
 * and analysis metadata (duration_seconds, size_mb, peaks). CMS lifecycle
 * mirroring books — soft-delete (with slug-suffix freeing), restore, trash,
 * publish toggle, by-slug, and a pre-signed R2 upload.
 */
@Injectable()
export class AudiosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly r2: R2Service,
    private readonly audit: AuditService,
  ) {}

  /** Attach the resolved speaker (per request lang) instead of the raw relation. */
  private shapeSpeaker(speaker: SpeakerRow | null, lang: string | null) {
    if (!speaker) return null;
    return { ...speaker, translation: resolveTranslation(speaker.speaker_translations, lang) };
  }

  private shapeAudio<T extends { audio_translations: any[]; speakers?: SpeakerRow | null }>(row: T, lang: string | null) {
    const { speakers, ...rest } = row;
    return {
      ...rest,
      translation: resolveTranslation(row.audio_translations, lang),
      speaker: this.shapeSpeaker(speakers ?? null, lang),
    };
  }

  /** Reject a slug that collides with another live audio's slug. */
  private async assertSlugAvailable(slug: string, excludeId: string | null) {
    const conflict = await this.prisma.audios.findFirst({
      where: { slug, ...(excludeId ? { NOT: { id: excludeId } } : {}) },
      select: { id: true },
    });
    if (conflict) throw new ConflictException(`Slug "${slug}" is already used by another audio`);
  }

  // ── Public reads ────────────────────────────────────────────────────────────

  async findAllPublic(query: AudioQueryDto, lang: string | null) {
    const { page, limit, skip } = resolvePagination(query);
    const where: Prisma.audiosWhereInput = { deleted_at: null, is_published: true };
    if (query.speaker_id) where.speaker_id = query.speaker_id;
    if (query.search) this.applySearch(where, query.search);
    return this.listWith(where, page, limit, skip, lang);
  }

  async findAllAdmin(query: AudioAdminQueryDto, lang: string | null) {
    const { page, limit, skip } = resolvePagination(query);
    const where: Prisma.audiosWhereInput = { deleted_at: null };
    if (query.is_published !== undefined) where.is_published = query.is_published;
    if (query.speaker_id) where.speaker_id = query.speaker_id;
    if (query.search) this.applySearch(where, query.search);
    return this.listWith(where, page, limit, skip, lang);
  }

  /** ?search= filters the list by audio title OR speaker name (case-insensitive). */
  private applySearch(where: Prisma.audiosWhereInput, search: string) {
    where.OR = [
      { audio_translations: { some: { title: { contains: search, mode: 'insensitive' } } } },
      { speakers: { speaker_translations: { some: { name: { contains: search, mode: 'insensitive' } } } } },
    ];
  }

  private async listWith(where: Prisma.audiosWhereInput, page: number, limit: number, skip: number, lang: string | null) {
    const [rows, total] = await Promise.all([
      this.prisma.audios.findMany({
        where,
        select: AUDIO_LIST_SELECT,
        orderBy: [{ created_at: 'desc' }, { id: 'asc' }],
        skip,
        take: limit,
      }),
      this.prisma.audios.count({ where }),
    ]);
    const items = rows.map((r) => this.shapeAudio(r, lang));
    return { message: 'Audios fetched', data: { items, pagination: buildPaginationMeta(page, limit, total) } };
  }

  /**
   * Fetch a single audio by id. Public callers only see published rows — an
   * unpublished draft must not be readable just because its UUID is known.
   */
  async findOne(id: string, lang: string | null, opts: { allowUnpublished?: boolean } = {}) {
    const where: Prisma.audiosWhereInput = { id, deleted_at: null };
    if (!opts.allowUnpublished) where.is_published = true;
    const audio = await this.prisma.audios.findFirst({ where, select: AUDIO_DETAIL_SELECT });
    if (!audio) throw new NotFoundException('Audio not found');
    return { message: 'Audio fetched', data: this.shapeAudio(audio, lang) };
  }

  /** Public detail by canonical slug. */
  async findBySlug(slug: string, lang: string | null) {
    const audio = await this.prisma.audios.findFirst({
      where: { slug, deleted_at: null, is_published: true },
      select: AUDIO_DETAIL_SELECT,
    });
    if (!audio) throw new NotFoundException('Audio not found');
    return { message: 'Audio fetched', data: this.shapeAudio(audio, lang) };
  }

  // ── Writes ──────────────────────────────────────────────────────────────────

  private validateDefault(translations: AudioTranslationDto[]) {
    const defaultCount = translations.filter((t) => t.is_default).length;
    if (defaultCount !== 1) throw new BadRequestException('Exactly one translation must have is_default: true');
  }

  private async assertSpeakerExists(speakerId: string) {
    const speaker = await this.prisma.speakers.findFirst({ where: { id: speakerId, deleted_at: null }, select: { id: true } });
    if (!speaker) throw new NotFoundException('Speaker not found');
  }

  async create(dto: CreateAudioDto, actorId: string, lang: string | null) {
    this.validateDefault(dto.translations);
    if (dto.speaker_id) await this.assertSpeakerExists(dto.speaker_id);
    if (dto.slug) await this.assertSlugAvailable(dto.slug, null);

    let created;
    try {
      created = await this.prisma.$transaction(async (tx) => {
        const audio = await tx.audios.create({
          data: {
            speaker_id: dto.speaker_id ?? null,
            audio_url: dto.audio_url,
            pdf_url: dto.pdf_url ?? null,
            slug: dto.slug ?? null,
            duration_seconds: dto.duration_seconds ?? null,
            size_mb: dto.size_mb ?? null,
            peaks: dto.peaks ?? undefined,
            is_published: dto.is_published ?? true,
            added_by: actorId,
          },
        });
        await tx.audio_translations.createMany({
          data: dto.translations.map((t) => ({
            audio_id: audio.id,
            lang: t.lang,
            title: t.title,
            is_default: t.is_default ?? false,
          })),
        });
        return audio;
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('An audio with that slug or audio URL already exists');
      }
      throw err;
    }

    await this.audit.write({
      actorId,
      action: AUDIT_ACTIONS.AUDIO_CREATED,
      resourceType: 'audio',
      resourceId: created.id,
      changes: { method: 'POST', path: '/api/v1/audios' },
    });

    const { data } = await this.findOne(created.id, lang, { allowUnpublished: true });
    return { message: 'Audio created', data };
  }

  async update(id: string, dto: UpdateAudioDto, actorId: string, lang: string | null) {
    const audio = await this.prisma.audios.findFirst({ where: { id, deleted_at: null }, select: { id: true } });
    if (!audio) throw new NotFoundException('Audio not found');

    if (dto.speaker_id) await this.assertSpeakerExists(dto.speaker_id);
    if (dto.slug) await this.assertSlugAvailable(dto.slug, id);

    try {
      await this.prisma.$transaction(async (tx) => {
        // Build an explicit Prisma input — never spread attacker-controlled DTO
        // fields into a payload that could touch columns we didn't intend.
        const updateData: Prisma.audiosUpdateInput = { updated_at: new Date() };
        if (dto.speaker_id !== undefined) {
          updateData.speakers = dto.speaker_id ? { connect: { id: dto.speaker_id } } : { disconnect: true };
        }
        if (dto.audio_url !== undefined) updateData.audio_url = dto.audio_url;
        if (dto.pdf_url !== undefined) updateData.pdf_url = dto.pdf_url;
        if (dto.slug !== undefined) updateData.slug = dto.slug;
        if (dto.duration_seconds !== undefined) updateData.duration_seconds = dto.duration_seconds;
        if (dto.size_mb !== undefined) updateData.size_mb = dto.size_mb;
        if (dto.peaks !== undefined) updateData.peaks = dto.peaks;
        if (dto.is_published !== undefined) updateData.is_published = dto.is_published;

        await tx.audios.update({ where: { id }, data: updateData });

        if (dto.translations) {
          for (const t of dto.translations) {
            const trData = { title: t.title, is_default: t.is_default ?? false };
            await tx.audio_translations.upsert({
              where: { audio_id_lang: { audio_id: id, lang: t.lang } },
              create: { audio_id: id, lang: t.lang, ...trData },
              update: trData,
            });
          }
          const defaults = await tx.audio_translations.count({ where: { audio_id: id, is_default: true } });
          if (defaults !== 1) throw new BadRequestException('Exactly one translation must have is_default: true');
        }
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('An audio with that slug or audio URL already exists');
      }
      throw err;
    }

    await this.audit.write({
      actorId,
      action: AUDIT_ACTIONS.AUDIO_UPDATED,
      resourceType: 'audio',
      resourceId: id,
      changes: { method: 'PATCH', path: `/api/v1/audios/${id}` },
    });

    const { data } = await this.findOne(id, lang, { allowUnpublished: true });
    return { message: 'Audio updated', data };
  }

  async togglePublish(id: string, dto: ToggleAudioPublishDto, actorId: string, lang: string | null) {
    const existing = await this.prisma.audios.findFirst({
      where: { id, deleted_at: null },
      select: { id: true, is_published: true },
    });
    if (!existing) throw new NotFoundException('Audio not found');

    if (existing.is_published === dto.is_published) {
      const { data } = await this.findOne(id, lang, { allowUnpublished: true });
      return { message: 'Audio already in requested state', data };
    }

    await this.prisma.audios.update({
      where: { id },
      data: { is_published: dto.is_published, updated_at: new Date() },
    });

    await this.audit.write({
      actorId,
      action: dto.is_published ? AUDIT_ACTIONS.AUDIO_PUBLISHED : AUDIT_ACTIONS.AUDIO_UNPUBLISHED,
      resourceType: 'audio',
      resourceId: id,
      changes: { method: 'PATCH', path: `/api/v1/audios/${id}/publish`, is_published: dto.is_published },
    });

    const { data } = await this.findOne(id, lang, { allowUnpublished: true });
    return { message: dto.is_published ? 'Audio published' : 'Audio unpublished', data };
  }

  /** List soft-deleted audios with the original (suffix-stripped) slug. */
  async findTrash(page: number, limit: number, lang: string | null) {
    const skip = (page - 1) * limit;
    const where: Prisma.audiosWhereInput = { deleted_at: { not: null } };
    const [rows, total] = await Promise.all([
      this.prisma.audios.findMany({
        where,
        select: AUDIO_LIST_SELECT,
        orderBy: [{ deleted_at: 'desc' }, { id: 'asc' }],
        skip,
        take: limit,
      }),
      this.prisma.audios.count({ where }),
    ]);
    const items = rows.map((r) => {
      const shaped = this.shapeAudio(r, lang);
      return { ...shaped, slug: shaped.slug ? stripSoftDeleteSuffix(shaped.slug) : shaped.slug };
    });
    return { message: 'Trash fetched', data: { items, pagination: buildPaginationMeta(page, limit, total) } };
  }

  /**
   * Restore a soft-deleted audio. Reverses the slug suffix from softDelete.
   * Refused with 409 if a live audio has taken the original slug meanwhile.
   */
  async restore(id: string, actorId: string) {
    const audio = await this.prisma.audios.findFirst({
      where: { id, deleted_at: { not: null } },
      select: { id: true, slug: true },
    });
    if (!audio) throw new NotFoundException('Deleted audio not found');

    const original = audio.slug ? stripSoftDeleteSuffix(audio.slug) : null;

    try {
      await this.prisma.$transaction(async (tx) => {
        if (original) {
          const conflict = await tx.audios.findFirst({
            where: { slug: original, deleted_at: null, NOT: { id } },
            select: { id: true },
          });
          if (conflict) throw new ConflictException(`Cannot restore: slug "${original}" is now used by another audio`);
        }
        await tx.audios.update({
          where: { id },
          data: { deleted_at: null, ...(original ? { slug: original } : {}), updated_at: new Date() },
        });
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('Cannot restore: the original slug was claimed by another audio');
      }
      throw err;
    }

    await this.audit.write({
      actorId,
      action: AUDIT_ACTIONS.AUDIO_RESTORED,
      resourceType: 'audio',
      resourceId: id,
      changes: { method: 'POST', path: `/api/v1/audios/${id}/restore` },
    });

    return { message: 'Audio restored', data: null };
  }

  async softDelete(id: string, actorId: string) {
    const audio = await this.prisma.audios.findFirst({ where: { id, deleted_at: null }, select: { id: true, slug: true } });
    if (!audio) throw new NotFoundException('Audio not found');

    // Free the slug by suffixing it so the partial-unique index is released
    // while the row sits in trash; restore reverses it.
    const deletedAt = new Date();
    const slugUpdate = audio.slug ? { slug: `${audio.slug}${softDeleteSuffix(deletedAt)}` } : {};

    await this.prisma.audios.update({ where: { id }, data: { deleted_at: deletedAt, ...slugUpdate } });

    await this.audit.write({
      actorId,
      action: AUDIT_ACTIONS.AUDIO_DELETED,
      resourceType: 'audio',
      resourceId: id,
      changes: { method: 'DELETE', path: `/api/v1/audios/${id}` },
    });

    return { message: 'Audio deleted', data: null };
  }

  // ── Uploads ──────────────────────────────────────────────────────────────────

  /** Pre-sign an R2 PUT for an mp3/m4a or PDF; the CMS saves the returned publicUrl onto the record. */
  async requestAudioUploadUrl(dto: RequestAudioUploadUrlDto) {
    const result = await this.r2.presignAudioUpload(dto.filename, dto.content_type);
    return { message: 'Upload URL generated', data: result };
  }
}
