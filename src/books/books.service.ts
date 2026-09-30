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
import { publicWhere } from '../common/utils/visibility.util';
import { assertSlugRenameAllowed } from '../common/utils/publish-rules.util';
import { BOOK_PDF_PREFIX, DOCUMENT_PDF_BYTES, R2Service } from '../storage/r2.service';
import { RequestPdfUploadUrlDto } from '../common/dto/request-pdf-upload-url.dto';
import { BookQueryDto, CreateBookDto, UpdateBookDto } from './dto/book.dto';

// List queries drop the full description from translations (typically the
// heaviest field) and slim the cover-image record. Parts are hidden from
// every PUBLIC/admin list view (see the `parent_id: null` filter in
// findAll) — `_count.parts_rel` (see bookListSelect) becomes `parts_count`, a
// cheap badge for "this is a series with N parts"; the parts themselves are
// only on the detail response. findTrash deliberately does NOT apply this
// filter — an admin restoring a soft-deleted part needs to see and restore it
// as its own row, not have it hidden behind a parent that may not even be deleted.
const BOOK_LIST_SELECT = {
  id: true,
  category_id: true,
  cover_image_id: true,
  slug: true,
  isbn: true,
  pages: true,
  publish_year: true,
  pdf_url: true,
  document_languages: true,
  part_number: true,
  views: true,
  is_published: true,
  is_publication: true,
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

/**
 * A series' visible parts: never trashed, and — for the public — published
 * only. One definition for the detail's `parts[]` and the lists' `parts_count`
 * so the badge can never promise more volumes than the detail page shows.
 */
function visiblePartsWhere(isAdmin: boolean) {
  return { deleted_at: null, ...(isAdmin ? {} : { is_published: true }) };
}

function bookListSelect(isAdmin: boolean) {
  return {
    ...BOOK_LIST_SELECT,
    _count: { select: { parts_rel: { where: visiblePartsWhere(isAdmin) } } },
  } satisfies Prisma.booksSelect;
}

/** Shape of one row selected with bookListSelect — used to type the list-mapping helper below. */
type BookListRow = Prisma.booksGetPayload<{ select: ReturnType<typeof bookListSelect> }>;

/** Drop the internal `_count` wrapper in favour of a flat `parts_count`. */
function withPartsCount(book: BookListRow) {
  const { _count, ...rest } = book;
  return { ...rest, parts_count: _count.parts_rel };
}

// A part's shape on its parent's detail response — enough for a "parts" list
// screen (title via translations, cover, page count, the PDF itself).
const BOOK_PART_SELECT = {
  id: true,
  slug: true,
  part_number: true,
  pages: true,
  pdf_url: true,
  media: { select: PUBLIC_MEDIA_SELECT },
  book_translations: {
    select: { book_id: true, lang: true, title: true, author: true, publisher: true, series: true, is_default: true },
  },
} satisfies Prisma.booksSelect;

// A series parent's shape on a part's detail response — just enough to link back.
const BOOK_PARENT_SELECT = {
  id: true,
  slug: true,
  book_translations: {
    select: { book_id: true, lang: true, title: true, author: true, publisher: true, series: true, is_default: true },
  },
} satisfies Prisma.booksSelect;

// Relations shared by both detail shapes. Parts are ordered so the caller can
// render a "parts" list directly: part_number is unique per series but
// optional — unnumbered parts sort last, and the tiebreaks keep their order
// stable across calls. `parent` is only populated when this book IS a part and
// is filtered like the parts are, so a live part cannot leak a soft-deleted or
// unpublished parent's data through this back-ref.
function bookDetailRelations(isAdmin: boolean) {
  return {
    book_translations: { include: { og_image: { select: OG_IMAGE_SELECT } } },
    book_categories: { include: { book_category_translations: true } },
    parts_rel: {
      where: visiblePartsWhere(isAdmin),
      orderBy: [{ part_number: 'asc' as const }, { created_at: 'asc' as const }, { id: 'asc' as const }],
      select: BOOK_PART_SELECT,
    },
    parent: { where: visiblePartsWhere(isAdmin), select: BOOK_PARENT_SELECT },
  };
}

// Admin detail (the CMS edit form): every column and the full media record,
// exactly as before the public shape was narrowed.
const BOOK_ADMIN_DETAIL_INCLUDE = {
  ...bookDetailRelations(true),
  media: { include: { media_variants: { select: MEDIA_VARIANT_SELECT, orderBy: { width: 'asc' as const } } } },
} satisfies Prisma.booksInclude;

// Public detail is an allow-list: `added_by` (a staff user id) and the media
// row's file_size / uploaded_by stay server-side. A column added to `books`
// later is NOT public until it is listed here.
const BOOK_PUBLIC_DETAIL_SELECT = {
  id: true,
  category_id: true,
  cover_image_id: true,
  slug: true,
  isbn: true,
  pages: true,
  publish_year: true,
  pdf_url: true,
  part_number: true,
  parts: true,
  views: true,
  is_published: true,
  document_languages: true,
  parent_id: true,
  is_publication: true,
  created_at: true,
  updated_at: true,
  deleted_at: true,
  ...bookDetailRelations(false),
  media: { select: PUBLIC_MEDIA_SELECT },
} satisfies Prisma.booksSelect;

/** Same message and 404 the posts and gallery pre-checks raise, so a bad og_image_id answers alike everywhere. */
const OG_IMAGE_NOT_FOUND = 'One or more og_image_id values do not match any media record';

/** 409 texts for the unique indexes a books write can trip, keyed by a fragment of the index / column name. */
const PART_NUMBER_TAKEN = 'That part number is already used by another part of this series';

/**
 * Mirror of the database CHECK `chk_books_parts`: `part_number` and `parts`
 * are set together or not at all, and a part number never exceeds the total.
 * Validated here so the editor gets a 400 that says what is wrong instead of
 * the constraint's bare rejection.
 */
function assertPartFieldsConsistent(partNumber: number | null, parts: number | null): void {
  if ((partNumber === null) !== (parts === null)) {
    throw new BadRequestException('part_number and parts must be set together — send both, or neither');
  }
  if (partNumber !== null && parts !== null && partNumber > parts) {
    throw new BadRequestException(`part_number (${partNumber}) cannot exceed parts (${parts})`);
  }
}

@Injectable()
export class BooksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly r2: R2Service,
  ) {}

  /** Pre-sign an R2 PUT for a book PDF; the CMS saves the returned publicUrl onto pdf_url. */
  async requestPdfUploadUrl(dto: RequestPdfUploadUrlDto) {
    const result = await this.r2.presignDocumentUpload(dto.filename, BOOK_PDF_PREFIX, DOCUMENT_PDF_BYTES);
    return { message: 'Upload URL generated', data: result };
  }

  async findAll(query: BookQueryDto, lang: string | null, isAdmin = false) {
    const { page, limit, skip } = resolvePagination(query);

    // Parts are hidden from every list — they only surface on their series
    // parent's detail response (see findOne). This also fixes duplicate-
    // looking rows on paginated pages (a 12-part series used to be 12 near-
    // identical entries).
    const where: Prisma.booksWhereInput = { deleted_at: null, parent_id: null };
    if (!isAdmin) where.is_published = true;
    if (query.category_id) where.category_id = query.category_id;
    if (query.is_publication !== undefined) where.is_publication = query.is_publication;

    if (query.search) {
      where.book_translations = {
        some: { title: { contains: query.search, mode: 'insensitive' } },
      };
    }

    const [items, total] = await Promise.all([
      this.prisma.books.findMany({
        where,
        select: bookListSelect(isAdmin),
        orderBy: [{ created_at: 'desc' }, { id: 'asc' }],
        skip,
        take: limit,
      }),
      this.prisma.books.count({ where }),
    ]);

    const mapped = items.map((b) => {
      const flat = withPartsCount(b);
      return { ...flat, translation: resolveTranslation(flat.book_translations, lang) };
    });
    return { message: 'Books fetched', data: { items: mapped, pagination: buildPaginationMeta(page, limit, total) } };
  }

  async findOne(id: string, lang: string | null, isAdmin = false) {
    const where: Prisma.booksWhereInput = { id, deleted_at: null };
    if (!isAdmin) where.is_published = true;

    // Two literal query shapes rather than one conditional: the admin `include`
    // and the public allow-list `select` type differently in Prisma.
    const book = isAdmin
      ? await this.prisma.books.findFirst({ where, include: BOOK_ADMIN_DETAIL_INCLUDE })
      : await this.prisma.books.findFirst({ where, select: BOOK_PUBLIC_DETAIL_SELECT });
    if (!book) throw new NotFoundException('Book not found');

    // A part is only as public as its series. Parts never appear in a list, so
    // the parent's detail page is the one way in — when that parent is
    // unpublished or trashed the filtered `parent` back-ref above comes back
    // null, and the volume must not stay readable by UUID / slug on its own.
    if (!isAdmin && book.parent_id && !book.parent) throw new NotFoundException('Book not found');

    // Both shapes carry the internal `parent_id` FK — strip it so the response
    // matches what BookDto actually promises (the resolved `parent` object
    // below is the public-facing equivalent).
    const { parts_rel, parent, parent_id: _parentId, ...rest } = book;
    const mappedParts = parts_rel.map((p) => ({ ...p, translation: resolveTranslation(p.book_translations, lang) }));

    return {
      message: 'Book fetched',
      data: {
        ...rest,
        translation: resolveTranslation(book.book_translations, lang),
        parts_count: parts_rel.length,
        parts: mappedParts.length > 0 ? mappedParts : undefined,
        parent: parent ? { ...parent, translation: resolveTranslation(parent.book_translations, lang) } : undefined,
      },
    };
  }

  /** Public detail by canonical slug — one language-agnostic slug per book. Published only. */
  async findBySlug(slug: string, lang: string | null) {
    const match = await this.prisma.books.findFirst({
      where: { slug, ...publicWhere(true) },
      select: { id: true },
    });
    if (!match) throw new NotFoundException('Book not found');
    return this.findOne(match.id, lang);
  }

  async togglePublish(id: string, isPublished: boolean, actorId: string, lang: string | null) {
    const existing = await this.prisma.books.findFirst({
      where: { id, deleted_at: null },
      select: { id: true, is_published: true },
    });
    if (!existing) throw new NotFoundException('Book not found');

    if (existing.is_published === isPublished) {
      const { data } = await this.findOne(id, lang, true);
      return { message: 'Book already in requested state', data };
    }

    await this.prisma.books.update({
      where: { id },
      data: { is_published: isPublished, updated_at: new Date() },
    });

    await this.audit.write({
      actorId,
      action: isPublished ? AUDIT_ACTIONS.BOOK_PUBLISHED : AUDIT_ACTIONS.BOOK_UNPUBLISHED,
      resourceType: 'book',
      resourceId: id,
      changes: { method: 'PATCH', path: `/api/v1/books/${id}/publish`, is_published: isPublished },
    });

    const { data } = await this.findOne(id, lang, true);
    return { message: isPublished ? 'Book published' : 'Book unpublished', data };
  }

  /**
   * Reject a slug that collides with another live book's slug before we
   * touch the DB. The partial unique index is the real backstop (a
   * concurrent insert surfaces as P2002 → 409), but this gives a friendly
   * message in the common case.
   */
  private async assertSlugAvailable(slug: string, excludeBookId: string | null) {
    const conflict = await this.prisma.books.findFirst({
      where: { slug, ...(excludeBookId ? { NOT: { id: excludeBookId } } : {}) },
      select: { id: true },
    });
    if (conflict) throw new ConflictException(`Slug "${slug}" is already used by another book`);
  }

  /**
   * Every translation-level og_image_id must name a media row. Without the
   * pre-check a bad id reaches the FK and answers 400, while posts and gallery
   * answer 404 for the same input.
   */
  private async assertOgImagesExist(translations: { og_image_id?: string | null }[] | undefined) {
    const ids = (translations ?? []).map((t) => t.og_image_id).filter((v): v is string => typeof v === 'string');
    if (ids.length === 0) return;
    const found = await this.prisma.media.findMany({ where: { id: { in: ids } }, select: { id: true } });
    if (found.length !== new Set(ids).size) throw new NotFoundException(OG_IMAGE_NOT_FOUND);
  }

  async trackView(id: string) {
    const result = await this.prisma.books.updateMany({
      // Same visibility as findOne: a part of a hidden series is not public.
      where: {
        id,
        ...publicWhere(true),
        OR: [{ parent_id: null }, { parent: { deleted_at: null, is_published: true } }],
      },
      data: { views: { increment: 1 } },
    });
    if (result.count === 0) throw new NotFoundException('Book not found');
    return { message: 'View tracked', data: null };
  }

  /**
   * A series is exactly one level deep: reject a parent_id that either
   * doesn't exist, or itself already has a parent (would create a
   * grandparent/grandchild chain the app's "parent -> parts" UI can't render).
   *
   * This is a plain check-then-act read with no lock, so two concurrent
   * admin edits could in theory both pass and jointly build a two-level
   * chain — the same unhardened race every other pre-transaction check in
   * update()/create() already accepts (ISBN, category, slug) for this
   * small, trusted-staff CMS. Only the DB CHECK constraint on literal
   * self-reference is enforced at write time; depth is not.
   */
  private async assertUsableParent(parentId: string): Promise<{ id: string; is_published: boolean }> {
    const parent = await this.prisma.books.findFirst({
      where: { id: parentId, deleted_at: null },
      select: { id: true, parent_id: true, is_published: true },
    });
    if (!parent) throw new NotFoundException('Parent book not found');
    if (parent.parent_id) {
      throw new BadRequestException('parent_id must point at a top-level book — that book is itself a part of a series');
    }
    return { id: parent.id, is_published: parent.is_published };
  }

  /**
   * Two live parts of one series can't share a part number — the parts list is
   * ordered by it. The partial unique index uq_books_parent_part_number is the
   * real guard (a concurrent write surfaces as P2002 → the same 409); this is
   * the friendly pre-check. Trashed parts don't hold their number.
   */
  private async assertPartNumberAvailable(parentId: string, partNumber: number, excludeBookId: string | null) {
    const clash = await this.prisma.books.findFirst({
      where: {
        parent_id: parentId,
        part_number: partNumber,
        deleted_at: null,
        ...(excludeBookId ? { NOT: { id: excludeBookId } } : {}),
      },
      select: { id: true },
    });
    if (clash) throw new ConflictException(PART_NUMBER_TAKEN);
  }

  async create(dto: CreateBookDto, userId: string, lang: string | null) {
    const category = await this.prisma.book_categories.findFirst({ where: { id: dto.category_id, deleted_at: null } });
    if (!category) throw new NotFoundException('Category not found');

    const media = await this.prisma.media.findUnique({ where: { id: dto.cover_image_id } });
    if (!media) throw new NotFoundException('Cover image not found');

    await this.assertOgImagesExist(dto.translations);

    assertPartFieldsConsistent(dto.part_number ?? null, dto.parts ?? null);

    const parent = dto.parent_id ? await this.assertUsableParent(dto.parent_id) : null;
    if (parent && dto.part_number != null) {
      await this.assertPartNumberAvailable(parent.id, dto.part_number, null);
    }

    if (dto.isbn) {
      // Check the unique constraint as the DB sees it (no soft-delete filter):
      // a deleted book still occupies its ISBN until softDelete frees it.
      const existing = await this.prisma.books.findUnique({ where: { isbn: dto.isbn } });
      if (existing) throw new ConflictException('A book with that ISBN already exists');
    }

    assertExactlyOneDefault(dto.translations);

    if (dto.slug) await this.assertSlugAvailable(dto.slug, null);

    let book;
    try {
      book = await this.prisma.$transaction(async (tx) => {
        const created = await tx.books.create({
          data: {
            category_id: dto.category_id,
            cover_image_id: dto.cover_image_id,
            slug: dto.slug ?? null,
            isbn: dto.isbn ?? null,
            pages: dto.pages ?? null,
            publish_year: dto.publish_year ?? null,
            pdf_url: dto.pdf_url ?? null,
            document_languages: dto.document_languages ?? [],
            part_number: dto.part_number ?? null,
            parts: dto.parts ?? null,
            // Books are typically uploaded already-final by staff (unlike posts,
            // which benefit from a draft-first workflow) — default to published,
            // matching audios' precedent. A new PART defaults to its series'
            // state instead, so a volume added to a series that is still being
            // prepared doesn't start out flagged public.
            is_published: dto.is_published ?? parent?.is_published ?? true,
            is_publication: dto.is_publication ?? false,
            parent_id: dto.parent_id ?? null,
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
            meta_title: t.meta_title ?? null,
            meta_description: t.meta_description ?? null,
            og_image_id: t.og_image_id ?? null,
            is_default: t.is_default ?? false,
          })),
        });
        return created;
      });
    } catch (err) {
      // A concurrent insert could claim the same slug (or ISBN, or part number)
      // between the pre-check and the create — translate the unique-index
      // P2002 into a friendly 409.
      rethrowP2002AsConflict(
        err,
        dto.slug ? `Slug "${dto.slug}" is already used by another book` : 'A unique field (slug or ISBN) is already in use',
        { part_number: PART_NUMBER_TAKEN },
      );
    }

    await this.audit.write({
      actorId: userId,
      action: AUDIT_ACTIONS.BOOK_CREATED,
      resourceType: 'book',
      resourceId: book.id,
      changes: { method: 'POST', path: '/api/v1/books' },
    });

    // Hydrate with the admin flag: the row may be a draft (is_published=false),
    // which the public overload filters out — the write had already committed
    // and the request would 404 despite succeeding.
    const { data } = await this.findOne(book.id, lang, true);
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

    await this.assertOgImagesExist(dto.translations);

    if (dto.isbn && dto.isbn !== book.isbn) {
      const conflict = await this.prisma.books.findUnique({ where: { isbn: dto.isbn } });
      if (conflict) throw new ConflictException('A book with that ISBN already exists');
    }

    if (dto.parent_id !== undefined && dto.parent_id !== null) {
      // Postgres uuid comparison is case-insensitive; match that here so a
      // differently-cased self-reference gets this friendly 400 instead of
      // slipping past assertUsableParent and only failing as an unhandled
      // 500 when the DB's books_parent_id_not_self_check CHECK constraint
      // rejects the write inside the transaction.
      if (dto.parent_id.toLowerCase() === id.toLowerCase()) throw new BadRequestException('A book cannot be its own parent');
      // A part can't itself become a parent — keep the series tree exactly one level deep.
      const childCount = await this.prisma.books.count({ where: { parent_id: id, deleted_at: null } });
      if (childCount > 0) throw new BadRequestException('Cannot set a parent — this book already has its own parts');
      await this.assertUsableParent(dto.parent_id);
    }

    // Validate the part fields as they will be AFTER this patch (a PATCH may
    // send only one of them, or only move the book to another series).
    const nextPartNumber = dto.part_number !== undefined ? dto.part_number : book.part_number;
    const nextParts = dto.parts !== undefined ? dto.parts : book.parts;
    const nextParentId = dto.parent_id !== undefined ? dto.parent_id : book.parent_id;
    assertPartFieldsConsistent(nextPartNumber ?? null, nextParts ?? null);
    if (
      nextParentId &&
      nextPartNumber != null &&
      (nextParentId !== book.parent_id || nextPartNumber !== book.part_number)
    ) {
      await this.assertPartNumberAvailable(nextParentId, nextPartNumber, id);
    }

    assertSlugRenameAllowed({
      resourceLabel: 'book',
      currentSlug: book.slug,
      nextSlug: dto.slug,
      isPublished: book.is_published,
      willBePublished: dto.is_published ?? book.is_published,
    });
    if (dto.slug) await this.assertSlugAvailable(dto.slug, id);

    try {
      await this.prisma.$transaction(async (tx) => {
        // Build an explicit Prisma input — avoids spreading attacker-controlled
        // DTO fields into a `data` payload that could include relation IDs we
        // didn't intend to update.
        const updateData: Prisma.booksUpdateInput = { updated_at: new Date() };
        if (dto.category_id !== undefined) updateData.book_categories = { connect: { id: dto.category_id } };
        if (dto.cover_image_id !== undefined) updateData.media = { connect: { id: dto.cover_image_id } };
        if (dto.slug !== undefined) updateData.slug = dto.slug;
        if (dto.isbn !== undefined) updateData.isbn = dto.isbn;
        if (dto.pages !== undefined) updateData.pages = dto.pages;
        if (dto.publish_year !== undefined) updateData.publish_year = dto.publish_year;
        if (dto.pdf_url !== undefined) updateData.pdf_url = dto.pdf_url;
        if (dto.document_languages !== undefined) updateData.document_languages = dto.document_languages;
        if (dto.part_number !== undefined) updateData.part_number = dto.part_number;
        if (dto.parts !== undefined) updateData.parts = dto.parts;
        if (dto.is_published !== undefined) updateData.is_published = dto.is_published;
        if (dto.is_publication !== undefined) updateData.is_publication = dto.is_publication;
        if (dto.parent_id !== undefined) {
          updateData.parent = dto.parent_id === null ? { disconnect: true } : { connect: { id: dto.parent_id } };
        }

        await tx.books.update({ where: { id }, data: updateData });

        if (dto.translations) {
          for (const t of dto.translations) {
            const trData = {
              title: t.title,
              author: t.author ?? null,
              publisher: t.publisher ?? null,
              description: t.description ?? null,
              series: t.series ?? null,
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
      rethrowP2002AsConflict(
        err,
        dto.slug ? `Slug "${dto.slug}" is already used by another book` : 'A unique field (slug or ISBN) is already in use',
        { part_number: PART_NUMBER_TAKEN },
      );
    }

    await this.audit.write({
      actorId: userId,
      action: AUDIT_ACTIONS.BOOK_UPDATED,
      resourceType: 'book',
      resourceId: id,
      changes: { method: 'PATCH', path: `/api/v1/books/${id}` },
    });

    const { data } = await this.findOne(id, lang, true);
    return { message: 'Book updated', data };
  }

  /** List soft-deleted books (admin trash view). */
  async findTrash(page: number, limit: number) {
    const skip = (page - 1) * limit;
    const where: Prisma.booksWhereInput = { deleted_at: { not: null } };

    const [items, total] = await Promise.all([
      this.prisma.books.findMany({
        where,
        select: bookListSelect(true),
        orderBy: [{ deleted_at: 'desc' }, { id: 'asc' }],
        skip,
        take: limit,
      }),
      this.prisma.books.count({ where }),
    ]);

    // Strip the ISBN/slug suffixes in the response so the CMS shows the originals.
    const mapped = items.map((b) => {
      const flat = withPartsCount(b);
      return {
        ...flat,
        slug: flat.slug ? stripSoftDeleteSuffix(flat.slug) : flat.slug,
        isbn: flat.isbn ? stripSoftDeleteSuffix(flat.isbn) : flat.isbn,
        translation: resolveTranslation(flat.book_translations, null),
      };
    });

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

    // A part comes back under its series or not at all. While it sat in the
    // trash the series may have been trashed too, or itself turned into a part
    // of another series — restoring blindly would leave a live volume that no
    // list or detail page can reach, or a two-level chain the UI can't render.
    if (book.parent_id) {
      const parent = await this.prisma.books.findUnique({
        where: { id: book.parent_id },
        select: { deleted_at: true, parent_id: true },
      });
      if (!parent || parent.deleted_at !== null) {
        throw new ConflictException('Cannot restore: the series this part belongs to was deleted — restore the series first');
      }
      if (parent.parent_id) {
        throw new ConflictException(
          'Cannot restore: the series this part belonged to is now itself a part of another series — detach it first',
        );
      }
    }

    const restoredIsbn = book.isbn ? stripSoftDeleteSuffix(book.isbn) : null;
    const restoredSlug = book.slug ? stripSoftDeleteSuffix(book.slug) : null;

    try {
      await this.prisma.$transaction(async (tx) => {
        if (book.parent_id && book.part_number !== null) {
          const clash = await tx.books.findFirst({
            where: { parent_id: book.parent_id, part_number: book.part_number, deleted_at: null, NOT: { id } },
            select: { id: true },
          });
          if (clash) {
            throw new ConflictException(
              `Cannot restore: part number ${book.part_number} is now used by another part of the series`,
            );
          }
        }

        if (restoredIsbn) {
          const conflict = await tx.books.findFirst({
            where: { isbn: restoredIsbn, deleted_at: null, NOT: { id } },
            select: { id: true },
          });
          if (conflict) {
            throw new ConflictException(`Cannot restore: ISBN ${restoredIsbn} is now used by another book`);
          }
        }

        if (restoredSlug) {
          const conflict = await tx.books.findFirst({
            where: { slug: restoredSlug, deleted_at: null, NOT: { id } },
            select: { id: true },
          });
          if (conflict) {
            throw new ConflictException(`Cannot restore: slug "${restoredSlug}" is now used by another book`);
          }
        }

        await tx.books.update({
          where: { id },
          data: {
            deleted_at: null,
            updated_at: new Date(),
            ...(restoredIsbn ? { isbn: restoredIsbn } : {}),
            ...(restoredSlug ? { slug: restoredSlug } : {}),
          },
        });
      });
    } catch (err) {
      // DB-level backstop for a concurrent claim between check and update.
      rethrowP2002AsConflict(err, 'Cannot restore: a unique field (ISBN or slug) was claimed by another book', {
        part_number: 'Cannot restore: its part number was claimed by another part of the series',
      });
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
    const book = await this.prisma.books.findFirst({ where: { id, deleted_at: null } });
    if (!book) throw new NotFoundException('Book not found');

    // A series parent is the only way to reach its parts: they are hidden from
    // every list and surface only on the parent's detail page. Trashing the
    // parent alone would strand them — live, published, and unreachable. The
    // editor deletes (or detaches) the parts first; that keeps each removal an
    // explicit, separately restorable step instead of a silent cascade.
    const liveParts = await this.prisma.books.count({ where: { parent_id: id, deleted_at: null } });
    if (liveParts > 0) {
      throw new ConflictException(
        `Cannot delete: this book is a series with ${liveParts} live part(s) — delete or detach the parts first`,
      );
    }

    // Free the unique ISBN and slug by suffixing them; without this,
    // recreating a book with the same ISBN/slug after deletion fails with a
    // P2002 from the DB. Restore strips the suffix back off.
    const deletedAt = new Date();
    const suffix = softDeleteSuffix(deletedAt);
    const isbnUpdate = book.isbn ? { isbn: `${book.isbn}${suffix}` } : {};
    const slugUpdate = book.slug ? { slug: `${book.slug}${suffix}` } : {};

    await this.prisma.books.update({
      where: { id },
      data: { deleted_at: deletedAt, ...isbnUpdate, ...slugUpdate },
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
