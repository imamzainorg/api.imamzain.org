import type { Context } from 'hono';
import type { Prisma } from '../../generated/prisma/client';
import { AUDIT_ACTIONS, audit } from '../../lib/audit';
import { currentUser } from '../../lib/auth';
import { getDb } from '../../lib/db';
import { badRequest, conflict, notFound, rethrowP2002AsConflict } from '../../lib/errors';
import { assertExactlyOneDefault, loadActiveLanguages, resolveTranslation } from '../../lib/i18n';
import { buildPaginationMeta } from '../../lib/pagination';
import type { AppEnv } from '../../lib/types';
import type { CreatePaperInput, UpdatePaperInput } from './schemas';

type Ctx = Context<AppEnv>;

// List queries drop the abstract (heavy free-text) from translations. This is the PUBLIC shape:
// `uploaded_by` (a staff user id) is admin-only, see PAPER_ADMIN_LIST_SELECT.
const PAPER_LIST_SELECT = {
  id: true,
  category_id: true,
  published_year: true,
  pdf_url: true,
  document_languages: true,
  views: true,
  is_published: true,
  created_at: true,
  updated_at: true,
  deleted_at: true,
  academic_paper_translations: {
    select: { paper_id: true, lang: true, title: true, authors: true, keywords: true, publication_venue: true, page_count: true, is_default: true },
  },
  academic_paper_categories: {
    select: {
      id: true,
      created_at: true,
      academic_paper_category_translations: { select: { category_id: true, lang: true, title: true, slug: true, description: true } },
    },
  },
} satisfies Prisma.academic_papersSelect;

// CMS lists and trash keep the uploader column they always returned.
const PAPER_ADMIN_LIST_SELECT = { ...PAPER_LIST_SELECT, uploaded_by: true } satisfies Prisma.academic_papersSelect;

const PAPER_DETAIL_RELATIONS = {
  academic_paper_translations: true,
  academic_paper_categories: { include: { academic_paper_category_translations: true } },
} satisfies Prisma.academic_papersInclude;

// Public detail is an allow-list so `uploaded_by` stays server-side.
const PAPER_PUBLIC_DETAIL_SELECT = {
  id: true,
  category_id: true,
  published_year: true,
  pdf_url: true,
  document_languages: true,
  views: true,
  is_published: true,
  created_at: true,
  updated_at: true,
  deleted_at: true,
  ...PAPER_DETAIL_RELATIONS,
} satisfies Prisma.academic_papersSelect;

interface ListFilters {
  page: number;
  limit: number;
  category_id?: string;
  search?: string;
}

export async function findAll(c: Ctx, f: ListFilters, lang: string | null, isAdmin = false) {
  const db = getDb(c);
  const where: Prisma.academic_papersWhereInput = { deleted_at: null };
  if (!isAdmin) where.is_published = true;
  if (f.category_id) where.category_id = f.category_id;
  if (f.search) {
    where.academic_paper_translations = {
      some: { OR: [{ title: { contains: f.search, mode: 'insensitive' } }, { abstract: { contains: f.search, mode: 'insensitive' } }] },
    };
  }

  const [rows, total, active] = await Promise.all([
    db.academic_papers.findMany({
      where,
      select: isAdmin ? PAPER_ADMIN_LIST_SELECT : PAPER_LIST_SELECT,
      orderBy: [{ created_at: 'desc' }, { id: 'asc' }],
      skip: (f.page - 1) * f.limit,
      take: f.limit,
    }),
    db.academic_papers.count({ where }),
    loadActiveLanguages(db),
  ]);

  const items = rows.map((p) => ({ ...p, translation: resolveTranslation(p.academic_paper_translations, lang, { active }) }));
  return { message: 'Papers fetched', data: { items, pagination: buildPaginationMeta(f.page, f.limit, total) } };
}

export async function findOne(c: Ctx, id: string, lang: string | null, isAdmin = false) {
  const db = getDb(c);
  const where: Prisma.academic_papersWhereInput = { id, deleted_at: null };
  if (!isAdmin) where.is_published = true;

  // Two literal query shapes: the admin `include` (every column) and the public allow-list `select` type differently.
  const [paper, active] = await Promise.all([
    isAdmin ? db.academic_papers.findFirst({ where, include: PAPER_DETAIL_RELATIONS }) : db.academic_papers.findFirst({ where, select: PAPER_PUBLIC_DETAIL_SELECT }),
    loadActiveLanguages(db),
  ]);
  if (!paper) throw notFound('Paper not found');
  return { message: 'Paper fetched', data: { ...paper, translation: resolveTranslation(paper.academic_paper_translations, lang, { active }) } };
}

export async function trackView(c: Ctx, id: string) {
  const result = await getDb(c).academic_papers.updateMany({
    where: { id, deleted_at: null, is_published: true },
    data: { views: { increment: 1 } },
  });
  if (result.count === 0) throw notFound('Paper not found');
  return { message: 'View tracked', data: null };
}

export async function togglePublish(c: Ctx, id: string, isPublished: boolean, lang: string | null) {
  const db = getDb(c);
  const existing = await db.academic_papers.findFirst({ where: { id, deleted_at: null }, select: { id: true, is_published: true } });
  if (!existing) throw notFound('Paper not found');

  if (existing.is_published === isPublished) {
    const { data } = await findOne(c, id, lang, true);
    return { message: 'Paper already in requested state', data };
  }

  await db.academic_papers.update({ where: { id }, data: { is_published: isPublished, updated_at: new Date() } });

  audit(c, {
    action: isPublished ? AUDIT_ACTIONS.ACADEMIC_PAPER_PUBLISHED : AUDIT_ACTIONS.ACADEMIC_PAPER_UNPUBLISHED,
    resourceType: 'academic_paper',
    resourceId: id,
    changes: { method: 'PATCH', path: `/api/v1/academic-papers/${id}/publish`, is_published: isPublished },
  });

  const { data } = await findOne(c, id, lang, true);
  return { message: isPublished ? 'Paper published' : 'Paper unpublished', data };
}

export async function create(c: Ctx, input: CreatePaperInput, lang: string | null) {
  const db = getDb(c);
  const category = await db.academic_paper_categories.findFirst({ where: { id: input.category_id, deleted_at: null } });
  if (!category) throw notFound('Category not found');

  assertExactlyOneDefault(input.translations);

  let paper: { id: string };
  try {
    paper = await db.$transaction(async (tx) => {
      const created = await tx.academic_papers.create({
        data: {
          category_id: input.category_id,
          published_year: input.published_year ?? null,
          pdf_url: input.pdf_url ?? null,
          document_languages: input.document_languages ?? [],
          // Papers are typically uploaded already-final by staff, so they default to published.
          is_published: input.is_published ?? true,
          uploaded_by: currentUser(c).id,
        },
      });
      await tx.academic_paper_translations.createMany({
        data: input.translations.map((t) => ({
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
  } catch (err) {
    // Only the (paper_id, lang) primary key is unique, so this fires when the request repeats a language.
    rethrowP2002AsConflict(err, 'Duplicate translation language in the request');
  }

  audit(c, { action: AUDIT_ACTIONS.ACADEMIC_PAPER_CREATED, resourceType: 'academic_paper', resourceId: paper.id, changes: { method: 'POST', path: '/api/v1/academic-papers' } });

  // Hydrated as admin: a draft is filtered out by the public shape, and the write has already committed.
  const { data } = await findOne(c, paper.id, lang, true);
  return { message: 'Paper created', data };
}

export async function update(c: Ctx, id: string, input: UpdatePaperInput, lang: string | null) {
  const db = getDb(c);
  const paper = await db.academic_papers.findFirst({ where: { id, deleted_at: null } });
  if (!paper) throw notFound('Paper not found');

  if (input.category_id !== undefined && input.category_id !== paper.category_id) {
    const category = await db.academic_paper_categories.findFirst({ where: { id: input.category_id as string, deleted_at: null } });
    if (!category) throw notFound('Category not found');
  }

  try {
    await db.$transaction(async (tx) => {
      // An explicit input: request fields never reach columns that weren't meant to change.
      const data = { updated_at: new Date() } as Prisma.academic_papersUpdateInput;
      if (input.category_id !== undefined) data.academic_paper_categories = { connect: { id: input.category_id as string } };
      if (input.published_year !== undefined) data.published_year = input.published_year;
      if (input.pdf_url !== undefined) data.pdf_url = input.pdf_url;
      if (input.document_languages !== undefined) data.document_languages = input.document_languages as string[];
      if (input.is_published !== undefined) data.is_published = input.is_published as boolean;

      await tx.academic_papers.update({ where: { id }, data });

      if (input.translations) {
        for (const t of input.translations) {
          const row = {
            title: t.title,
            abstract: t.abstract ?? null,
            authors: t.authors ?? [],
            keywords: t.keywords ?? [],
            publication_venue: t.publication_venue ?? null,
            page_count: t.page_count ?? null,
            is_default: t.is_default ?? false,
          };
          await tx.academic_paper_translations.upsert({
            where: { paper_id_lang: { paper_id: id, lang: t.lang } },
            create: { paper_id: id, lang: t.lang, ...row },
            update: row,
          });
        }

        const defaults = await tx.academic_paper_translations.count({ where: { paper_id: id, is_default: true } });
        if (defaults !== 1) throw badRequest('Exactly one translation must have is_default: true');
      }
    });
  } catch (err) {
    rethrowP2002AsConflict(err, 'Duplicate translation language in the request');
  }

  audit(c, { action: AUDIT_ACTIONS.ACADEMIC_PAPER_UPDATED, resourceType: 'academic_paper', resourceId: id, changes: { method: 'PATCH', path: `/api/v1/academic-papers/${id}` } });

  const { data } = await findOne(c, id, lang, true);
  return { message: 'Paper updated', data };
}

export async function findTrash(c: Ctx, page: number, limit: number) {
  const db = getDb(c);
  const where: Prisma.academic_papersWhereInput = { deleted_at: { not: null } };
  const [rows, total, active] = await Promise.all([
    db.academic_papers.findMany({
      where,
      select: PAPER_ADMIN_LIST_SELECT,
      orderBy: [{ deleted_at: 'desc' }, { id: 'asc' }],
      skip: (page - 1) * limit,
      take: limit,
    }),
    db.academic_papers.count({ where }),
    loadActiveLanguages(db),
  ]);

  const items = rows.map((p) => ({ ...p, translation: resolveTranslation(p.academic_paper_translations, null, { active }) }));
  return { message: 'Trash fetched', data: { items, pagination: buildPaginationMeta(page, limit, total) } };
}

export async function restore(c: Ctx, id: string) {
  const db = getDb(c);
  const paper = await db.academic_papers.findFirst({ where: { id, deleted_at: { not: null } }, select: { id: true, category_id: true } });
  if (!paper) throw notFound('Deleted paper not found');

  // The category may have been soft-deleted while the paper sat in the trash (a category only blocks on
  // LIVE children), so a live paper is never restored under a deleted category.
  const liveCategory = await db.academic_paper_categories.findFirst({ where: { id: paper.category_id, deleted_at: null }, select: { id: true } });
  if (!liveCategory) throw conflict('Cannot restore: the parent category was deleted — restore the category first');

  await db.academic_papers.update({ where: { id }, data: { deleted_at: null, updated_at: new Date() } });

  audit(c, { action: AUDIT_ACTIONS.ACADEMIC_PAPER_RESTORED, resourceType: 'academic_paper', resourceId: id, changes: { method: 'POST', path: `/api/v1/academic-papers/${id}/restore` } });

  return { message: 'Paper restored', data: null };
}

export async function softDelete(c: Ctx, id: string) {
  const db = getDb(c);
  const paper = await db.academic_papers.findFirst({ where: { id, deleted_at: null }, select: { id: true } });
  if (!paper) throw notFound('Paper not found');

  await db.academic_papers.update({ where: { id }, data: { deleted_at: new Date() } });

  audit(c, { action: AUDIT_ACTIONS.ACADEMIC_PAPER_DELETED, resourceType: 'academic_paper', resourceId: id, changes: { method: 'DELETE', path: `/api/v1/academic-papers/${id}` } });

  return { message: 'Paper deleted', data: null };
}
