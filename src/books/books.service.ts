import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BookQueryDto, CreateBookDto, UpdateBookDto } from './dto/book.dto';

function resolveTranslation(translations: any[], lang: string | null) {
  if (!translations || translations.length === 0) return null;
  if (lang) {
    const match = translations.find((t) => t.lang === lang);
    if (match) return match;
  }
  return translations.find((t) => t.is_default) ?? translations[0];
}

@Injectable()
export class BooksService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: BookQueryDto, lang: string | null) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const where: any = { deleted_at: null };
    if (query.category_id) where.category_id = query.category_id;

    if (query.search) {
      where.book_translations = {
        some: { title: { contains: query.search, mode: 'insensitive' } },
      };
    }

    const [items, total] = await Promise.all([
      this.prisma.books.findMany({
        where,
        include: {
          book_translations: true,
          media: true,
          book_categories: { include: { book_category_translations: true } },
        },
        orderBy: { created_at: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.books.count({ where }),
    ]);

    const mapped = items.map((b) => ({ ...b, translation: resolveTranslation(b.book_translations, lang) }));
    return { message: 'Books fetched', data: { items: mapped, pagination: { page, limit, total, pages: Math.ceil(total / limit) } } };
  }

  async findOne(id: string, lang: string | null) {
    const book = await this.prisma.books.findFirst({
      where: { id, deleted_at: null },
      include: {
        book_translations: true,
        media: true,
        book_categories: { include: { book_category_translations: true } },
      },
    });
    if (!book) throw new NotFoundException('Book not found');

    this.prisma.books.update({ where: { id }, data: { views: { increment: 1 } } }).catch(() => {});

    return { message: 'Book fetched', data: { ...book, translation: resolveTranslation(book.book_translations, lang) } };
  }

  async create(dto: CreateBookDto, userId: string) {
    const category = await this.prisma.book_categories.findFirst({ where: { id: dto.category_id, deleted_at: null } });
    if (!category) throw new NotFoundException('Category not found');

    const media = await this.prisma.media.findUnique({ where: { id: dto.cover_image_id } });
    if (!media) throw new NotFoundException('Cover image not found');

    if (dto.isbn) {
      const existing = await this.prisma.books.findFirst({ where: { isbn: dto.isbn, deleted_at: null } });
      if (existing) throw new ConflictException('A book with that ISBN already exists');
    }

    const defaultCount = dto.translations.filter((t) => t.is_default).length;
    if (defaultCount !== 1) throw new BadRequestException('Exactly one translation must have is_default: true');

    const book = await this.prisma.$transaction(async (tx) => {
      const created = await tx.books.create({
        data: {
          category_id: dto.category_id,
          cover_image_id: dto.cover_image_id,
          isbn: dto.isbn ?? null,
          pages: dto.pages ?? null,
          publish_year: dto.publish_year ?? null,
          part_number: dto.part_number ?? null,
          parts: dto.parts ?? null,
          added_by: userId,
        },
      });
      await tx.book_translations.createMany({
        data: dto.translations.map((t) => ({
          book_id: created.id,
          lang: t.lang,
          title: t.title,
          author: t.author ?? null,
          publisher: t.publisher ?? null,
          description: t.description ?? null,
          series: t.series ?? null,
          is_default: t.is_default ?? false,
        })),
      });
      return created;
    });

    try {
      await this.prisma.audit_logs.create({
        data: { user_id: userId, action: 'BOOK_CREATED', resource_type: 'book', resource_id: book.id, changes: { method: 'POST', path: '/api/v1/books' } },
      });
    } catch {}

    return { message: 'Book created', data: book };
  }

  async update(id: string, dto: UpdateBookDto, userId: string) {
    const book = await this.prisma.books.findFirst({ where: { id, deleted_at: null } });
    if (!book) throw new NotFoundException('Book not found');

    if (dto.isbn && dto.isbn !== book.isbn) {
      const conflict = await this.prisma.books.findFirst({ where: { isbn: dto.isbn, deleted_at: null } });
      if (conflict) throw new ConflictException('A book with that ISBN already exists');
    }

    await this.prisma.$transaction(async (tx) => {
      const { translations, ...rest } = dto;
      await tx.books.update({ where: { id }, data: { ...rest, updated_at: new Date() } });
      if (translations) {
        for (const t of translations) {
          await tx.book_translations.upsert({
            where: { book_id_lang: { book_id: id, lang: t.lang } },
            create: { book_id: id, lang: t.lang, title: t.title, author: t.author ?? null, publisher: t.publisher ?? null, description: t.description ?? null, series: t.series ?? null, is_default: t.is_default ?? false },
            update: { title: t.title, author: t.author ?? null, publisher: t.publisher ?? null, description: t.description ?? null, series: t.series ?? null, is_default: t.is_default ?? false },
          });
        }
      }
    });

    try {
      await this.prisma.audit_logs.create({
        data: { user_id: userId, action: 'BOOK_UPDATED', resource_type: 'book', resource_id: id, changes: { method: 'PATCH', path: `/api/v1/books/${id}` } },
      });
    } catch {}

    return { message: 'Book updated', data: null };
  }

  async softDelete(id: string, userId: string) {
    const book = await this.prisma.books.findFirst({ where: { id, deleted_at: null } });
    if (!book) throw new NotFoundException('Book not found');

    await this.prisma.books.update({ where: { id }, data: { deleted_at: new Date() } });

    try {
      await this.prisma.audit_logs.create({
        data: { user_id: userId, action: 'BOOK_DELETED', resource_type: 'book', resource_id: id, changes: { method: 'DELETE', path: `/api/v1/books/${id}` } },
      });
    } catch {}

    return { message: 'Book deleted', data: null };
  }
}
