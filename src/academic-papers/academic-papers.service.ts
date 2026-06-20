import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import { AUDIT_ACTIONS } from '../common/audit/audit.actions';
import { resolveTranslation } from '../common/utils/translation.util';
import { softDeleteSuffix, stripSoftDeleteSuffix } from '../common/utils/soft-delete.util';
import { buildPaginationMeta, resolvePagination } from '../common/utils/pagination.util';
import { AcademicPaperQueryDto, CreateAcademicPaperDto, UpdateAcademicPaperDto } from './dto/academic-paper.dto';

// Resolvable per-translation OG image for SEO meta tags (detail only).
const OG_IMAGE_SELECT = {
  id: true,
  url: true,
  filename: true,
  alt_text: true,
  mime_type: true,
  width: true,
  height: true,
} satisfies Prisma.mediaSelect;

// List queries drop the abstract (heavy free-text) from translations.
const PAPER_LIST_SELECT = {
  id: true,
  category_id: true,
  published_year: true,
  pdf_url: true,
  uploaded_by: true,
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
      slug: true,
      meta_title: true,
      meta_description: true,
      og_image_id: true,
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
  private readonly logger = new Logger(AcademicPapersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async findAll(query: AcademicPaperQueryDto, lang: string | null) {
    const { page, limit, skip } = resolvePagination(query);

    const where: Prisma.academic_papersWhereInput = { deleted_at: null };
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

  async findOne(id: string, lang: string | null) {
    const paper = await this.prisma.academic_papers.findFirst({
      where: { id, deleted_at: null },
      include: {
        academic_paper_translations: { include: { og_image: { select: OG_IMAGE_SELECT } } },
        academic_paper_categories: { include: { academic_paper_category_translations: true } },
      },
    });
    if (!paper) throw new NotFoundException('Paper not found');
    return { message: 'Paper fetched', data: { ...paper, translation: resolveTranslation(paper.academic_paper_translations, lang) } };
  }

  /** Public detail by editor slug — resolves regardless of the visitor's lang. */
  async findBySlug(slug: string, lang: string | null) {
    const match = await this.prisma.academic_paper_translations.findFirst({
      where: { slug, academic_papers: { deleted_at: null } },
      select: { paper_id: true },
    });
    if (!match) throw new NotFoundException('Paper not found');
    return this.findOne(match.paper_id, lang);
  }

  /** Reject a slug that collides with another paper's live (lang, slug) pair. */
  private async assertSlugsAvailable(
    translations: { lang: string; slug?: string | null }[],
    excludePaperId: string | null,
  ) {
    for (const t of translations) {
      if (!t.slug) continue;
      const conflict = await this.prisma.academic_paper_translations.findFirst({
        where: {
          lang: t.lang,
          slug: t.slug,
          ...(excludePaperId ? { NOT: { paper_id: excludePaperId } } : {}),
        },
        select: { paper_id: true },
      });
      if (conflict) {
        throw new ConflictException(`Slug "${t.slug}" (${t.lang}) is already used by another paper`);
      }
    }
  }

  async create(dto: CreateAcademicPaperDto, userId: string, lang: string | null) {
    const category = await this.prisma.academic_paper_categories.findFirst({ where: { id: dto.category_id, deleted_at: null } });
    if (!category) throw new NotFoundException('Category not found');

    const defaultCount = dto.translations.filter((t) => t.is_default).length;
    if (defaultCount !== 1) throw new BadRequestException('Exactly one translation must have is_default: true');

    await this.assertSlugsAvailable(dto.translations, null);

    let paper;
    try {
      paper = await this.prisma.$transaction(async (tx) => {
        const created = await tx.academic_papers.create({
          data: {
            category_id: dto.category_id,
            published_year: dto.published_year ?? null,
            pdf_url: dto.pdf_url ?? null,
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
            slug: t.slug ?? null,
            meta_title: t.meta_title ?? null,
            meta_description: t.meta_description ?? null,
            og_image_id: t.og_image_id ?? null,
            is_default: t.is_default ?? false,
          })),
        });
        return created;
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('A paper translation slug is already in use');
      }
      throw err;
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

    if (dto.translations) await this.assertSlugsAvailable(dto.translations, id);

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
            slug: t.slug ?? null,
            meta_title: t.meta_title ?? null,
            meta_description: t.meta_description ?? null,
            og_image_id: t.og_image_id ?? null,
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
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('A paper translation slug is already in use');
      }
      throw err;
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

  /** Restore a soft-deleted academic paper. Reverses the per-translation slug suffix. */
  async restore(id: string, userId: string) {
    const paper = await this.prisma.academic_papers.findFirst({
      where: { id, deleted_at: { not: null } },
      include: { academic_paper_translations: true },
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

    const restoredSlugs = paper.academic_paper_translations
      .filter((t) => t.slug)
      .map((t) => ({ lang: t.lang, original: stripSoftDeleteSuffix(t.slug as string) }));

    try {
      await this.prisma.$transaction(async (tx) => {
        for (const { lang, original } of restoredSlugs) {
          const conflict = await tx.academic_paper_translations.findFirst({
            where: { lang, slug: original, NOT: { paper_id: id } },
            select: { paper_id: true },
          });
          if (conflict) {
            throw new ConflictException(`Cannot restore: slug "${original}" (${lang}) is now used by another paper`);
          }
        }

        for (const { lang, original } of restoredSlugs) {
          await tx.academic_paper_translations.update({
            where: { paper_id_lang: { paper_id: id, lang } },
            data: { slug: original },
          });
        }

        await tx.academic_papers.update({
          where: { id },
          data: { deleted_at: null, updated_at: new Date() },
        });
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('Cannot restore: a translation slug was claimed by another paper');
      }
      throw err;
    }

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
      include: { academic_paper_translations: true },
    });
    if (!paper) throw new NotFoundException('Paper not found');

    // Suffix any per-translation slug so the (lang, slug) partial-unique index
    // is freed for reuse while this paper sits in trash; restore reverses it.
    const deletedAt = new Date();
    const suffix = softDeleteSuffix(deletedAt);

    await this.prisma.$transaction(async (tx) => {
      for (const t of paper.academic_paper_translations) {
        if (t.slug) {
          await tx.academic_paper_translations.update({
            where: { paper_id_lang: { paper_id: id, lang: t.lang } },
            data: { slug: `${t.slug}${suffix}` },
          });
        }
      }
      await tx.academic_papers.update({ where: { id }, data: { deleted_at: deletedAt } });
    });

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
