import { ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuditAction } from '../audit/audit.actions';
import { softDeleteSuffix, stripSoftDeleteSuffix } from '../utils/soft-delete.util';
import { resolveTranslation } from '../utils/translation.util';
import { buildPaginationMeta } from '../utils/pagination.util';

export interface CategoryTranslationInput {
  lang: string;
  title: string;
  slug: string;
  description?: string | null;
}

export interface CategoryCrudConfig {
  /** Prisma model name for the category table, e.g. 'book_categories'. */
  categoryModel: string;
  /** Prisma model + relation name for the translations, e.g. 'book_category_translations'. */
  translationModel: string;
  /** audit_logs resource_type, e.g. 'book_category'. */
  resourceType: string;
  /** REST base path segment, e.g. 'book-categories'. */
  basePath: string;
  audit: { created: AuditAction; updated: AuditAction; deleted: AuditAction; restored: AuditAction };
  /** Number of live (non-deleted) children that must be reassigned before delete. */
  countLiveChildren: (id: string) => Promise<number>;
  /** 409 message returned when countLiveChildren > 0. */
  childConflictMessage: string;
}

/**
 * Shared CRUD + i18n + soft-delete/restore + audit logic for the four
 * near-identical *-categories resources (book / post / academic-paper /
 * gallery). Each concrete service supplies a CategoryCrudConfig; everything
 * else — pagination, translation resolution, the slug-suffix soft-delete
 * dance, the restore conflict check, and audit writes — lives here.
 *
 * All category translation tables share the same shape: FK `category_id`,
 * compound unique `category_id_lang`, fields `{ title, slug, description }`.
 * Prisma's per-model delegates are reached by name (this.prisma[model] /
 * tx[model]); the `any` casts that requires are confined to this file.
 */
export abstract class TranslatableCategoryService {
  protected abstract readonly config: CategoryCrudConfig;

  constructor(
    protected readonly prisma: PrismaService,
    protected readonly audit: AuditService,
  ) {}

  private get model(): any {
    return (this.prisma as any)[this.config.categoryModel];
  }

  private get translation(): any {
    return (this.prisma as any)[this.config.translationModel];
  }

  async findAll(lang: string | null, page: number, limit: number) {
    const rel = this.config.translationModel;
    const skip = (page - 1) * limit;
    const where = { deleted_at: null };
    const [categories, total] = await Promise.all([
      this.model.findMany({
        where,
        include: { [rel]: true },
        orderBy: [{ created_at: 'desc' }, { id: 'asc' }],
        skip,
        take: limit,
      }),
      this.model.count({ where }),
    ]);
    const items = categories.map((c: any) => ({
      ...c,
      translation: resolveTranslation(c[rel], lang),
    }));
    return { message: 'Categories fetched', data: { items, pagination: buildPaginationMeta(page, limit, total) } };
  }

  async findOne(id: string, lang: string | null) {
    const rel = this.config.translationModel;
    const category = await this.model.findFirst({
      where: { id, deleted_at: null },
      include: { [rel]: true },
    });
    if (!category) throw new NotFoundException('Category not found');
    return {
      message: 'Category fetched',
      data: { ...category, translation: resolveTranslation(category[rel], lang) },
    };
  }

  async create(dto: { translations: CategoryTranslationInput[] }, actorId: string) {
    const { categoryModel, translationModel } = this.config;
    const category = await this.prisma.$transaction(async (tx: any) => {
      const created = await tx[categoryModel].create({ data: {} });
      await tx[translationModel].createMany({
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
      action: this.config.audit.created,
      resourceType: this.config.resourceType,
      resourceId: category.id,
      changes: { method: 'POST', path: `/api/v1/${this.config.basePath}` },
    });

    const { data } = await this.findOne(category.id, null);
    return { message: 'Category created', data };
  }

  async update(id: string, dto: { translations?: CategoryTranslationInput[] }, actorId: string) {
    const category = await this.model.findFirst({ where: { id, deleted_at: null } });
    if (!category) throw new NotFoundException('Category not found');

    if (dto.translations) {
      // Apply all translation upserts atomically so a mid-loop failure can't
      // leave the category half-updated.
      await this.prisma.$transaction(
        dto.translations.map((t) =>
          this.translation.upsert({
            where: { category_id_lang: { category_id: id, lang: t.lang } },
            create: { category_id: id, lang: t.lang, title: t.title, slug: t.slug, description: t.description ?? null },
            update: { title: t.title, slug: t.slug, description: t.description ?? null },
          }),
        ),
      );
    }

    await this.audit.write({
      actorId,
      action: this.config.audit.updated,
      resourceType: this.config.resourceType,
      resourceId: id,
      changes: { method: 'PATCH', path: `/api/v1/${this.config.basePath}/${id}` },
    });

    const { data } = await this.findOne(id, null);
    return { message: 'Category updated', data };
  }

  /** List soft-deleted categories with translation slugs unsuffixed for display. */
  async findTrash(page: number, limit: number) {
    const rel = this.config.translationModel;
    const skip = (page - 1) * limit;
    const where = { deleted_at: { not: null } };
    const [rows, total] = await Promise.all([
      this.model.findMany({
        where,
        include: { [rel]: true },
        orderBy: [{ deleted_at: 'desc' }, { id: 'asc' }],
        skip,
        take: limit,
      }),
      this.model.count({ where }),
    ]);
    const items = rows.map((row: any) => {
      const translations = row[rel].map((t: any) => ({ ...t, slug: stripSoftDeleteSuffix(t.slug) }));
      return {
        ...row,
        [rel]: translations,
        translation: resolveTranslation(translations, null),
      };
    });
    return { message: 'Trash fetched', data: { items, pagination: buildPaginationMeta(page, limit, total) } };
  }

  /**
   * Restore a soft-deleted category. Reverses the slug suffix from softDelete;
   * refused with 409 if a live category has taken the original (lang, slug).
   */
  async restore(id: string, actorId: string) {
    const { categoryModel, translationModel } = this.config;
    const category = await this.model.findFirst({
      where: { id, deleted_at: { not: null } },
      include: { [translationModel]: true },
    });
    if (!category) throw new NotFoundException('Deleted category not found');

    const restoredSlugs = category[translationModel].map((t: any) => ({
      lang: t.lang,
      original: stripSoftDeleteSuffix(t.slug),
    }));

    await this.prisma.$transaction(async (tx: any) => {
      for (const { lang, original } of restoredSlugs) {
        const conflict = await tx[translationModel].findFirst({
          where: { lang, slug: original, NOT: { category_id: id } },
        });
        if (conflict) {
          throw new ConflictException(
            `Cannot restore: slug "${original}" (${lang}) is now used by another category`,
          );
        }
      }
      for (const { lang, original } of restoredSlugs) {
        await tx[translationModel].update({
          where: { category_id_lang: { category_id: id, lang } },
          data: { slug: original },
        });
      }
      await tx[categoryModel].update({ where: { id }, data: { deleted_at: null } });
    });

    await this.audit.write({
      actorId,
      action: this.config.audit.restored,
      resourceType: this.config.resourceType,
      resourceId: id,
      changes: { method: 'POST', path: `/api/v1/${this.config.basePath}/${id}/restore` },
    });

    return { message: 'Category restored', data: null };
  }

  async softDelete(id: string, actorId: string) {
    const { categoryModel, translationModel } = this.config;
    const category = await this.model.findFirst({ where: { id, deleted_at: null } });
    if (!category) throw new NotFoundException('Category not found');

    const childCount = await this.config.countLiveChildren(id);
    if (childCount > 0) throw new ConflictException(this.config.childConflictMessage);

    // Free the (lang, slug) unique constraint so a new category can claim the
    // slug while this one is in the trash. Restore reverses it.
    const deletedAt = new Date();
    const suffix = softDeleteSuffix(deletedAt);

    await this.prisma.$transaction(async (tx: any) => {
      const translations = await tx[translationModel].findMany({ where: { category_id: id } });
      for (const t of translations) {
        await tx[translationModel].update({
          where: { category_id_lang: { category_id: id, lang: t.lang } },
          data: { slug: `${t.slug}${suffix}` },
        });
      }
      await tx[categoryModel].update({ where: { id }, data: { deleted_at: deletedAt } });
    });

    await this.audit.write({
      actorId,
      action: this.config.audit.deleted,
      resourceType: this.config.resourceType,
      resourceId: id,
      changes: { method: 'DELETE', path: `/api/v1/${this.config.basePath}/${id}` },
    });

    return { message: 'Category deleted', data: null };
  }
}
