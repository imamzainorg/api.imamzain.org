import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import { AUDIT_ACTIONS } from '../common/audit/audit.actions';
import { softDeleteSuffix, stripSoftDeleteSuffix } from '../common/utils/soft-delete.util';
import { resolveTranslation } from '../common/utils/translation.util';
import { buildPaginationMeta } from '../common/utils/pagination.util';
import { CreatePostCategoryDto, UpdatePostCategoryDto } from './dto/post-category.dto';

@Injectable()
export class PostCategoriesService {
  private readonly logger = new Logger(PostCategoriesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async findAll(lang: string | null, page: number, limit: number) {
    const skip = (page - 1) * limit;
    const where: Prisma.post_categoriesWhereInput = { deleted_at: null };
    const [categories, total] = await Promise.all([
      this.prisma.post_categories.findMany({
        where,
        include: { post_category_translations: true },
        orderBy: [{ created_at: 'desc' }, { id: 'asc' }],
        skip,
        take: limit,
      }),
      this.prisma.post_categories.count({ where }),
    ]);
    const items = categories.map((c) => ({
      ...c,
      translation: resolveTranslation(c.post_category_translations, lang),
    }));
    return { message: 'Categories fetched', data: { items, pagination: buildPaginationMeta(page, limit, total) } };
  }

  async findOne(id: string, lang: string | null) {
    const category = await this.prisma.post_categories.findFirst({
      where: { id, deleted_at: null },
      include: { post_category_translations: true },
    });
    if (!category) throw new NotFoundException('Category not found');
    return {
      message: 'Category fetched',
      data: { ...category, translation: resolveTranslation(category.post_category_translations, lang) },
    };
  }

  async create(dto: CreatePostCategoryDto, actorId: string) {
    const category = await this.prisma.$transaction(async (tx) => {
      const created = await tx.post_categories.create({ data: {} });
      await tx.post_category_translations.createMany({
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
      action: AUDIT_ACTIONS.POST_CATEGORY_CREATED,
      resourceType: 'post_category',
      resourceId: category.id,
      changes: { method: 'POST', path: '/api/v1/post-categories' },
    });

    const { data } = await this.findOne(category.id, null);
    return { message: 'Category created', data };
  }

  async update(id: string, dto: UpdatePostCategoryDto, actorId: string) {
    const category = await this.prisma.post_categories.findFirst({ where: { id, deleted_at: null } });
    if (!category) throw new NotFoundException('Category not found');

    if (dto.translations) {
      for (const t of dto.translations) {
        await this.prisma.post_category_translations.upsert({
          where: { category_id_lang: { category_id: id, lang: t.lang } },
          create: { category_id: id, lang: t.lang, title: t.title, slug: t.slug, description: t.description ?? null },
          update: { title: t.title, slug: t.slug, description: t.description ?? null },
        });
      }
    }

    await this.audit.write({
      actorId,
      action: AUDIT_ACTIONS.POST_CATEGORY_UPDATED,
      resourceType: 'post_category',
      resourceId: id,
      changes: { method: 'PATCH', path: `/api/v1/post-categories/${id}` },
    });

    const { data } = await this.findOne(id, null);
    return { message: 'Category updated', data };
  }

  /** List soft-deleted post categories. */
  async findTrash(page: number, limit: number) {
    const skip = (page - 1) * limit;
    const where: Prisma.post_categoriesWhereInput = { deleted_at: { not: null } };
    const [rows, total] = await Promise.all([
      this.prisma.post_categories.findMany({
        where,
        include: { post_category_translations: true },
        orderBy: [{ deleted_at: 'desc' }, { id: 'asc' }],
        skip,
        take: limit,
      }),
      this.prisma.post_categories.count({ where }),
    ]);
    const items = rows.map((row) => {
      const post_category_translations = row.post_category_translations.map((t) => ({
        ...t,
        slug: stripSoftDeleteSuffix(t.slug),
      }));
      return {
        ...row,
        post_category_translations,
        translation: resolveTranslation(post_category_translations, null),
      };
    });
    return {
      message: 'Trash fetched',
      data: { items, pagination: buildPaginationMeta(page, limit, total) },
    };
  }

  /**
   * Restore a soft-deleted post category. Reverses the slug-suffix trick
   * from softDelete; refused with 409 if a live category has taken the
   * original (lang, slug) since the delete — operator must rename one
   * side and retry.
   */
  async restore(id: string, actorId: string) {
    const category = await this.prisma.post_categories.findFirst({
      where: { id, deleted_at: { not: null } },
      include: { post_category_translations: true },
    });
    if (!category) throw new NotFoundException('Deleted category not found');

    const restoredSlugs = category.post_category_translations.map((t) => ({
      lang: t.lang,
      original: stripSoftDeleteSuffix(t.slug),
    }));

    await this.prisma.$transaction(async (tx) => {
      for (const { lang, original } of restoredSlugs) {
        const conflict = await tx.post_category_translations.findFirst({
          where: { lang, slug: original, NOT: { category_id: id } },
        });
        if (conflict) {
          throw new ConflictException(
            `Cannot restore: slug "${original}" (${lang}) is now used by another category`,
          );
        }
      }

      for (const { lang, original } of restoredSlugs) {
        await tx.post_category_translations.update({
          where: { category_id_lang: { category_id: id, lang } },
          data: { slug: original },
        });
      }

      await tx.post_categories.update({ where: { id }, data: { deleted_at: null } });
    });

    await this.audit.write({
      actorId,
      action: AUDIT_ACTIONS.POST_CATEGORY_RESTORED,
      resourceType: 'post_category',
      resourceId: id,
      changes: { method: 'POST', path: `/api/v1/post-categories/${id}/restore` },
    });

    return { message: 'Category restored', data: null };
  }

  async softDelete(id: string, actorId: string) {
    const category = await this.prisma.post_categories.findFirst({ where: { id, deleted_at: null } });
    if (!category) throw new NotFoundException('Category not found');

    const postCount = await this.prisma.posts.count({ where: { category_id: id, deleted_at: null } });
    if (postCount > 0) throw new ConflictException('Cannot delete a category that contains posts');

    // Free the (lang, slug) unique constraint on translations so a new
    // category can claim the slug while this one is in the trash. Restore
    // reverses the suffix.
    const deletedAt = new Date();
    const suffix = softDeleteSuffix(deletedAt);

    await this.prisma.$transaction(async (tx) => {
      const translations = await tx.post_category_translations.findMany({ where: { category_id: id } });
      for (const t of translations) {
        await tx.post_category_translations.update({
          where: { category_id_lang: { category_id: id, lang: t.lang } },
          data: { slug: `${t.slug}${suffix}` },
        });
      }
      await tx.post_categories.update({ where: { id }, data: { deleted_at: deletedAt } });
    });

    await this.audit.write({
      actorId,
      action: AUDIT_ACTIONS.POST_CATEGORY_DELETED,
      resourceType: 'post_category',
      resourceId: id,
      changes: { method: 'DELETE', path: `/api/v1/post-categories/${id}` },
    });

    return { message: 'Category deleted', data: null };
  }
}
