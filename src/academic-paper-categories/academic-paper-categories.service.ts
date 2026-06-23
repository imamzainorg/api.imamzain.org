import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import { AUDIT_ACTIONS } from '../common/audit/audit.actions';
import { softDeleteSuffix, stripSoftDeleteSuffix } from '../common/utils/soft-delete.util';
import { resolveTranslation } from '../common/utils/translation.util';
import { buildPaginationMeta } from '../common/utils/pagination.util';
import { CreateAcademicPaperCategoryDto, UpdateAcademicPaperCategoryDto } from './dto/academic-paper-category.dto';

@Injectable()
export class AcademicPaperCategoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async findAll(lang: string | null, page: number, limit: number) {
    const skip = (page - 1) * limit;
    const where: Prisma.academic_paper_categoriesWhereInput = { deleted_at: null };
    const [categories, total] = await Promise.all([
      this.prisma.academic_paper_categories.findMany({
        where,
        include: { academic_paper_category_translations: true },
        orderBy: [{ created_at: 'desc' }, { id: 'asc' }],
        skip,
        take: limit,
      }),
      this.prisma.academic_paper_categories.count({ where }),
    ]);
    const items = categories.map((c) => ({
      ...c,
      translation: resolveTranslation(c.academic_paper_category_translations, lang),
    }));
    return { message: 'Categories fetched', data: { items, pagination: buildPaginationMeta(page, limit, total) } };
  }

  async findOne(id: string, lang: string | null) {
    const category = await this.prisma.academic_paper_categories.findFirst({
      where: { id, deleted_at: null },
      include: { academic_paper_category_translations: true },
    });
    if (!category) throw new NotFoundException('Category not found');
    return {
      message: 'Category fetched',
      data: { ...category, translation: resolveTranslation(category.academic_paper_category_translations, lang) },
    };
  }

  async create(dto: CreateAcademicPaperCategoryDto, actorId: string) {
    const category = await this.prisma.$transaction(async (tx) => {
      const created = await tx.academic_paper_categories.create({ data: {} });
      await tx.academic_paper_category_translations.createMany({
        data: dto.translations.map((t) => ({
          category_id: created.id,
          lang: t.lang,
          title: t.title,
          slug: t.slug,
          description: t.description ?? null,
        })),
      });
      return created;
    });

    await this.audit.write({
      actorId,
      action: AUDIT_ACTIONS.ACADEMIC_PAPER_CATEGORY_CREATED,
      resourceType: 'academic_paper_category',
      resourceId: category.id,
      changes: { method: 'POST', path: '/api/v1/academic-paper-categories' },
    });

    const { data } = await this.findOne(category.id, null);
    return { message: 'Category created', data };
  }

  async update(id: string, dto: UpdateAcademicPaperCategoryDto, actorId: string) {
    const category = await this.prisma.academic_paper_categories.findFirst({ where: { id, deleted_at: null } });
    if (!category) throw new NotFoundException('Category not found');

    if (dto.translations) {
      // Apply all translation upserts atomically (matches create/restore/
      // softDelete here and the sibling main-resource updates) so a mid-loop
      // failure can't leave the category half-updated.
      await this.prisma.$transaction(
        dto.translations.map((t) =>
          this.prisma.academic_paper_category_translations.upsert({
            where: { category_id_lang: { category_id: id, lang: t.lang } },
            create: { category_id: id, lang: t.lang, title: t.title, slug: t.slug, description: t.description ?? null },
            update: { title: t.title, slug: t.slug, description: t.description ?? null },
          }),
        ),
      );
    }

    await this.audit.write({
      actorId,
      action: AUDIT_ACTIONS.ACADEMIC_PAPER_CATEGORY_UPDATED,
      resourceType: 'academic_paper_category',
      resourceId: id,
      changes: { method: 'PATCH', path: `/api/v1/academic-paper-categories/${id}` },
    });

    const { data } = await this.findOne(id, null);
    return { message: 'Category updated', data };
  }

  /** List soft-deleted academic paper categories. */
  async findTrash(page: number, limit: number) {
    const skip = (page - 1) * limit;
    const where: Prisma.academic_paper_categoriesWhereInput = { deleted_at: { not: null } };
    const [rows, total] = await Promise.all([
      this.prisma.academic_paper_categories.findMany({
        where,
        include: { academic_paper_category_translations: true },
        orderBy: [{ deleted_at: 'desc' }, { id: 'asc' }],
        skip,
        take: limit,
      }),
      this.prisma.academic_paper_categories.count({ where }),
    ]);
    const items = rows.map((row) => {
      const academic_paper_category_translations = row.academic_paper_category_translations.map((t) => ({
        ...t,
        slug: stripSoftDeleteSuffix(t.slug),
      }));
      return {
        ...row,
        academic_paper_category_translations,
        translation: resolveTranslation(academic_paper_category_translations, null),
      };
    });
    return {
      message: 'Trash fetched',
      data: { items, pagination: buildPaginationMeta(page, limit, total) },
    };
  }

  /**
   * Restore a soft-deleted academic paper category. Reverses the slug
   * suffix from softDelete; refused with 409 on slug conflict.
   */
  async restore(id: string, actorId: string) {
    const category = await this.prisma.academic_paper_categories.findFirst({
      where: { id, deleted_at: { not: null } },
      include: { academic_paper_category_translations: true },
    });
    if (!category) throw new NotFoundException('Deleted category not found');

    const restoredSlugs = category.academic_paper_category_translations.map((t) => ({
      lang: t.lang,
      original: stripSoftDeleteSuffix(t.slug),
    }));

    await this.prisma.$transaction(async (tx) => {
      for (const { lang, original } of restoredSlugs) {
        const conflict = await tx.academic_paper_category_translations.findFirst({
          where: { lang, slug: original, NOT: { category_id: id } },
        });
        if (conflict) {
          throw new ConflictException(
            `Cannot restore: slug "${original}" (${lang}) is now used by another category`,
          );
        }
      }
      for (const { lang, original } of restoredSlugs) {
        await tx.academic_paper_category_translations.update({
          where: { category_id_lang: { category_id: id, lang } },
          data: { slug: original },
        });
      }
      await tx.academic_paper_categories.update({ where: { id }, data: { deleted_at: null } });
    });

    await this.audit.write({
      actorId,
      action: AUDIT_ACTIONS.ACADEMIC_PAPER_CATEGORY_RESTORED,
      resourceType: 'academic_paper_category',
      resourceId: id,
      changes: { method: 'POST', path: `/api/v1/academic-paper-categories/${id}/restore` },
    });

    return { message: 'Category restored', data: null };
  }

  async softDelete(id: string, actorId: string) {
    const category = await this.prisma.academic_paper_categories.findFirst({ where: { id, deleted_at: null } });
    if (!category) throw new NotFoundException('Category not found');

    const paperCount = await this.prisma.academic_papers.count({ where: { category_id: id, deleted_at: null } });
    if (paperCount > 0) throw new ConflictException('Cannot delete a category that contains academic papers');

    // Free the (lang, slug) unique constraint; restore reverses it.
    const deletedAt = new Date();
    const suffix = softDeleteSuffix(deletedAt);

    await this.prisma.$transaction(async (tx) => {
      const translations = await tx.academic_paper_category_translations.findMany({ where: { category_id: id } });
      for (const t of translations) {
        await tx.academic_paper_category_translations.update({
          where: { category_id_lang: { category_id: id, lang: t.lang } },
          data: { slug: `${t.slug}${suffix}` },
        });
      }
      await tx.academic_paper_categories.update({ where: { id }, data: { deleted_at: deletedAt } });
    });

    await this.audit.write({
      actorId,
      action: AUDIT_ACTIONS.ACADEMIC_PAPER_CATEGORY_DELETED,
      resourceType: 'academic_paper_category',
      resourceId: id,
      changes: { method: 'DELETE', path: `/api/v1/academic-paper-categories/${id}` },
    });

    return { message: 'Category deleted', data: null };
  }
}
