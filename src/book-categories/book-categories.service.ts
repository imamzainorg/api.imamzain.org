import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { softDeleteSuffix, stripSoftDeleteSuffix } from '../common/utils/soft-delete.util';
import { resolveTranslation } from '../common/utils/translation.util';
import { CreateBookCategoryDto, UpdateBookCategoryDto } from './dto/book-category.dto';

@Injectable()
export class BookCategoriesService {
  private readonly logger = new Logger(BookCategoriesService.name);

  constructor(private readonly prisma: PrismaService) {}

  async findAll(lang: string | null, page: number, limit: number) {
    const skip = (page - 1) * limit;
    const [categories, total] = await Promise.all([
      this.prisma.book_categories.findMany({
        where: { deleted_at: null },
        include: { book_category_translations: true },
        orderBy: [{ created_at: 'desc' }, { id: 'asc' }],
        skip,
        take: limit,
      }),
      this.prisma.book_categories.count({ where: { deleted_at: null } }),
    ]);
    const items = categories.map((c) => ({
      ...c,
      translation: resolveTranslation(c.book_category_translations, lang),
    }));
    return { message: 'Categories fetched', data: { items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } } };
  }

  async findOne(id: string, lang: string | null) {
    const category = await this.prisma.book_categories.findFirst({
      where: { id, deleted_at: null },
      include: { book_category_translations: true },
    });
    if (!category) throw new NotFoundException('Category not found');
    return {
      message: 'Category fetched',
      data: { ...category, translation: resolveTranslation(category.book_category_translations, lang) },
    };
  }

  async create(dto: CreateBookCategoryDto, actorId: string) {
    const category = await this.prisma.$transaction(async (tx) => {
      const created = await tx.book_categories.create({ data: {} });
      await tx.book_category_translations.createMany({
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
        data: { user_id: actorId, action: 'BOOK_CATEGORY_CREATED', resource_type: 'book_category', resource_id: category.id, changes: { method: 'POST', path: '/api/v1/book-categories' } },
      });
    } catch {}

    return { message: 'Category created', data: category };
  }

  async update(id: string, dto: UpdateBookCategoryDto, actorId: string) {
    const category = await this.prisma.book_categories.findFirst({ where: { id, deleted_at: null } });
    if (!category) throw new NotFoundException('Category not found');

    if (dto.translations) {
      for (const t of dto.translations) {
        await this.prisma.book_category_translations.upsert({
          where: { category_id_lang: { category_id: id, lang: t.lang } },
          create: { category_id: id, lang: t.lang, title: t.title, slug: t.slug, description: t.description ?? null },
          update: { title: t.title, slug: t.slug, description: t.description ?? null },
        });
      }
    }

    try {
      await this.prisma.audit_logs.create({
        data: { user_id: actorId, action: 'BOOK_CATEGORY_UPDATED', resource_type: 'book_category', resource_id: id, changes: { method: 'PATCH', path: `/api/v1/book-categories/${id}` } },
      });
    } catch {}

    return { message: 'Category updated', data: null };
  }

  /** List soft-deleted book categories. */
  async findTrash(page: number, limit: number) {
    const skip = (page - 1) * limit;
    const where = { deleted_at: { not: null } };
    const [items, total] = await Promise.all([
      this.prisma.book_categories.findMany({
        where,
        include: { book_category_translations: true },
        orderBy: [{ deleted_at: 'desc' }, { id: 'asc' }],
        skip,
        take: limit,
      }),
      this.prisma.book_categories.count({ where }),
    ]);
    return {
      message: 'Trash fetched',
      data: { items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } },
    };
  }

  /**
   * Restore a soft-deleted book category. Reverses the slug suffix from
   * softDelete; refused with 409 on slug conflict.
   */
  async restore(id: string, actorId: string) {
    const category = await this.prisma.book_categories.findFirst({
      where: { id, deleted_at: { not: null } },
      include: { book_category_translations: true },
    });
    if (!category) throw new NotFoundException('Deleted category not found');

    const restoredSlugs = category.book_category_translations.map((t) => ({
      lang: t.lang,
      original: stripSoftDeleteSuffix(t.slug),
    }));

    await this.prisma.$transaction(async (tx) => {
      for (const { lang, original } of restoredSlugs) {
        const conflict = await tx.book_category_translations.findFirst({
          where: { lang, slug: original, NOT: { category_id: id } },
        });
        if (conflict) {
          throw new ConflictException(
            `Cannot restore: slug "${original}" (${lang}) is now used by another category`,
          );
        }
      }
      for (const { lang, original } of restoredSlugs) {
        await tx.book_category_translations.update({
          where: { category_id_lang: { category_id: id, lang } },
          data: { slug: original },
        });
      }
      await tx.book_categories.update({ where: { id }, data: { deleted_at: null } });
    });

    try {
      await this.prisma.audit_logs.create({
        data: { user_id: actorId, action: 'BOOK_CATEGORY_RESTORED', resource_type: 'book_category', resource_id: id, changes: { method: 'POST', path: `/api/v1/book-categories/${id}/restore` } },
      });
    } catch (err) {
      this.logger.warn(`Failed to write BOOK_CATEGORY_RESTORED audit: ${err}`);
    }

    return { message: 'Category restored', data: null };
  }

  async softDelete(id: string, actorId: string) {
    const category = await this.prisma.book_categories.findFirst({ where: { id, deleted_at: null } });
    if (!category) throw new NotFoundException('Category not found');

    const bookCount = await this.prisma.books.count({ where: { category_id: id, deleted_at: null } });
    if (bookCount > 0) throw new ConflictException('Cannot delete a category that contains books');

    // Free the (lang, slug) unique constraint so a new category can claim
    // the slug while this one is in the trash. Restore reverses it.
    const deletedAt = new Date();
    const suffix = softDeleteSuffix(deletedAt);

    await this.prisma.$transaction(async (tx) => {
      const translations = await tx.book_category_translations.findMany({ where: { category_id: id } });
      for (const t of translations) {
        await tx.book_category_translations.update({
          where: { category_id_lang: { category_id: id, lang: t.lang } },
          data: { slug: `${t.slug}${suffix}` },
        });
      }
      await tx.book_categories.update({ where: { id }, data: { deleted_at: deletedAt } });
    });

    try {
      await this.prisma.audit_logs.create({
        data: { user_id: actorId, action: 'BOOK_CATEGORY_DELETED', resource_type: 'book_category', resource_id: id, changes: { method: 'DELETE', path: `/api/v1/book-categories/${id}` } },
      });
    } catch {}

    return { message: 'Category deleted', data: null };
  }
}
