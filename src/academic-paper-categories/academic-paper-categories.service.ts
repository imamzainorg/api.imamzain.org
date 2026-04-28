import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAcademicPaperCategoryDto, UpdateAcademicPaperCategoryDto } from './dto/academic-paper-category.dto';

@Injectable()
export class AcademicPaperCategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(lang: string | null) {
    const categories = await this.prisma.academic_paper_categories.findMany({
      where: { deleted_at: null },
      include: { academic_paper_category_translations: lang ? { where: { lang } } : true },
    });
    return { message: 'Categories fetched', data: categories };
  }

  async findOne(id: string, lang: string | null) {
    const category = await this.prisma.academic_paper_categories.findFirst({
      where: { id, deleted_at: null },
      include: { academic_paper_category_translations: lang ? { where: { lang } } : true },
    });
    if (!category) throw new NotFoundException('Category not found');
    return { message: 'Category fetched', data: category };
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

  async softDelete(id: string, actorId: string) {
    const category = await this.prisma.academic_paper_categories.findFirst({ where: { id, deleted_at: null } });
    if (!category) throw new NotFoundException('Category not found');

    await this.prisma.academic_paper_categories.update({ where: { id }, data: { deleted_at: new Date() } });

    try {
      await this.prisma.audit_logs.create({
        data: { user_id: actorId, action: 'ACADEMIC_PAPER_CATEGORY_DELETED', resource_type: 'academic_paper_category', resource_id: id, changes: { method: 'DELETE', path: `/api/v1/academic-paper-categories/${id}` } },
      });
    } catch {}

    return { message: 'Category deleted', data: null };
  }
}
