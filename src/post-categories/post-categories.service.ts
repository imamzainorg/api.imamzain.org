import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
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

  /** Restore a soft-deleted post category. */
  async restore(id: string, actorId: string) {
    const category = await this.prisma.post_categories.findFirst({
      where: { id, deleted_at: { not: null } },
    });
    if (!category) throw new NotFoundException('Deleted category not found');

    await this.prisma.post_categories.update({ where: { id }, data: { deleted_at: null } });

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

    await this.prisma.post_categories.update({ where: { id }, data: { deleted_at: new Date() } });

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
