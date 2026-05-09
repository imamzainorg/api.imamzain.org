import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { resolveTranslation } from '../common/utils/translation.util';
import { CreateGalleryCategoryDto, UpdateGalleryCategoryDto } from './dto/gallery-category.dto';

@Injectable()
export class GalleryCategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(lang: string | null, page: number, limit: number) {
    const skip = (page - 1) * limit;
    const [categories, total] = await Promise.all([
      this.prisma.gallery_categories.findMany({
        where: { deleted_at: null },
        include: { gallery_category_translations: true },
        orderBy: [{ created_at: 'desc' }, { id: 'asc' }],
        skip,
        take: limit,
      }),
      this.prisma.gallery_categories.count({ where: { deleted_at: null } }),
    ]);
    const items = categories.map((c) => ({
      ...c,
      translation: resolveTranslation(c.gallery_category_translations, lang),
    }));
    return { message: 'Categories fetched', data: { items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } } };
  }

  async findOne(id: string, lang: string | null) {
    const category = await this.prisma.gallery_categories.findFirst({
      where: { id, deleted_at: null },
      include: { gallery_category_translations: true },
    });
    if (!category) throw new NotFoundException('Category not found');
    return {
      message: 'Category fetched',
      data: { ...category, translation: resolveTranslation(category.gallery_category_translations, lang) },
    };
  }

  async create(dto: CreateGalleryCategoryDto, actorId: string) {
    const category = await this.prisma.$transaction(async (tx) => {
      const created = await tx.gallery_categories.create({ data: {} });
      await tx.gallery_category_translations.createMany({
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
        data: { user_id: actorId, action: 'GALLERY_CATEGORY_CREATED', resource_type: 'gallery_category', resource_id: category.id, changes: { method: 'POST', path: '/api/v1/gallery-categories' } },
      });
    } catch {}

    return { message: 'Category created', data: category };
  }

  async update(id: string, dto: UpdateGalleryCategoryDto, actorId: string) {
    const category = await this.prisma.gallery_categories.findFirst({ where: { id, deleted_at: null } });
    if (!category) throw new NotFoundException('Category not found');

    if (dto.translations) {
      for (const t of dto.translations) {
        await this.prisma.gallery_category_translations.upsert({
          where: { category_id_lang: { category_id: id, lang: t.lang } },
          create: { category_id: id, lang: t.lang, title: t.title, slug: t.slug, description: t.description ?? null },
          update: { title: t.title, slug: t.slug, description: t.description ?? null },
        });
      }
    }

    try {
      await this.prisma.audit_logs.create({
        data: { user_id: actorId, action: 'GALLERY_CATEGORY_UPDATED', resource_type: 'gallery_category', resource_id: id, changes: { method: 'PATCH', path: `/api/v1/gallery-categories/${id}` } },
      });
    } catch {}

    return { message: 'Category updated', data: null };
  }

  async softDelete(id: string, actorId: string) {
    const category = await this.prisma.gallery_categories.findFirst({ where: { id, deleted_at: null } });
    if (!category) throw new NotFoundException('Category not found');

    await this.prisma.gallery_categories.update({ where: { id }, data: { deleted_at: new Date() } });

    try {
      await this.prisma.audit_logs.create({
        data: { user_id: actorId, action: 'GALLERY_CATEGORY_DELETED', resource_type: 'gallery_category', resource_id: id, changes: { method: 'DELETE', path: `/api/v1/gallery-categories/${id}` } },
      });
    } catch {}

    return { message: 'Category deleted', data: null };
  }
}
