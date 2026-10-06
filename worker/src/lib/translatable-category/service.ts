import type { Context } from 'hono';
import type { Prisma, PrismaClient } from '../../generated/prisma/client';
import { audit, type AuditAction } from '../audit';
import { getDb } from '../db';
import {
  conflict,
  DUPLICATE_LANG_MESSAGE,
  isDuplicateLangTarget,
  notFound,
  UNIQUE_CONFLICT_CODES,
  uniqueViolationTarget,
} from '../errors';
import { loadActiveLanguages, resolveTranslation } from '../i18n';
import { buildPaginationMeta } from '../pagination';
import { softDeleteSuffix, stripSoftDeleteSuffix } from '../soft-delete';
import type { AppEnv } from '../types';
import type { CategoryTranslationInput } from './schemas';

/**
 * Shared CRUD, i18n, soft delete / restore and audit for the four *-categories groups (post, book,
 * gallery, academic-paper), ported from src/common/crud/translatable-category.service.ts. Each group
 * passes a CategoryConfig; the tables all have the same shape.
 */
export interface CategoryConfig {
  model: 'post_categories' | 'book_categories' | 'gallery_categories' | 'academic_paper_categories';
  /** Translation table; also the relation's name on the category row. */
  translationModel:
    | 'post_category_translations'
    | 'book_category_translations'
    | 'gallery_category_translations'
    | 'academic_paper_category_translations';
  /** audit_logs.resource_type, e.g. `post_category`. */
  resourceType: string;
  /** URL segment and permission prefix, e.g. `post-categories`. */
  basePath: string;
  audit: { created: AuditAction; updated: AuditAction; deleted: AuditAction; restored: AuditAction };
  /** Live (not soft-deleted) rows that still use the category; delete is refused while there are any. */
  countLiveChildren: (db: PrismaClient, id: string) => Promise<number>;
  childConflictMessage: string;
}

type Ctx = Context<AppEnv>;
type Db = PrismaClient | Prisma.TransactionClient;

interface TranslationRow {
  category_id: string;
  lang: string;
  title: string;
  slug: string;
  description: string | null;
}

interface CategoryRow {
  id: string;
  created_at: Date;
  deleted_at: Date | null;
  [relation: string]: unknown;
}

// The subset of the four tables' delegates used here; the real ones differ only in their type names.
interface CategoryDelegate {
  findMany(args: unknown): Promise<CategoryRow[]>;
  count(args: unknown): Promise<number>;
  findFirst(args: unknown): Promise<CategoryRow | null>;
  create(args: unknown): Promise<CategoryRow>;
  update(args: unknown): Promise<CategoryRow>;
}

interface TranslationDelegate {
  findFirst(args: unknown): Promise<TranslationRow | null>;
  findMany(args: unknown): Promise<TranslationRow[]>;
  createMany(args: unknown): Promise<{ count: number }>;
  /** A PrismaPromise: update() batches these through the array form of $transaction. */
  upsert(args: unknown): Prisma.PrismaPromise<TranslationRow>;
  update(args: unknown): Promise<TranslationRow>;
}

const categories = (db: Db, cfg: CategoryConfig) => (db as unknown as Record<string, CategoryDelegate>)[cfg.model];
const translations = (db: Db, cfg: CategoryConfig) => (db as unknown as Record<string, TranslationDelegate>)[cfg.translationModel];
const translationsOf = (row: CategoryRow, cfg: CategoryConfig) => row[cfg.translationModel] as TranslationRow[];

/** Name the (lang, slug) that is taken, when a lookup can still find it. */
async function describeSlugClash(db: PrismaClient, cfg: CategoryConfig, input: CategoryTranslationInput[], selfId?: string): Promise<string> {
  let clash: { lang: string; slug: string } | null = null;
  try {
    clash = await translations(db, cfg).findFirst({
      where: { OR: input.map((t) => ({ lang: t.lang, slug: t.slug })), ...(selfId ? { NOT: { category_id: selfId } } : {}) },
      select: { lang: true, slug: true },
    });
  } catch {
    // The generic message below still names the field; the lookup is a nicety.
  }
  return clash
    ? `Slug "${clash.slug}" (${clash.lang}) is already used by another category`
    : 'A slug in this request is already used by another category in the same language';
}

/** A unique violation from a translation write as a 409 naming the field; anything else unchanged. */
async function asTranslationConflict(db: PrismaClient, cfg: CategoryConfig, err: unknown, input: CategoryTranslationInput[], selfId?: string) {
  const target = uniqueViolationTarget(err);
  if (target === null) return err;
  if (target.includes('slug')) {
    return conflict(await describeSlugClash(db, cfg, input, selfId), { code: UNIQUE_CONFLICT_CODES.SLUG_ALREADY_USED });
  }
  if (isDuplicateLangTarget(target)) return conflict(DUPLICATE_LANG_MESSAGE, { code: UNIQUE_CONFLICT_CODES.DUPLICATE_TRANSLATION_LANG });
  return err;
}

export async function findAll(c: Ctx, cfg: CategoryConfig, page: number, limit: number) {
  const db = getDb(c);
  const where = { deleted_at: null };
  const [rows, total, active] = await Promise.all([
    categories(db, cfg).findMany({
      where,
      include: { [cfg.translationModel]: true },
      orderBy: [{ created_at: 'desc' }, { id: 'asc' }],
      skip: (page - 1) * limit,
      take: limit,
    }),
    categories(db, cfg).count({ where }),
    loadActiveLanguages(db),
  ]);
  const items = rows.map((row) => ({ ...row, translation: resolveTranslation(translationsOf(row, cfg), c.get('lang'), { active }) }));
  return { message: 'Categories fetched', data: { items, pagination: buildPaginationMeta(page, limit, total) } };
}

/** `isAdmin`: hydrating a write response, so translations in retired languages still resolve. */
export async function findOne(c: Ctx, cfg: CategoryConfig, id: string, lang: string | null, isAdmin = false) {
  const db = getDb(c);
  const [row, active] = await Promise.all([
    categories(db, cfg).findFirst({ where: { id, deleted_at: null }, include: { [cfg.translationModel]: true } }),
    isAdmin ? null : loadActiveLanguages(db),
  ]);
  if (!row) throw notFound('Category not found');
  return {
    message: 'Category fetched',
    data: { ...row, translation: resolveTranslation(translationsOf(row, cfg), lang, { active, includeInactive: isAdmin }) },
  };
}

export async function create(c: Ctx, cfg: CategoryConfig, input: CategoryTranslationInput[]) {
  const db = getDb(c);
  let category: { id: string };
  try {
    category = await db.$transaction(async (tx) => {
      const created = await categories(tx, cfg).create({ data: {} });
      await translations(tx, cfg).createMany({
        data: input.map((t) => ({ category_id: created.id, lang: t.lang, title: t.title, slug: t.slug, description: t.description ?? null })),
      });
      return created;
    });
  } catch (err) {
    throw await asTranslationConflict(db, cfg, err, input);
  }

  audit(c, {
    action: cfg.audit.created,
    resourceType: cfg.resourceType,
    resourceId: category.id,
    changes: { method: 'POST', path: `/api/v1/${cfg.basePath}` },
  });

  const { data } = await findOne(c, cfg, category.id, null, true);
  return { message: 'Category created', data };
}

export async function update(c: Ctx, cfg: CategoryConfig, id: string, input: CategoryTranslationInput[] | null | undefined) {
  const db = getDb(c);
  const category = await categories(db, cfg).findFirst({ where: { id, deleted_at: null } });
  if (!category) throw notFound('Category not found');

  if (input) {
    // One batch, so a failure part-way can't leave the category half-updated.
    try {
      await db.$transaction(
        input.map((t) =>
          translations(db, cfg).upsert({
            where: { category_id_lang: { category_id: id, lang: t.lang } },
            create: { category_id: id, lang: t.lang, title: t.title, slug: t.slug, description: t.description ?? null },
            update: { title: t.title, slug: t.slug, description: t.description ?? null },
          }),
        ),
      );
    } catch (err) {
      throw await asTranslationConflict(db, cfg, err, input, id);
    }
  }

  audit(c, {
    action: cfg.audit.updated,
    resourceType: cfg.resourceType,
    resourceId: id,
    changes: { method: 'PATCH', path: `/api/v1/${cfg.basePath}/${id}` },
  });

  const { data } = await findOne(c, cfg, id, null, true);
  return { message: 'Category updated', data };
}

/** Soft-deleted categories, with the `__del_` suffix stripped from their slugs for display. */
export async function findTrash(c: Ctx, cfg: CategoryConfig, page: number, limit: number) {
  const db = getDb(c);
  const rel = cfg.translationModel;
  const where = { deleted_at: { not: null } };
  const [rows, total] = await Promise.all([
    categories(db, cfg).findMany({
      where,
      include: { [rel]: true },
      orderBy: [{ deleted_at: 'desc' }, { id: 'asc' }],
      skip: (page - 1) * limit,
      take: limit,
    }),
    categories(db, cfg).count({ where }),
  ]);
  const items = rows.map((row) => {
    const list = translationsOf(row, cfg).map((t) => ({ ...t, slug: stripSoftDeleteSuffix(t.slug) }));
    return { ...row, [rel]: list, translation: resolveTranslation(list, null, { includeInactive: true }) };
  });
  return { message: 'Trash fetched', data: { items, pagination: buildPaginationMeta(page, limit, total) } };
}

/** Reverses softDelete's slug suffix; 409 if a live category has taken an original (lang, slug) since. */
export async function restore(c: Ctx, cfg: CategoryConfig, id: string) {
  const db = getDb(c);
  const category = await categories(db, cfg).findFirst({
    where: { id, deleted_at: { not: null } },
    include: { [cfg.translationModel]: true },
  });
  if (!category) throw notFound('Deleted category not found');

  const restored = translationsOf(category, cfg).map((t) => ({ lang: t.lang, original: stripSoftDeleteSuffix(t.slug) }));

  await db.$transaction(async (tx) => {
    for (const { lang, original } of restored) {
      const taken = await translations(tx, cfg).findFirst({ where: { lang, slug: original, NOT: { category_id: id } } });
      if (taken) throw conflict(`Cannot restore: slug "${original}" (${lang}) is now used by another category`);
    }
    for (const { lang, original } of restored) {
      await translations(tx, cfg).update({ where: { category_id_lang: { category_id: id, lang } }, data: { slug: original } });
    }
    await categories(tx, cfg).update({ where: { id }, data: { deleted_at: null } });
  });

  audit(c, {
    action: cfg.audit.restored,
    resourceType: cfg.resourceType,
    resourceId: id,
    changes: { method: 'POST', path: `/api/v1/${cfg.basePath}/${id}/restore` },
  });

  return { message: 'Category restored', data: null };
}

export async function softDelete(c: Ctx, cfg: CategoryConfig, id: string) {
  const db = getDb(c);
  const category = await categories(db, cfg).findFirst({ where: { id, deleted_at: null } });
  if (!category) throw notFound('Category not found');

  if ((await cfg.countLiveChildren(db, id)) > 0) throw conflict(cfg.childConflictMessage);

  // Frees the (lang, slug) unique index so a new category can take the slug while this one is in the trash.
  const deletedAt = new Date();
  const suffix = softDeleteSuffix(deletedAt);

  await db.$transaction(async (tx) => {
    for (const t of await translations(tx, cfg).findMany({ where: { category_id: id } })) {
      await translations(tx, cfg).update({
        where: { category_id_lang: { category_id: id, lang: t.lang } },
        data: { slug: `${t.slug}${suffix}` },
      });
    }
    await categories(tx, cfg).update({ where: { id }, data: { deleted_at: deletedAt } });
  });

  audit(c, {
    action: cfg.audit.deleted,
    resourceType: cfg.resourceType,
    resourceId: id,
    changes: { method: 'DELETE', path: `/api/v1/${cfg.basePath}/${id}` },
  });

  return { message: 'Category deleted', data: null };
}
