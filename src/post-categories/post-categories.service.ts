import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { softDeleteSuffix, stripSoftDeleteSuffix } from '../common/utils/soft-delete.util';
import { resolveTranslation } from '../common/utils/translation.util';
import { CreatePostCategoryDto, UpdatePostCategoryDto } from './dto/post-category.dto';

@Injectable()
export class PostCategoriesService {
  private readonly logger = new Logger(PostCategoriesService.name);

  constructor(private readonly prisma: PrismaService) {}

  async findAll(lang: string | null, page: number, limit: number) {
    const skip = (page - 1) * limit;
    const [categories, total] = await Promise.all([
      this.prisma.post_categories.findMany({
        where: { deleted_at: null },
        include: { post_category_translations: true },
        orderBy: [{ created_at: 'desc' }, { id: 'asc' }],
        skip,
        take: limit,
      }),
      this.prisma.post_categories.count({ where: { deleted_at: null } }),
    ]);
    const items = categories.map((c) => ({
      ...c,
      translation: resolveTranslation(c.post_category_translations, lang),
    }));
    return { message: 'Categories fetched', data: { items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } } };
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

    try {
      await this.prisma.audit_logs.create({
        data: {
          user_id: actorId,
          action: 'POST_CATEGORY_CREATED',
          resource_type: 'post_category',
          resource_id: category.id,
          changes: { method: 'POST', path: '/api/v1/post-categories' },
        },
      });
    } catch {}

    return { message: 'Category created', data: category };
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

    try {
      await this.prisma.audit_logs.create({
        data: {
          user_id: actorId,
          action: 'POST_CATEGORY_UPDATED',
          resource_type: 'post_category',
          resource_id: id,
          changes: { method: 'PATCH', path: `/api/v1/post-categories/${id}` },
        },
      });
    } catch {}

    return { message: 'Category updated', data: null };
  }

  /** List soft-deleted post categories. */
  async findTrash(page: number, limit: number) {
    const skip = (page - 1) * limit;
    const where = { deleted_at: { not: null } };
    const [items, total] = await Promise.all([
      this.prisma.post_categories.findMany({
        where,
        include: { post_category_translations: true },
        orderBy: [{ deleted_at: 'desc' }, { id: 'asc' }],
        skip,
        take: limit,
      }),
      this.prisma.post_categories.count({ where }),
    ]);
    return {
      message: 'Trash fetched',
      data: { items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } },
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

    try {
      await this.prisma.audit_logs.create({
        data: {
          user_id: actorId,
          action: 'POST_CATEGORY_RESTORED',
          resource_type: 'post_category',
          resource_id: id,
          changes: { method: 'POST', path: `/api/v1/post-categories/${id}/restore` },
        },
      });
    } catch (err) {
      this.logger.warn(`Failed to write POST_CATEGORY_RESTORED audit: ${err}`);
    }

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

    try {
      await this.prisma.audit_logs.create({
        data: {
          user_id: actorId,
          action: 'POST_CATEGORY_DELETED',
          resource_type: 'post_category',
          resource_id: id,
          changes: { method: 'DELETE', path: `/api/v1/post-categories/${id}` },
        },
      });
    } catch {}

    return { message: 'Category deleted', data: null };
  }
}
