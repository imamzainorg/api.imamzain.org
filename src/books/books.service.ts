import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import { AUDIT_ACTIONS } from '../common/audit/audit.actions';
import { MEDIA_VARIANT_SELECT, OG_IMAGE_SELECT, PUBLIC_MEDIA_SELECT } from '../common/crud/media-selects';
import { softDeleteSuffix, stripSoftDeleteSuffix } from '../common/utils/soft-delete.util';
import { rethrowP2002AsConflict } from '../common/utils/prisma-error.util';
import { assertExactlyOneDefault, resolveTranslation } from '../common/utils/translation.util';
import { buildPaginationMeta, resolvePagination } from '../common/utils/pagination.util';
import { BookQueryDto, CreateBookDto, UpdateBookDto } from './dto/book.dto';

// List queries drop the full description from translations (typically the
// heaviest field) and slim the cover-image record.
const BOOK_LIST_SELECT = {
  id: true,
  category_id: true,
  cover_image_id: true,
  isbn: true,
  pages: true,
  publish_year: true,
  pdf_url: true,
  part_number: true,
  parts: true,
  views: true,
  created_at: true,
  updated_at: true,
  deleted_at: true,
  book_translations: {
    select: {
      book_id: true,
      lang: true,
      title: true,
      author: true,
      publisher: true,
      series: true,
      slug: true,
      meta_title: true,
      meta_description: true,
      og_image_id: true,
      is_default: true,
    },
  },
  media: { select: PUBLIC_MEDIA_SELECT },
  book_categories: {
    select: {
      id: true,
      created_at: true,
      book_category_translations: {
        select: { category_id: true, lang: true, title: true, slug: true, description: true },
      },
    },
  },
} satisfies Prisma.booksSelect;

@Injectable()
export class BooksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async findAll(query: BookQueryDto, lang: string | null) {
    const { page, limit, skip } = resolvePagination(query);

    const where: Prisma.booksWhereInput = { deleted_at: null };
    if (query.category_id) where.category_id = query.category_id;

    if (query.search) {
      where.book_translations = {
        some: { title: { contains: query.search, mode: 'insensitive' } },
      };
    }

    const [items, total] = await Promise.all([
      this.prisma.books.findMany({
        where,
        select: BOOK_LIST_SELECT,
        orderBy: [{ created_at: 'desc' }, { id: 'asc' }],
        skip,
        take: limit,
      }),
      this.prisma.books.count({ where }),
    ]);

    const mapped = items.map((b) => ({ ...b, translation: resolveTranslation(b.book_translations, lang) }));
    return { message: 'Books fetched', data: { items: mapped, pagination: buildPaginationMeta(page, limit, total) } };
  }

  async findOne(id: string, lang: string | null) {
    const book = await this.prisma.books.findFirst({
      where: { id, deleted_at: null },
      include: {
        book_translations: { include: { og_image: { select: OG_IMAGE_SELECT } } },
        media: { include: { media_variants: { select: MEDIA_VARIANT_SELECT, orderBy: { width: 'asc' } } } },
        book_categories: { include: { book_category_translations: true } },
      },
    });
    if (!book) throw new NotFoundException('Book not found');

    return { message: 'Book fetched', data: { ...book, translation: resolveTranslation(book.book_translations, lang) } };
  }

  /** Public detail by editor slug — resolves regardless of the visitor's lang. */
  async findBySlug(slug: string, lang: string | null) {
    const match = await this.prisma.book_translations.findFirst({
      where: { slug, books: { deleted_at: null } },
      select: { book_id: true },
    });
    if (!match) throw new NotFoundException('Book not found');
    return this.findOne(match.book_id, lang);
  }

  /**
   * Reject any provided slug that collides with another book's live (lang, slug)
   * pair before we touch the DB. The partial unique index is the real backstop
   * (a concurrent insert surfaces as P2002 → 409), but this gives a friendly
   * message in the common case.
   */
  private async assertSlugsAvailable(
    translations: { lang: string; slug?: string | null }[],
    excludeBookId: string | null,
  ) {
    for (const t of translations) {
      if (!t.slug) continue;
      const conflict = await this.prisma.book_translations.findFirst({
        where: {
          lang: t.lang,
          slug: t.slug,
          ...(excludeBookId ? { NOT: { book_id: excludeBookId } } : {}),
        },
        select: { book_id: true },
      });
      if (conflict) {
        throw new ConflictException(`Slug "${t.slug}" (${t.lang}) is already used by another book`);
      }
    }
  }

  async trackView(id: string) {
    const result = await this.prisma.books.updateMany({
      where: { id, deleted_at: null },
      data: { views: { increment: 1 } },
    });
    if (result.count === 0) throw new NotFoundException('Book not found');
    return { message: 'View tracked', data: null };
  }

  async create(dto: CreateBookDto, userId: string, lang: string | null) {
    const category = await this.prisma.book_categories.findFirst({ where: { id: dto.category_id, deleted_at: null } });
    if (!category) throw new NotFoundException('Category not found');

    const media = await this.prisma.media.findUnique({ where: { id: dto.cover_image_id } });
    if (!media) throw new NotFoundException('Cover image not found');

    if (dto.isbn) {
      // Check the unique constraint as the DB sees it (no soft-delete filter):
      // a deleted book still occupies its ISBN until softDelete frees it.
      const existing = await this.prisma.books.findUnique({ where: { isbn: dto.isbn } });
      if (existing) throw new ConflictException('A book with that ISBN already exists');
    }

    assertExactlyOneDefault(dto.translations, 'Exactly one translation must have is_default: true');

    await this.assertSlugsAvailable(dto.translations, null);

    let book;
    try {
      book = await this.prisma.$transaction(async (tx) => {
        const created = await tx.books.create({
          data: {
            category_id: dto.category_id,
            cover_image_id: dto.cover_image_id,
            isbn: dto.isbn ?? null,
            pages: dto.pages ?? null,
            publish_year: dto.publish_year ?? null,
            pdf_url: dto.pdf_url ?? null,
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
            slug: t.slug ?? null,
            meta_title: t.meta_title ?? null,
            meta_description: t.meta_description ?? null,
            og_image_id: t.og_image_id ?? null,
            is_default: t.is_default ?? false,
          })),
        });
        return created;
      });
    } catch (err) {
      // A concurrent insert could claim the same (lang, slug) between the
      // pre-check and the createMany — translate the partial-unique-index P2002
      // into the friendly 409.
      rethrowP2002AsConflict(err, 'A book translation slug is already in use');
    }

    await this.audit.write({
      actorId: userId,
      action: AUDIT_ACTIONS.BOOK_CREATED,
      resourceType: 'book',
      resourceId: book.id,
      changes: { method: 'POST', path: '/api/v1/books' },
    });

    const { data } = await this.findOne(book.id, lang);
    return { message: 'Book created', data };
  }

  async update(id: string, dto: UpdateBookDto, userId: string, lang: string | null) {
    const book = await this.prisma.books.findFirst({ where: { id, deleted_at: null } });
    if (!book) throw new NotFoundException('Book not found');

    if (dto.category_id !== undefined && dto.category_id !== book.category_id) {
      const category = await this.prisma.book_categories.findFirst({
        where: { id: dto.category_id, deleted_at: null },
      });
      if (!category) throw new NotFoundException('Category not found');
    }

    if (dto.cover_image_id !== undefined && dto.cover_image_id !== book.cover_image_id) {
      const media = await this.prisma.media.findUnique({ where: { id: dto.cover_image_id } });
      if (!media) throw new NotFoundException('Cover image not found');
    }

    if (dto.isbn && dto.isbn !== book.isbn) {
      const conflict = await this.prisma.books.findUnique({ where: { isbn: dto.isbn } });
      if (conflict) throw new ConflictException('A book with that ISBN already exists');
    }

    if (dto.translations) await this.assertSlugsAvailable(dto.translations, id);

    try {
      await this.prisma.$transaction(async (tx) => {
      // Build an explicit Prisma input — avoids spreading attacker-controlled
      // DTO fields into a `data` payload that could include relation IDs we
      // didn't intend to update.
      const updateData: Prisma.booksUpdateInput = { updated_at: new Date() };
      if (dto.category_id !== undefined) updateData.book_categories = { connect: { id: dto.category_id } };
      if (dto.cover_image_id !== undefined) updateData.media = { connect: { id: dto.cover_image_id } };
      if (dto.isbn !== undefined) updateData.isbn = dto.isbn;
      if (dto.pages !== undefined) updateData.pages = dto.pages;
      if (dto.publish_year !== undefined) updateData.publish_year = dto.publish_year;
      if (dto.pdf_url !== undefined) updateData.pdf_url = dto.pdf_url;
      if (dto.part_number !== undefined) updateData.part_number = dto.part_number;
      if (dto.parts !== undefined) updateData.parts = dto.parts;

      await tx.books.update({ where: { id }, data: updateData });

      if (dto.translations) {
        for (const t of dto.translations) {
          const trData = {
            title: t.title,
            author: t.author ?? null,
            publisher: t.publisher ?? null,
            description: t.description ?? null,
            series: t.series ?? null,
            slug: t.slug ?? null,
            meta_title: t.meta_title ?? null,
            meta_description: t.meta_description ?? null,
            og_image_id: t.og_image_id ?? null,
            is_default: t.is_default ?? false,
          };
          await tx.book_translations.upsert({
            where: { book_id_lang: { book_id: id, lang: t.lang } },
            create: { book_id: id, lang: t.lang, ...trData },
            update: trData,
          });
        }

        const defaults = await tx.book_translations.count({ where: { book_id: id, is_default: true } });
        if (defaults !== 1) {
          throw new BadRequestException('Exactly one translation must have is_default: true');
        }
      }
      });
    } catch (err) {
      rethrowP2002AsConflict(err, 'A book translation slug is already in use');
    }

    await this.audit.write({
      actorId: userId,
      action: AUDIT_ACTIONS.BOOK_UPDATED,
      resourceType: 'book',
      resourceId: id,
      changes: { method: 'PATCH', path: `/api/v1/books/${id}` },
    });

    const { data } = await this.findOne(id, lang);
    return { message: 'Book updated', data };
  }

  /** List soft-deleted books (admin trash view). */
  async findTrash(page: number, limit: number) {
    const skip = (page - 1) * limit;
    const where: Prisma.booksWhereInput = { deleted_at: { not: null } };

    const [items, total] = await Promise.all([
      this.prisma.books.findMany({
        where,
        select: BOOK_LIST_SELECT,
        orderBy: [{ deleted_at: 'desc' }, { id: 'asc' }],
        skip,
        take: limit,
      }),
      this.prisma.books.count({ where }),
    ]);

    // Strip the ISBN suffix in the response so the CMS shows the original.
    const mapped = items.map((b) => ({
      ...b,
      isbn: b.isbn ? stripSoftDeleteSuffix(b.isbn) : b.isbn,
      translation: resolveTranslation(b.book_translations, null),
    }));

    return {
      message: 'Trash fetched',
      data: { items: mapped, pagination: buildPaginationMeta(page, limit, total) },
    };
  }

  /**
   * Restore a soft-deleted book. Reverses the ISBN suffix from `softDelete`.
   * Refused with 409 if a non-deleted book has taken the original ISBN
   * in the meantime — operator must rename one side and retry.
   */
  async restore(id: string, userId: string) {
    const book = await this.prisma.books.findFirst({
      where: { id, deleted_at: { not: null } },
      include: { book_translations: true },
    });
    if (!book) throw new NotFoundException('Deleted book not found');

    // The parent category may have been soft-deleted while the book sat in
    // trash (category softDelete only blocks on LIVE children). Don't restore a
    // live book under a deleted category — require the category be restored
    // first, mirroring the ISBN-conflict 409 below.
    const liveCategory = await this.prisma.book_categories.findFirst({
      where: { id: book.category_id, deleted_at: null },
      select: { id: true },
    });
    if (!liveCategory) {
      throw new ConflictException(
        'Cannot restore: the parent category was deleted — restore the category first',
      );
    }

    const restoredIsbn = book.isbn ? stripSoftDeleteSuffix(book.isbn) : null;
    const restoredSlugs = book.book_translations
      .filter((t) => t.slug)
      .map((t) => ({ lang: t.lang, original: stripSoftDeleteSuffix(t.slug as string) }));

    try {
      await this.prisma.$transaction(async (tx) => {
        if (restoredIsbn) {
          const conflict = await tx.books.findFirst({
            where: { isbn: restoredIsbn, deleted_at: null, NOT: { id } },
            select: { id: true },
          });
          if (conflict) {
            throw new ConflictException(`Cannot restore: ISBN ${restoredIsbn} is now used by another book`);
          }
        }

        for (const { lang, original } of restoredSlugs) {
          const conflict = await tx.book_translations.findFirst({
            where: { lang, slug: original, NOT: { book_id: id } },
            select: { book_id: true },
          });
          if (conflict) {
            throw new ConflictException(`Cannot restore: slug "${original}" (${lang}) is now used by another book`);
          }
        }

        for (const { lang, original } of restoredSlugs) {
          await tx.book_translations.update({
            where: { book_id_lang: { book_id: id, lang } },
            data: { slug: original },
          });
        }

        await tx.books.update({
          where: { id },
          data: { deleted_at: null, ...(restoredIsbn ? { isbn: restoredIsbn } : {}), updated_at: new Date() },
        });
      });
    } catch (err) {
      // DB-level backstop for a concurrent claim between check and update.
      rethrowP2002AsConflict(err, 'Cannot restore: a unique field (ISBN or slug) was claimed by another book');
    }

    await this.audit.write({
      actorId: userId,
      action: AUDIT_ACTIONS.BOOK_RESTORED,
      resourceType: 'book',
      resourceId: id,
      changes: { method: 'POST', path: `/api/v1/books/${id}/restore` },
    });

    return { message: 'Book restored', data: null };
  }

  async softDelete(id: string, userId: string) {
    const book = await this.prisma.books.findFirst({
      where: { id, deleted_at: null },
      include: { book_translations: true },
    });
    if (!book) throw new NotFoundException('Book not found');

    // Free the unique ISBN and any per-translation slug by suffixing them;
    // without this, recreating a book with the same ISBN/slug after deletion
    // fails with a P2002 from the DB. Restore strips the suffix back off.
    const deletedAt = new Date();
    const suffix = softDeleteSuffix(deletedAt);
    const isbnUpdate = book.isbn ? { isbn: `${book.isbn}${suffix}` } : {};

    await this.prisma.$transaction(async (tx) => {
      for (const t of book.book_translations) {
        if (t.slug) {
          await tx.book_translations.update({
            where: { book_id_lang: { book_id: id, lang: t.lang } },
            data: { slug: `${t.slug}${suffix}` },
          });
        }
      }
      await tx.books.update({
        where: { id },
        data: { deleted_at: deletedAt, ...isbnUpdate },
      });
    });

    await this.audit.write({
      actorId: userId,
      action: AUDIT_ACTIONS.BOOK_DELETED,
      resourceType: 'book',
      resourceId: id,
      changes: { method: 'DELETE', path: `/api/v1/books/${id}` },
    });

    return { message: 'Book deleted', data: null };
  }
}
