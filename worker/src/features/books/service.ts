import type { Context } from 'hono';
import type { Prisma } from '../../generated/prisma/client';
import { AUDIT_ACTIONS, audit } from '../../lib/audit';
import { currentUser } from '../../lib/auth';
import { getDb } from '../../lib/db';
import { badRequest, conflict, notFound, rethrowP2002AsConflict } from '../../lib/errors';
import { assertExactlyOneDefault, loadActiveLanguages, resolveTranslation } from '../../lib/i18n';
import { MEDIA_VARIANT_SELECT, OG_IMAGE_SELECT, PUBLIC_MEDIA_SELECT } from '../../lib/media-selects';
import { buildPaginationMeta } from '../../lib/pagination';
import { assertSlugRenameAllowed } from '../../lib/publish-rules';
import { softDeleteSuffix, stripSoftDeleteSuffix } from '../../lib/soft-delete';
import type { AppEnv } from '../../lib/types';
import type { CreateBookInput, UpdateBookInput } from './schemas';

type Ctx = Context<AppEnv>;

interface ListFilters {
  page: number;
  limit: number;
  category_id?: string;
  search?: string;
  is_publication?: boolean;
}

// List queries drop the full description from translations. Parts are hidden from every public/admin
// list (`parent_id: null` in findAll); `parts_count` is the badge for a series. The trash does NOT hide
// them: an admin restoring a trashed part needs it as its own row.
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
      book_category_translations: { select: { category_id: true, lang: true, title: true, slug: true, description: true } },
    },
  },
} satisfies Prisma.booksSelect;

// One definition for the detail's `parts[]` and the lists' `parts_count`, so the badge never promises
// more volumes than the detail page shows.
function visiblePartsWhere(isAdmin: boolean) {
  return { deleted_at: null, ...(isAdmin ? {} : { is_published: true }) };
}

function bookListSelect(isAdmin: boolean) {
  return { ...BOOK_LIST_SELECT, _count: { select: { parts_rel: { where: visiblePartsWhere(isAdmin) } } } } satisfies Prisma.booksSelect;
}

type BookListRow = Prisma.booksGetPayload<{ select: ReturnType<typeof bookListSelect> }>;

function withPartsCount(book: BookListRow) {
  const { _count, ...rest } = book;
  return { ...rest, parts_count: _count.parts_rel };
}

const RELATED_BOOK_TRANSLATION_SELECT = { book_id: true, lang: true, title: true, author: true, publisher: true, series: true, is_default: true } as const;

const BOOK_PART_SELECT = {
  id: true,
  slug: true,
  part_number: true,
  pages: true,
  pdf_url: true,
  media: { select: PUBLIC_MEDIA_SELECT },
  book_translations: { select: RELATED_BOOK_TRANSLATION_SELECT },
} satisfies Prisma.booksSelect;

const BOOK_PARENT_SELECT = {
  id: true,
  slug: true,
  book_translations: { select: RELATED_BOOK_TRANSLATION_SELECT },
} satisfies Prisma.booksSelect;

// Parts are ordered for direct rendering: part_number is unique per series but optional, so unnumbered
// parts sort last and the tiebreaks keep them stable. `parent` is filtered like the parts, so a live part
// cannot leak a trashed or unpublished parent's data through the back-ref.
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

// The CMS edit form: every column and the full media record.
const BOOK_ADMIN_DETAIL_INCLUDE = {
  ...bookDetailRelations(true),
  media: { include: { media_variants: { select: MEDIA_VARIANT_SELECT, orderBy: { width: 'asc' as const } } } },
} satisfies Prisma.booksInclude;

// Public detail is an allow-list: `added_by` (a staff user id) and the media row's file_size / uploaded_by
// stay server-side, and a column added to `books` later is not public until it is listed here.
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

// Same message and 404 the posts and gallery pre-checks raise, so a bad og_image_id answers alike everywhere.
const OG_IMAGE_NOT_FOUND = 'One or more og_image_id values do not match any media record';

const PART_NUMBER_TAKEN = 'That part number is already used by another part of this series';

// Mirror of the database CHECK chk_books_parts, so the editor gets a 400 that says what is wrong.
function assertPartFieldsConsistent(partNumber: number | null, parts: number | null): void {
  if ((partNumber === null) !== (parts === null)) {
    throw badRequest('part_number and parts must be set together — send both, or neither');
  }
  if (partNumber !== null && parts !== null && partNumber > parts) {
    throw badRequest(`part_number (${partNumber}) cannot exceed parts (${parts})`);
  }
}

export async function findAll(c: Ctx, f: ListFilters, lang: string | null, isAdmin = false) {
  const db = getDb(c);
  const where: Prisma.booksWhereInput = { deleted_at: null, parent_id: null };
  if (!isAdmin) where.is_published = true;
  if (f.category_id) where.category_id = f.category_id;
  if (f.is_publication !== undefined) where.is_publication = f.is_publication;
  if (f.search) where.book_translations = { some: { title: { contains: f.search, mode: 'insensitive' } } };

  const [rows, total, active] = await Promise.all([
    db.books.findMany({
      where,
      select: bookListSelect(isAdmin),
      orderBy: [{ created_at: 'desc' }, { id: 'asc' }],
      skip: (f.page - 1) * f.limit,
      take: f.limit,
    }),
    db.books.count({ where }),
    loadActiveLanguages(db),
  ]);

  const items = rows.map((b) => {
    const flat = withPartsCount(b);
    return { ...flat, translation: resolveTranslation(flat.book_translations, lang, { active }) };
  });
  return { message: 'Books fetched', data: { items, pagination: buildPaginationMeta(f.page, f.limit, total) } };
}

export async function findOne(c: Ctx, id: string, lang: string | null, isAdmin = false) {
  const db = getDb(c);
  const where: Prisma.booksWhereInput = { id, deleted_at: null };
  if (!isAdmin) where.is_published = true;

  // Two literal query shapes: the admin `include` and the public allow-list `select` type differently.
  const [book, active] = await Promise.all([
    isAdmin ? db.books.findFirst({ where, include: BOOK_ADMIN_DETAIL_INCLUDE }) : db.books.findFirst({ where, select: BOOK_PUBLIC_DETAIL_SELECT }),
    loadActiveLanguages(db),
  ]);
  if (!book) throw notFound('Book not found');

  // A part is only as public as its series: when the parent is unpublished or trashed the filtered
  // `parent` back-ref comes back null and the volume must not stay readable by id or slug on its own.
  if (!isAdmin && book.parent_id && !book.parent) throw notFound('Book not found');

  // The internal `parent_id` FK is stripped; the resolved `parent` object is its public form.
  const { parts_rel, parent, parent_id: _parentId, ...rest } = book;
  const parts = parts_rel.map((p) => ({ ...p, translation: resolveTranslation(p.book_translations, lang, { active }) }));

  // `parts` below shadows the `parts` column (the series total), so no detail response carries it, as in Nest.
  return {
    message: 'Book fetched',
    data: {
      ...rest,
      translation: resolveTranslation(book.book_translations, lang, { active }),
      parts_count: parts_rel.length,
      parts: parts.length > 0 ? parts : undefined,
      parent: parent ? { ...parent, translation: resolveTranslation(parent.book_translations, lang, { active }) } : undefined,
    },
  };
}

export async function findBySlug(c: Ctx, slug: string, lang: string | null) {
  const match = await getDb(c).books.findFirst({ where: { slug, deleted_at: null, is_published: true }, select: { id: true } });
  if (!match) throw notFound('Book not found');
  return findOne(c, match.id, lang);
}

export async function togglePublish(c: Ctx, id: string, isPublished: boolean, lang: string | null) {
  const db = getDb(c);
  const existing = await db.books.findFirst({ where: { id, deleted_at: null }, select: { id: true, is_published: true } });
  if (!existing) throw notFound('Book not found');

  if (existing.is_published === isPublished) {
    const { data } = await findOne(c, id, lang, true);
    return { message: 'Book already in requested state', data };
  }

  await db.books.update({ where: { id }, data: { is_published: isPublished, updated_at: new Date() } });

  audit(c, {
    action: isPublished ? AUDIT_ACTIONS.BOOK_PUBLISHED : AUDIT_ACTIONS.BOOK_UNPUBLISHED,
    resourceType: 'book',
    resourceId: id,
    changes: { method: 'PATCH', path: `/api/v1/books/${id}/publish`, is_published: isPublished },
  });

  const { data } = await findOne(c, id, lang, true);
  return { message: isPublished ? 'Book published' : 'Book unpublished', data };
}

// The partial unique index is the real backstop (a concurrent insert surfaces as P2002 → 409); this is
// the friendly message for the common case. No soft-delete filter: a trashed book still holds its slug
// until the suffix frees it, and the suffixed value can't clash.
async function assertSlugAvailable(c: Ctx, slug: string, excludeBookId: string | null) {
  const clash = await getDb(c).books.findFirst({ where: { slug, ...(excludeBookId ? { NOT: { id: excludeBookId } } : {}) }, select: { id: true } });
  if (clash) throw conflict(`Slug "${slug}" is already used by another book`);
}

async function assertOgImagesExist(c: Ctx, translations: { og_image_id?: string | null }[] | null | undefined) {
  const ids = (translations ?? []).map((t) => t.og_image_id).filter((v): v is string => typeof v === 'string');
  if (ids.length === 0) return;
  const found = await getDb(c).media.findMany({ where: { id: { in: ids } }, select: { id: true } });
  if (found.length !== new Set(ids).size) throw notFound(OG_IMAGE_NOT_FOUND);
}

export async function trackView(c: Ctx, id: string) {
  const result = await getDb(c).books.updateMany({
    // Same visibility as findOne: a part of a hidden series is not public.
    where: { id, deleted_at: null, is_published: true, OR: [{ parent_id: null }, { parent: { deleted_at: null, is_published: true } }] },
    data: { views: { increment: 1 } },
  });
  if (result.count === 0) throw notFound('Book not found');
  return { message: 'View tracked', data: null };
}

// A series is one level deep: the parent must exist and must not itself be a part. A plain
// check-then-act read, like Nest's: only the DB CHECK on literal self-reference is enforced at write time.
async function assertUsableParent(c: Ctx, parentId: string): Promise<{ id: string; is_published: boolean }> {
  const parent = await getDb(c).books.findFirst({ where: { id: parentId, deleted_at: null }, select: { id: true, parent_id: true, is_published: true } });
  if (!parent) throw notFound('Parent book not found');
  if (parent.parent_id) throw badRequest('parent_id must point at a top-level book — that book is itself a part of a series');
  return { id: parent.id, is_published: parent.is_published };
}

// Friendly pre-check for uq_books_parent_part_number; trashed parts don't hold their number.
async function assertPartNumberAvailable(c: Ctx, parentId: string, partNumber: number, excludeBookId: string | null) {
  const clash = await getDb(c).books.findFirst({
    where: { parent_id: parentId, part_number: partNumber, deleted_at: null, ...(excludeBookId ? { NOT: { id: excludeBookId } } : {}) },
    select: { id: true },
  });
  if (clash) throw conflict(PART_NUMBER_TAKEN);
}

export async function create(c: Ctx, input: CreateBookInput, lang: string | null) {
  const db = getDb(c);
  const category = await db.book_categories.findFirst({ where: { id: input.category_id, deleted_at: null } });
  if (!category) throw notFound('Category not found');

  const media = await db.media.findUnique({ where: { id: input.cover_image_id } });
  if (!media) throw notFound('Cover image not found');

  await assertOgImagesExist(c, input.translations);

  assertPartFieldsConsistent(input.part_number ?? null, input.parts ?? null);

  const parent = input.parent_id ? await assertUsableParent(c, input.parent_id) : null;
  if (parent && input.part_number != null) await assertPartNumberAvailable(c, parent.id, input.part_number, null);

  if (input.isbn) {
    // As the DB sees it (no soft-delete filter): a trashed book still occupies its ISBN until the suffix frees it.
    const existing = await db.books.findUnique({ where: { isbn: input.isbn } });
    if (existing) throw conflict('A book with that ISBN already exists');
  }

  assertExactlyOneDefault(input.translations);

  if (input.slug) await assertSlugAvailable(c, input.slug, null);

  let book: { id: string };
  try {
    book = await db.$transaction(async (tx) => {
      const created = await tx.books.create({
        data: {
          category_id: input.category_id,
          cover_image_id: input.cover_image_id,
          slug: input.slug ?? null,
          isbn: input.isbn ?? null,
          pages: input.pages ?? null,
          publish_year: input.publish_year ?? null,
          pdf_url: input.pdf_url ?? null,
          document_languages: input.document_languages ?? [],
          part_number: input.part_number ?? null,
          parts: input.parts ?? null,
          // Books are typically uploaded already-final, so they default to published. A new PART defaults
          // to its series' state, so a volume added to a series still being prepared doesn't start out public.
          is_published: input.is_published ?? parent?.is_published ?? true,
          is_publication: input.is_publication ?? false,
          parent_id: input.parent_id ?? null,
          added_by: currentUser(c).id,
        },
      });
      await tx.book_translations.createMany({
        data: input.translations.map((t) => ({
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
    // A concurrent insert can claim the slug, ISBN or part number between the pre-check and the create.
    rethrowP2002AsConflict(
      err,
      input.slug ? `Slug "${input.slug}" is already used by another book` : 'A unique field (slug or ISBN) is already in use',
      { part_number: PART_NUMBER_TAKEN },
    );
  }

  audit(c, { action: AUDIT_ACTIONS.BOOK_CREATED, resourceType: 'book', resourceId: book.id, changes: { method: 'POST', path: '/api/v1/books' } });

  // Hydrated as admin: a draft is filtered out by the public shape, and the write has already committed.
  const { data } = await findOne(c, book.id, lang, true);
  return { message: 'Book created', data };
}

export async function update(c: Ctx, id: string, input: UpdateBookInput, lang: string | null) {
  const db = getDb(c);
  const book = await db.books.findFirst({ where: { id, deleted_at: null } });
  if (!book) throw notFound('Book not found');

  if (input.category_id !== undefined && input.category_id !== book.category_id) {
    const category = await db.book_categories.findFirst({ where: { id: input.category_id as string, deleted_at: null } });
    if (!category) throw notFound('Category not found');
  }

  if (input.cover_image_id !== undefined && input.cover_image_id !== book.cover_image_id) {
    const media = await db.media.findUnique({ where: { id: input.cover_image_id as string } });
    if (!media) throw notFound('Cover image not found');
  }

  await assertOgImagesExist(c, input.translations);

  if (input.isbn && input.isbn !== book.isbn) {
    const clash = await db.books.findUnique({ where: { isbn: input.isbn } });
    if (clash) throw conflict('A book with that ISBN already exists');
  }

  if (input.parent_id !== undefined && input.parent_id !== null) {
    // Postgres uuid comparison is case-insensitive; match it so a differently-cased self-reference gets
    // this 400 instead of failing as a 500 on the DB's books_parent_id_not_self_check.
    if (input.parent_id.toLowerCase() === id.toLowerCase()) throw badRequest('A book cannot be its own parent');
    // A part can't itself become a parent: the series tree stays one level deep.
    const childCount = await db.books.count({ where: { parent_id: id, deleted_at: null } });
    if (childCount > 0) throw badRequest('Cannot set a parent — this book already has its own parts');
    await assertUsableParent(c, input.parent_id);
  }

  // Validate the part fields as they will be AFTER this patch (it may send only one of them, or only move
  // the book to another series).
  const nextPartNumber = input.part_number !== undefined ? input.part_number : book.part_number;
  const nextParts = input.parts !== undefined ? input.parts : book.parts;
  const nextParentId = input.parent_id !== undefined ? input.parent_id : book.parent_id;
  assertPartFieldsConsistent(nextPartNumber ?? null, nextParts ?? null);
  if (nextParentId && nextPartNumber != null && (nextParentId !== book.parent_id || nextPartNumber !== book.part_number)) {
    await assertPartNumberAvailable(c, nextParentId, nextPartNumber, id);
  }

  assertSlugRenameAllowed({
    resourceLabel: 'book',
    currentSlug: book.slug,
    nextSlug: input.slug,
    isPublished: book.is_published,
    willBePublished: input.is_published ?? book.is_published,
  });
  if (input.slug) await assertSlugAvailable(c, input.slug, id);

  try {
    await db.$transaction(async (tx) => {
      // An explicit input: request fields never reach columns that weren't meant to change.
      const data = { updated_at: new Date() } as Prisma.booksUpdateInput;
      if (input.category_id !== undefined) data.book_categories = { connect: { id: input.category_id as string } };
      if (input.cover_image_id !== undefined) data.media = { connect: { id: input.cover_image_id as string } };
      if (input.slug !== undefined) data.slug = input.slug;
      if (input.isbn !== undefined) data.isbn = input.isbn;
      if (input.pages !== undefined) data.pages = input.pages;
      if (input.publish_year !== undefined) data.publish_year = input.publish_year;
      if (input.pdf_url !== undefined) data.pdf_url = input.pdf_url;
      if (input.document_languages !== undefined) data.document_languages = input.document_languages as string[];
      if (input.part_number !== undefined) data.part_number = input.part_number;
      if (input.parts !== undefined) data.parts = input.parts;
      if (input.is_published !== undefined) data.is_published = input.is_published as boolean;
      if (input.is_publication !== undefined) data.is_publication = input.is_publication as boolean;
      if (input.parent_id !== undefined) data.parent = input.parent_id === null ? { disconnect: true } : { connect: { id: input.parent_id } };

      await tx.books.update({ where: { id }, data });

      if (input.translations) {
        for (const t of input.translations) {
          const row = {
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
            create: { book_id: id, lang: t.lang, ...row },
            update: row,
          });
        }

        const defaults = await tx.book_translations.count({ where: { book_id: id, is_default: true } });
        if (defaults !== 1) throw badRequest('Exactly one translation must have is_default: true');
      }
    });
  } catch (err) {
    rethrowP2002AsConflict(
      err,
      input.slug ? `Slug "${input.slug}" is already used by another book` : 'A unique field (slug or ISBN) is already in use',
      { part_number: PART_NUMBER_TAKEN },
    );
  }

  audit(c, { action: AUDIT_ACTIONS.BOOK_UPDATED, resourceType: 'book', resourceId: id, changes: { method: 'PATCH', path: `/api/v1/books/${id}` } });

  const { data } = await findOne(c, id, lang, true);
  return { message: 'Book updated', data };
}

export async function findTrash(c: Ctx, page: number, limit: number) {
  const db = getDb(c);
  const where: Prisma.booksWhereInput = { deleted_at: { not: null } };
  const [rows, total, active] = await Promise.all([
    db.books.findMany({
      where,
      select: bookListSelect(true),
      orderBy: [{ deleted_at: 'desc' }, { id: 'asc' }],
      skip: (page - 1) * limit,
      take: limit,
    }),
    db.books.count({ where }),
    loadActiveLanguages(db),
  ]);

  // The suffixes are stripped so the CMS shows the originals.
  const items = rows.map((b) => {
    const flat = withPartsCount(b);
    return {
      ...flat,
      slug: flat.slug ? stripSoftDeleteSuffix(flat.slug) : flat.slug,
      isbn: flat.isbn ? stripSoftDeleteSuffix(flat.isbn) : flat.isbn,
      translation: resolveTranslation(flat.book_translations, null, { active }),
    };
  });
  return { message: 'Trash fetched', data: { items, pagination: buildPaginationMeta(page, limit, total) } };
}

export async function restore(c: Ctx, id: string) {
  const db = getDb(c);
  const book = await db.books.findFirst({ where: { id, deleted_at: { not: null } } });
  if (!book) throw notFound('Deleted book not found');

  // The category may have been soft-deleted while the book sat in the trash (a category only blocks on
  // LIVE children), so a live book is never restored under a deleted category.
  const liveCategory = await db.book_categories.findFirst({ where: { id: book.category_id, deleted_at: null }, select: { id: true } });
  if (!liveCategory) throw conflict('Cannot restore: the parent category was deleted — restore the category first');

  // A part comes back under its series or not at all: restoring blindly would leave a live volume no list
  // or detail page can reach, or a two-level chain the UI can't render.
  if (book.parent_id) {
    const parent = await db.books.findUnique({ where: { id: book.parent_id }, select: { deleted_at: true, parent_id: true } });
    if (!parent || parent.deleted_at !== null) {
      throw conflict('Cannot restore: the series this part belongs to was deleted — restore the series first');
    }
    if (parent.parent_id) {
      throw conflict('Cannot restore: the series this part belonged to is now itself a part of another series — detach it first');
    }
  }

  const restoredIsbn = book.isbn ? stripSoftDeleteSuffix(book.isbn) : null;
  const restoredSlug = book.slug ? stripSoftDeleteSuffix(book.slug) : null;

  try {
    await db.$transaction(async (tx) => {
      if (book.parent_id && book.part_number !== null) {
        const clash = await tx.books.findFirst({
          where: { parent_id: book.parent_id, part_number: book.part_number, deleted_at: null, NOT: { id } },
          select: { id: true },
        });
        if (clash) throw conflict(`Cannot restore: part number ${book.part_number} is now used by another part of the series`);
      }

      if (restoredIsbn) {
        const clash = await tx.books.findFirst({ where: { isbn: restoredIsbn, deleted_at: null, NOT: { id } }, select: { id: true } });
        if (clash) throw conflict(`Cannot restore: ISBN ${restoredIsbn} is now used by another book`);
      }

      if (restoredSlug) {
        const clash = await tx.books.findFirst({ where: { slug: restoredSlug, deleted_at: null, NOT: { id } }, select: { id: true } });
        if (clash) throw conflict(`Cannot restore: slug "${restoredSlug}" is now used by another book`);
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
    rethrowP2002AsConflict(err, 'Cannot restore: a unique field (ISBN or slug) was claimed by another book', {
      part_number: 'Cannot restore: its part number was claimed by another part of the series',
    });
  }

  audit(c, { action: AUDIT_ACTIONS.BOOK_RESTORED, resourceType: 'book', resourceId: id, changes: { method: 'POST', path: `/api/v1/books/${id}/restore` } });

  return { message: 'Book restored', data: null };
}

export async function softDelete(c: Ctx, id: string) {
  const db = getDb(c);
  const book = await db.books.findFirst({ where: { id, deleted_at: null } });
  if (!book) throw notFound('Book not found');

  // A series parent is the only way to reach its parts; trashing it alone would strand them live and
  // unreachable. The editor deletes (or detaches) the parts first, each removal its own restorable step.
  const liveParts = await db.books.count({ where: { parent_id: id, deleted_at: null } });
  if (liveParts > 0) {
    throw conflict(`Cannot delete: this book is a series with ${liveParts} live part(s) — delete or detach the parts first`);
  }

  // Suffixing frees the unique ISBN and slug while the row sits in the trash; restore strips it back off.
  const deletedAt = new Date();
  const suffix = softDeleteSuffix(deletedAt);

  await db.books.update({
    where: { id },
    data: { deleted_at: deletedAt, ...(book.isbn ? { isbn: `${book.isbn}${suffix}` } : {}), ...(book.slug ? { slug: `${book.slug}${suffix}` } : {}) },
  });

  audit(c, { action: AUDIT_ACTIONS.BOOK_DELETED, resourceType: 'book', resourceId: id, changes: { method: 'DELETE', path: `/api/v1/books/${id}` } });

  return { message: 'Book deleted', data: null };
}
