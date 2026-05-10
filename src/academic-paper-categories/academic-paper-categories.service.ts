import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { resolveTranslation } from '../common/utils/translation.util';
import { CreateAcademicPaperCategoryDto, UpdateAcademicPaperCategoryDto } from './dto/academic-paper-category.dto';

@Injectable()
export class AcademicPaperCategoriesService {
  private readonly logger = new Logger(AcademicPaperCategoriesService.name);

  constructor(private readonly prisma: PrismaService) {}

  async findAll(lang: string | null, page: number, limit: number) {
    const skip = (page - 1) * limit;
    const [categories, total] = await Promise.all([
      this.prisma.academic_paper_categories.findMany({
        where: { deleted_at: null },
        include: { academic_paper_category_translations: true },
        orderBy: [{ created_at: 'desc' }, { id: 'asc' }],
        skip,
        take: limit,
      }),
      this.prisma.academic_paper_categories.count({ where: { deleted_at: null } }),
    ]);
    const items = categories.map((c) => ({
      ...c,
      translation: resolveTranslation(c.academic_paper_category_translations, lang),
    }));
    return { message: 'Categories fetched', data: { items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } } };
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

    try {
      await this.prisma.audit_logs.create({
        data: { user_id: actorId, action: 'ACADEMIC_PAPER_CATEGORY_CREATED', resource_type: 'academic_paper_category', resource_id: category.id, changes: { method: 'POST', path: '/api/v1/academic-paper-categories' } },
      });
    } catch {}

    return { message: 'Category created', data: category };
  }

  async update(id: string, dto: UpdateAcademicPaperCategoryDto, actorId: string) {
    const category = await this.prisma.academic_paper_categories.findFirst({ where: { id, deleted_at: null } });
    if (!category) throw new NotFoundException('Category not found');

    if (dto.translations) {
      for (const t of dto.translations) {
        await this.prisma.academic_paper_category_translations.upsert({
          where: { category_id_lang: { category_id: id, lang: t.lang } },
          create: { category_id: id, lang: t.lang, title: t.title, slug: t.slug, description: t.description ?? null },
          update: { title: t.title, slug: t.slug, description: t.description ?? null },
        });
      }
    }

    try {
      await this.prisma.audit_logs.create({
        data: { user_id: actorId, action: 'ACADEMIC_PAPER_CATEGORY_UPDATED', resource_type: 'academic_paper_category', resource_id: id, changes: { method: 'PATCH', path: `/api/v1/academic-paper-categories/${id}` } },
      });
    } catch {}

    return { message: 'Category updated', data: null };
  }

  /** List soft-deleted academic paper categories. */
  async findTrash(page: number, limit: number) {
    const skip = (page - 1) * limit;
    const where = { deleted_at: { not: null } };
    const [items, total] = await Promise.all([
      this.prisma.academic_paper_categories.findMany({
        where,
        include: { academic_paper_category_translations: true },
        orderBy: [{ deleted_at: 'desc' }, { id: 'asc' }],
        skip,
        take: limit,
      }),
      this.prisma.academic_paper_categories.count({ where }),
    ]);
    return {
      message: 'Trash fetched',
      data: { items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } },
    };
  }

  /** Restore a soft-deleted academic paper category. */
  async restore(id: string, actorId: string) {
    const category = await this.prisma.academic_paper_categories.findFirst({
      where: { id, deleted_at: { not: null } },
    });
    if (!category) throw new NotFoundException('Deleted category not found');

    await this.prisma.academic_paper_categories.update({ where: { id }, data: { deleted_at: null } });

    try {
      await this.prisma.audit_logs.create({
        data: { user_id: actorId, action: 'ACADEMIC_PAPER_CATEGORY_RESTORED', resource_type: 'academic_paper_category', resource_id: id, changes: { method: 'POST', path: `/api/v1/academic-paper-categories/${id}/restore` } },
      });
    } catch (err) {
      this.logger.warn(`Failed to write ACADEMIC_PAPER_CATEGORY_RESTORED audit: ${err}`);
    }

    return { message: 'Category restored', data: null };
  }

  async softDelete(id: string, actorId: string) {
    const category = await this.prisma.academic_paper_categories.findFirst({ where: { id, deleted_at: null } });
    if (!category) throw new NotFoundException('Category not found');

    const paperCount = await this.prisma.academic_papers.count({ where: { category_id: id, deleted_at: null } });
    if (paperCount > 0) throw new ConflictException('Cannot delete a category that contains academic papers');

    await this.prisma.academic_paper_categories.update({ where: { id }, data: { deleted_at: new Date() } });

    try {
      await this.prisma.audit_logs.create({
        data: { user_id: actorId, action: 'ACADEMIC_PAPER_CATEGORY_DELETED', resource_type: 'academic_paper_category', resource_id: id, changes: { method: 'DELETE', path: `/api/v1/academic-paper-categories/${id}` } },
      });
    } catch {}

    return { message: 'Category deleted', data: null };
  }
}
