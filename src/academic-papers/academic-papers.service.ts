import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AcademicPaperQueryDto, CreateAcademicPaperDto, UpdateAcademicPaperDto } from './dto/academic-paper.dto';

function resolveTranslation(translations: any[], lang: string | null) {
  if (!translations || translations.length === 0) return null;
  if (lang) {
    const match = translations.find((t) => t.lang === lang);
    if (match) return match;
  }
  return translations.find((t) => t.is_default) ?? translations[0];
}

@Injectable()
export class AcademicPapersService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: AcademicPaperQueryDto, lang: string | null) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const where: any = { deleted_at: null };
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
        include: {
          academic_paper_translations: true,
          academic_paper_categories: { include: { academic_paper_category_translations: true } },
        },
        orderBy: { created_at: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.academic_papers.count({ where }),
    ]);

    const mapped = items.map((p) => ({ ...p, translation: resolveTranslation(p.academic_paper_translations, lang) }));
    return { message: 'Papers fetched', data: { items: mapped, pagination: { page, limit, total, pages: Math.ceil(total / limit) } } };
  }

  async findOne(id: string, lang: string | null) {
    const paper = await this.prisma.academic_papers.findFirst({
      where: { id, deleted_at: null },
      include: {
        academic_paper_translations: true,
        academic_paper_categories: { include: { academic_paper_category_translations: true } },
      },
    });
    if (!paper) throw new NotFoundException('Paper not found');
    return { message: 'Paper fetched', data: { ...paper, translation: resolveTranslation(paper.academic_paper_translations, lang) } };
  }

  async create(dto: CreateAcademicPaperDto, userId: string) {
    const category = await this.prisma.academic_paper_categories.findFirst({ where: { id: dto.category_id, deleted_at: null } });
    if (!category) throw new NotFoundException('Category not found');

    const paper = await this.prisma.$transaction(async (tx) => {
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
          is_default: t.is_default ?? false,
        })),
      });
      return created;
    });

    try {
      await this.prisma.audit_logs.create({
        data: { user_id: userId, action: 'ACADEMIC_PAPER_CREATED', resource_type: 'academic_paper', resource_id: paper.id, changes: { method: 'POST', path: '/api/v1/academic-papers' } },
      });
    } catch {}

    return { message: 'Paper created', data: paper };
  }

  async update(id: string, dto: UpdateAcademicPaperDto, userId: string) {
    const paper = await this.prisma.academic_papers.findFirst({ where: { id, deleted_at: null } });
    if (!paper) throw new NotFoundException('Paper not found');

    await this.prisma.$transaction(async (tx) => {
      const { translations, ...rest } = dto;
      await tx.academic_papers.update({ where: { id }, data: { ...rest, updated_at: new Date() } });
      if (translations) {
        for (const t of translations) {
          await tx.academic_paper_translations.upsert({
            where: { paper_id_lang: { paper_id: id, lang: t.lang } },
            create: { paper_id: id, lang: t.lang, title: t.title, abstract: t.abstract ?? null, authors: t.authors ?? [], keywords: t.keywords ?? [], publication_venue: t.publication_venue ?? null, page_count: t.page_count ?? null, is_default: t.is_default ?? false },
            update: { title: t.title, abstract: t.abstract ?? null, authors: t.authors ?? [], keywords: t.keywords ?? [], publication_venue: t.publication_venue ?? null, page_count: t.page_count ?? null, is_default: t.is_default ?? false },
          });
        }
      }
    });

    try {
      await this.prisma.audit_logs.create({
        data: { user_id: userId, action: 'ACADEMIC_PAPER_UPDATED', resource_type: 'academic_paper', resource_id: id, changes: { method: 'PATCH', path: `/api/v1/academic-papers/${id}` } },
      });
    } catch {}

    return { message: 'Paper updated', data: null };
  }

  async softDelete(id: string, userId: string) {
    const paper = await this.prisma.academic_papers.findFirst({ where: { id, deleted_at: null } });
    if (!paper) throw new NotFoundException('Paper not found');

    await this.prisma.academic_papers.update({ where: { id }, data: { deleted_at: new Date() } });

    try {
      await this.prisma.audit_logs.create({
        data: { user_id: userId, action: 'ACADEMIC_PAPER_DELETED', resource_type: 'academic_paper', resource_id: id, changes: { method: 'DELETE', path: `/api/v1/academic-papers/${id}` } },
      });
    } catch {}

    return { message: 'Paper deleted', data: null };
  }
}
