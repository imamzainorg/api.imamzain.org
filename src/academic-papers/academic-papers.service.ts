import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import { AUDIT_ACTIONS } from '../common/audit/audit.actions';
import { rethrowP2002AsConflict } from '../common/utils/prisma-error.util';
import { assertExactlyOneDefault, resolveTranslation } from '../common/utils/translation.util';
import { buildPaginationMeta, resolvePagination } from '../common/utils/pagination.util';
import { ACADEMIC_PAPER_PDF_PREFIX, DOCUMENT_PDF_BYTES, R2Service } from '../storage/r2.service';
import { RequestPdfUploadUrlDto } from '../common/dto/request-pdf-upload-url.dto';
import { AcademicPaperQueryDto, CreateAcademicPaperDto, UpdateAcademicPaperDto } from './dto/academic-paper.dto';

// List queries drop the abstract (heavy free-text) from translations.
const PAPER_LIST_SELECT = {
  id: true,
  category_id: true,
  published_year: true,
  pdf_url: true,
  uploaded_by: true,
  views: true,
  is_published: true,
  created_at: true,
  updated_at: true,
  deleted_at: true,
  academic_paper_translations: {
    select: {
      paper_id: true,
      lang: true,
      title: true,
      authors: true,
      keywords: true,
      publication_venue: true,
      page_count: true,
      is_default: true,
    },
  },
  academic_paper_categories: {
    select: {
      id: true,
      created_at: true,
      academic_paper_category_translations: {
        select: { category_id: true, lang: true, title: true, slug: true, description: true },
      },
    },
  },
} satisfies Prisma.academic_papersSelect;

@Injectable()
export class AcademicPapersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly r2: R2Service,
  ) {}

  /** Pre-sign an R2 PUT for a paper PDF; the CMS saves the returned publicUrl onto pdf_url. */
  async requestPdfUploadUrl(dto: RequestPdfUploadUrlDto) {
    const result = await this.r2.presignDocumentUpload(dto.filename, ACADEMIC_PAPER_PDF_PREFIX, DOCUMENT_PDF_BYTES);
    return { message: 'Upload URL generated', data: result };
  }

  async findAll(query: AcademicPaperQueryDto, lang: string | null, isAdmin = false) {
    const { page, limit, skip } = resolvePagination(query);

    const where: Prisma.academic_papersWhereInput = { deleted_at: null };
    if (!isAdmin) where.is_published = true;
    if (query.category_id) where.category_id = query.category_id;

    if (query.search) {
      where.academic_paper_translations = {
        some: {
          OR: [
            { title: { contains: query.search, mode: 'insensitive' } },
            { abstract: { contains: query.search, mode: 'insensitive' } },
          ],
        },
      };
    }

    const [items, total] = await Promise.all([
      this.prisma.academic_papers.findMany({
        where,
        select: PAPER_LIST_SELECT,
        orderBy: [{ created_at: 'desc' }, { id: 'asc' }],
        skip,
        take: limit,
      }),
      this.prisma.academic_papers.count({ where }),
    ]);

    const mapped = items.map((p) => ({ ...p, translation: resolveTranslation(p.academic_paper_translations, lang) }));
    return { message: 'Papers fetched', data: { items: mapped, pagination: buildPaginationMeta(page, limit, total) } };
  }

  async findOne(id: string, lang: string | null, isAdmin = false) {
    const where: Prisma.academic_papersWhereInput = { id, deleted_at: null };
    if (!isAdmin) where.is_published = true;

    const paper = await this.prisma.academic_papers.findFirst({
      where,
      include: {
        academic_paper_translations: true,
        academic_paper_categories: { include: { academic_paper_category_translations: true } },
      },
    });
    if (!paper) throw new NotFoundException('Paper not found');
    return { message: 'Paper fetched', data: { ...paper, translation: resolveTranslation(paper.academic_paper_translations, lang) } };
  }

  async trackView(id: string) {
    const result = await this.prisma.academic_papers.updateMany({
      where: { id, deleted_at: null, is_published: true },
      data: { views: { increment: 1 } },
    });
    if (result.count === 0) throw new NotFoundException('Paper not found');
    return { message: 'View tracked', data: null };
  }

  async togglePublish(id: string, isPublished: boolean, actorId: string, lang: string | null) {
    const existing = await this.prisma.academic_papers.findFirst({
      where: { id, deleted_at: null },
      select: { id: true, is_published: true },
    });
    if (!existing) throw new NotFoundException('Paper not found');

    if (existing.is_published === isPublished) {
      const { data } = await this.findOne(id, lang, true);
      return { message: 'Paper already in requested state', data };
    }

    await this.prisma.academic_papers.update({
      where: { id },
      data: { is_published: isPublished, updated_at: new Date() },
    });

    await this.audit.write({
      actorId,
      action: isPublished ? AUDIT_ACTIONS.ACADEMIC_PAPER_PUBLISHED : AUDIT_ACTIONS.ACADEMIC_PAPER_UNPUBLISHED,
      resourceType: 'academic_paper',
      resourceId: id,
      changes: { method: 'PATCH', path: `/api/v1/academic-papers/${id}/publish`, is_published: isPublished },
    });

    const { data } = await this.findOne(id, lang, true);
    return { message: isPublished ? 'Paper published' : 'Paper unpublished', data };
  }

  async create(dto: CreateAcademicPaperDto, userId: string, lang: string | null) {
    const category = await this.prisma.academic_paper_categories.findFirst({ where: { id: dto.category_id, deleted_at: null } });
    if (!category) throw new NotFoundException('Category not found');

    assertExactlyOneDefault(dto.translations, 'Exactly one translation must have is_default: true');

    let paper;
    try {
      paper = await this.prisma.$transaction(async (tx) => {
        const created = await tx.academic_papers.create({
          data: {
            category_id: dto.category_id,
            published_year: dto.published_year ?? null,
            pdf_url: dto.pdf_url ?? null,
            // Papers are typically uploaded already-final by staff — default to
            // published, matching books/audios.
            is_published: dto.is_published ?? true,
            uploaded_by: userId,
          },
        });
        await tx.academic_paper_translations.createMany({
          data: dto.translations.map((t) => ({
            paper_id: created.id,
            lang: t.lang,
            title: t.title,
            abstract: t.abstract ?? null,
            authors: t.authors ?? [],
            keywords: t.keywords ?? [],
            publication_venue: t.publication_venue ?? null,
            page_count: t.page_count ?? null,
            is_default: t.is_default ?? false,
          })),
        });
        return created;
      });
    } catch (err) {
      // No unique constraint remains on academic_paper_translations besides
      // its (paper_id, lang) primary key — this only fires if the DTO sent
      // the same lang twice.
      rethrowP2002AsConflict(err, 'Duplicate translation language in the request');
    }

    await this.audit.write({
      actorId: userId,
      action: AUDIT_ACTIONS.ACADEMIC_PAPER_CREATED,
      resourceType: 'academic_paper',
      resourceId: paper.id,
      changes: { method: 'POST', path: '/api/v1/academic-papers' },
    });

    const { data } = await this.findOne(paper.id, lang);
    return { message: 'Paper created', data };
  }

  async update(id: string, dto: UpdateAcademicPaperDto, userId: string, lang: string | null) {
    const paper = await this.prisma.academic_papers.findFirst({ where: { id, deleted_at: null } });
    if (!paper) throw new NotFoundException('Paper not found');

    if (dto.category_id !== undefined && dto.category_id !== paper.category_id) {
      const category = await this.prisma.academic_paper_categories.findFirst({
        where: { id: dto.category_id, deleted_at: null },
      });
      if (!category) throw new NotFoundException('Category not found');
    }

    try {
      await this.prisma.$transaction(async (tx) => {
      // Build an explicit Prisma input rather than spreading the DTO so DTO
      // additions don't silently leak into the data payload.
      const updateData: Prisma.academic_papersUpdateInput = { updated_at: new Date() };
      if (dto.category_id !== undefined) {
        updateData.academic_paper_categories = { connect: { id: dto.category_id } };
      }
      if (dto.published_year !== undefined) updateData.published_year = dto.published_year;
      if (dto.pdf_url !== undefined) updateData.pdf_url = dto.pdf_url;
      if (dto.is_published !== undefined) updateData.is_published = dto.is_published;

      await tx.academic_papers.update({ where: { id }, data: updateData });

      if (dto.translations) {
        for (const t of dto.translations) {
          const trData = {
            title: t.title,
            abstract: t.abstract ?? null,
            authors: t.authors ?? [],
            keywords: t.keywords ?? [],
            publication_venue: t.publication_venue ?? null,
            page_count: t.page_count ?? null,
            is_default: t.is_default ?? false,
          };
          await tx.academic_paper_translations.upsert({
            where: { paper_id_lang: { paper_id: id, lang: t.lang } },
            create: { paper_id: id, lang: t.lang, ...trData },
            update: trData,
          });
        }

        const defaults = await tx.academic_paper_translations.count({ where: { paper_id: id, is_default: true } });
        if (defaults !== 1) {
          throw new BadRequestException('Exactly one translation must have is_default: true');
        }
      }
      });
    } catch (err) {
      rethrowP2002AsConflict(err, 'Duplicate translation language in the request');
    }

    await this.audit.write({
      actorId: userId,
      action: AUDIT_ACTIONS.ACADEMIC_PAPER_UPDATED,
      resourceType: 'academic_paper',
      resourceId: id,
      changes: { method: 'PATCH', path: `/api/v1/academic-papers/${id}` },
    });

    const { data } = await this.findOne(id, lang);
    return { message: 'Paper updated', data };
  }

  /** List soft-deleted academic papers (admin trash view). */
  async findTrash(page: number, limit: number) {
    const skip = (page - 1) * limit;
    const where: Prisma.academic_papersWhereInput = { deleted_at: { not: null } };

    const [items, total] = await Promise.all([
      this.prisma.academic_papers.findMany({
        where,
        select: PAPER_LIST_SELECT,
        orderBy: [{ deleted_at: 'desc' }, { id: 'asc' }],
        skip,
        take: limit,
      }),
      this.prisma.academic_papers.count({ where }),
    ]);

    const mapped = items.map((p) => ({
      ...p,
      translation: resolveTranslation(p.academic_paper_translations, null),
    }));

    return {
      message: 'Trash fetched',
      data: { items: mapped, pagination: buildPaginationMeta(page, limit, total) },
    };
  }

  /** Restore a soft-deleted academic paper. */
  async restore(id: string, userId: string) {
    const paper = await this.prisma.academic_papers.findFirst({
      where: { id, deleted_at: { not: null } },
      select: { id: true, category_id: true },
    });
    if (!paper) throw new NotFoundException('Deleted paper not found');

    // The parent category may have been soft-deleted while the paper sat in
    // trash (category softDelete only blocks on LIVE children). Don't restore a
    // live paper under a deleted category — require the category be restored
    // first, mirroring the category's own 409-on-restore-conflict pattern.
    const liveCategory = await this.prisma.academic_paper_categories.findFirst({
      where: { id: paper.category_id, deleted_at: null },
      select: { id: true },
    });
    if (!liveCategory) {
      throw new ConflictException(
        'Cannot restore: the parent category was deleted — restore the category first',
      );
    }

    await this.prisma.academic_papers.update({
      where: { id },
      data: { deleted_at: null, updated_at: new Date() },
    });

    await this.audit.write({
      actorId: userId,
      action: AUDIT_ACTIONS.ACADEMIC_PAPER_RESTORED,
      resourceType: 'academic_paper',
      resourceId: id,
      changes: { method: 'POST', path: `/api/v1/academic-papers/${id}/restore` },
    });

    return { message: 'Paper restored', data: null };
  }

  async softDelete(id: string, userId: string) {
    const paper = await this.prisma.academic_papers.findFirst({
      where: { id, deleted_at: null },
      select: { id: true },
    });
    if (!paper) throw new NotFoundException('Paper not found');

    await this.prisma.academic_papers.update({ where: { id }, data: { deleted_at: new Date() } });

    await this.audit.write({
      actorId: userId,
      action: AUDIT_ACTIONS.ACADEMIC_PAPER_DELETED,
      resourceType: 'academic_paper',
      resourceId: id,
      changes: { method: 'DELETE', path: `/api/v1/academic-papers/${id}` },
    });

    return { message: 'Paper deleted', data: null };
  }
}
