import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuditAction } from '../audit/audit.actions';
import { softDeleteSuffix, stripSoftDeleteSuffix } from '../utils/soft-delete.util';
import { resolveTranslation } from '../utils/translation.util';
import { buildPaginationMeta } from '../utils/pagination.util';
import {
  DUPLICATE_LANG_MESSAGE,
  UNIQUE_CONFLICT_CODES,
  conflict,
  isDuplicateLangTarget,
  uniqueViolationTarget,
} from './unique-conflict.util';

export interface CategoryTranslationInput {
  lang: string;
  title: string;
  slug: string;
  description?: string | null;
}

/**
 * Minimal shape every category table (book_categories, post_categories,
 * gallery_categories, academic_paper_categories) actually has: a
 * soft-deletable row plus whatever `include` attaches. The relation name is
 * only known at runtime (`config.translationModel`), so it can't be a typed
 * property here — callers read it through the index signature, same data as
 * before, just no longer behind `any`.
 */
export interface CategoryRow {
  id: string;
  created_at: Date;
  deleted_at: Date | null;
  [relation: string]: unknown;
}

/**
 * Minimal shape every category-translation table actually has. Exported (like
 * CategoryRow) because it leaks into the public return type of every
 * concrete controller's findAll/findOne/etc — declaration emit needs to be
 * able to name it.
 */
export interface CategoryTranslationRow {
  category_id: string;
  lang: string;
  title: string;
  slug: string;
  description: string | null;
  [key: string]: unknown;
}

/**
 * The subset of a Prisma category-table delegate this service calls. Every
 * real delegate (Prisma.book_categoriesDelegate, etc.) is structurally
 * compatible with this, so indexing PrismaClient by a validated model key
 * (below) needs no cast to reach it.
 */
interface CategoryDelegate {
  findMany(args: unknown): Prisma.PrismaPromise<CategoryRow[]>;
  count(args: unknown): Prisma.PrismaPromise<number>;
  findFirst(args: unknown): Prisma.PrismaPromise<CategoryRow | null>;
  create(args: unknown): Prisma.PrismaPromise<CategoryRow>;
  update(args: unknown): Prisma.PrismaPromise<CategoryRow>;
}

/**
 * The subset of a Prisma category-translation-table delegate this service
 * calls. Returns `Prisma.PrismaPromise`, not a plain `Promise` — `update()`
 * batches `upsert()` calls through the array form of `$transaction`, which
 * requires the real Prisma promise type, not just something `.then`-shaped.
 */
interface CategoryTranslationDelegate {
  findFirst(args: unknown): Prisma.PrismaPromise<CategoryTranslationRow | null>;
  findMany(args: unknown): Prisma.PrismaPromise<CategoryTranslationRow[]>;
  createMany(args: unknown): Prisma.PrismaPromise<{ count: number }>;
  upsert(args: unknown): Prisma.PrismaPromise<CategoryTranslationRow>;
  update(args: unknown): Prisma.PrismaPromise<CategoryTranslationRow>;
}

/**
 * Every key of PrismaClient whose delegate looks like a category table. A
 * `categoryModel: 'book_category'` typo (singular, doesn't exist) or
 * pointing at an unrelated model now fails `tsc`, where before it was a
 * plain string nothing checked until the query hit Postgres at runtime.
 */
type CategoryModelKey = {
  [K in keyof PrismaClient]: PrismaClient[K] extends CategoryDelegate ? K : never;
}[keyof PrismaClient];

/** Same as CategoryModelKey, for the four *_category_translations tables. */
type CategoryTranslationModelKey = {
  [K in keyof PrismaClient]: PrismaClient[K] extends CategoryTranslationDelegate ? K : never;
}[keyof PrismaClient];

/**
 * findOne's hydrated shape: a category row plus its resolved `translation`.
 * Spelled out (rather than left to inference from the `{ ...category, ... }`
 * literal in findOne) because a spread's inferred type drops CategoryRow's
 * index signature, which several callers (create/update's hydrate-after-write,
 * and specs asserting on the raw `<translationModel>` relation array) rely on.
 */
export type CategoryDetail = CategoryRow & { translation: CategoryTranslationRow | null };

export interface CategoryCrudConfig {
  /** Prisma model name for the category table, e.g. 'book_categories'. */
  categoryModel: CategoryModelKey;
  /** Prisma model + relation name for the translations, e.g. 'book_category_translations'. */
  translationModel: CategoryTranslationModelKey;
  /** audit_logs resource_type, e.g. 'book_category'. */
  resourceType: string;
  /** REST base path segment, e.g. 'book-categories'. */
  basePath: string;
  audit: { created: AuditAction; updated: AuditAction; deleted: AuditAction; restored: AuditAction };
  /** Number of live (non-deleted) children that must be reassigned before delete. */
  countLiveChildren: (id: string) => Promise<number>;
  /** 409 message returned when countLiveChildren > 0. */
  childConflictMessage: string;
}

/**
 * Shared CRUD + i18n + soft-delete/restore + audit logic for the four
 * near-identical *-categories resources (book / post / academic-paper /
 * gallery). Each concrete service supplies a CategoryCrudConfig; everything
 * else — pagination, translation resolution, the slug-suffix soft-delete
 * dance, the restore conflict check, and audit writes — lives here.
 *
 * All category translation tables share the same shape: FK `category_id`,
 * compound unique `category_id_lang`, fields `{ title, slug, description }`.
 * Prisma's per-model delegates are reached by name (this.prisma[model] /
 * tx[model]) through the minimal CategoryDelegate/CategoryTranslationDelegate
 * interfaces above — real per-model argument/result shapes still differ, so
 * the individual CRUD methods below type query args as `unknown` and narrow
 * only what they read, rather than pretending to know each model's exact
 * WhereInput/Select shape.
 */
export abstract class TranslatableCategoryService {
  protected abstract readonly config: CategoryCrudConfig;

  constructor(
    protected readonly prisma: PrismaService,
    protected readonly audit: AuditService,
  ) {}

  private get model(): CategoryDelegate {
    return this.categoryOn(this.prisma);
  }

  private get translation(): CategoryTranslationDelegate {
    return this.translationOn(this.prisma);
  }

  /** Reach the category delegate on a given client — `this.prisma`, or a `tx` inside `$transaction`. */
  private categoryOn(client: PrismaClient | Prisma.TransactionClient): CategoryDelegate {
    return client[this.config.categoryModel];
  }

  /** Reach the translation delegate on a given client — `this.prisma`, or a `tx` inside `$transaction`. */
  private translationOn(client: PrismaClient | Prisma.TransactionClient): CategoryTranslationDelegate {
    return client[this.config.translationModel];
  }

  /**
   * Turn a unique-index violation from a translation write into a 409 that says
   * which field collided (stable `code`), instead of the filter's generic "a
   * record with that value already exists". Anything else comes back unchanged.
   * `selfId` is the category being updated, whose own rows are not a clash.
   */
  private async asTranslationConflict(
    err: unknown,
    translations: CategoryTranslationInput[],
    selfId?: string,
  ): Promise<unknown> {
    const target = uniqueViolationTarget(err);
    if (target === null) return err;
    // Checked first: the (lang, slug) index also mentions `lang`.
    if (target.includes('slug')) {
      return conflict(await this.describeSlugClash(translations, selfId), UNIQUE_CONFLICT_CODES.SLUG_ALREADY_USED);
    }
    if (isDuplicateLangTarget(target)) return conflict(DUPLICATE_LANG_MESSAGE, UNIQUE_CONFLICT_CODES.DUPLICATE_TRANSLATION_LANG);
    return err;
  }

  /** Name the (lang, slug) that is taken, when a lookup can still find it. */
  private async describeSlugClash(translations: CategoryTranslationInput[], selfId?: string): Promise<string> {
    let clash: { lang: string; slug: string } | null = null;
    try {
      clash = await this.translation.findFirst({
        where: {
          OR: translations.map((t) => ({ lang: t.lang, slug: t.slug })),
          ...(selfId ? { NOT: { category_id: selfId } } : {}),
        },
        select: { lang: true, slug: true },
      });
    } catch {
      // The generic message below still names the field; the lookup is a nicety.
    }
    return clash
      ? `Slug "${clash.slug}" (${clash.lang}) is already used by another category`
      : 'A slug in this request is already used by another category in the same language';
  }

  async findAll(lang: string | null, page: number, limit: number) {
    const rel = this.config.translationModel;
    const skip = (page - 1) * limit;
    const where = { deleted_at: null };
    const [categories, total] = await Promise.all([
      this.model.findMany({
        where,
        include: { [rel]: true },
        orderBy: [{ created_at: 'desc' }, { id: 'asc' }],
        skip,
        take: limit,
      }),
      this.model.count({ where }),
    ]);
    const items = categories.map((c) => ({
      ...c,
      translation: resolveTranslation(c[rel] as CategoryTranslationRow[], lang),
    }));
    return { message: 'Categories fetched', data: { items, pagination: buildPaginationMeta(page, limit, total) } };
  }

  /** `isAdmin`: hydrating an admin write response, so retired-language translations still resolve. */
  async findOne(id: string, lang: string | null, isAdmin = false): Promise<{ message: string; data: CategoryDetail }> {
    const rel = this.config.translationModel;
    const category = await this.model.findFirst({
      where: { id, deleted_at: null },
      include: { [rel]: true },
    });
    if (!category) throw new NotFoundException('Category not found');
    return {
      message: 'Category fetched',
      data: { ...category, translation: resolveTranslation(category[rel] as CategoryTranslationRow[], lang, { includeInactive: isAdmin }) },
    };
  }

  async create(dto: { translations: CategoryTranslationInput[] }, actorId: string) {
    let category: { id: string };
    try {
      category = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const created = await this.categoryOn(tx).create({ data: {} });
        await this.translationOn(tx).createMany({
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
    } catch (err) {
      throw await this.asTranslationConflict(err, dto.translations);
    }

    await this.audit.write({
      actorId,
      action: this.config.audit.created,
      resourceType: this.config.resourceType,
      resourceId: category.id,
      changes: { method: 'POST', path: `/api/v1/${this.config.basePath}` },
    });

    const { data } = await this.findOne(category.id, null, true);
    return { message: 'Category created', data };
  }

  async update(id: string, dto: { translations?: CategoryTranslationInput[] }, actorId: string) {
    const category = await this.model.findFirst({ where: { id, deleted_at: null } });
    if (!category) throw new NotFoundException('Category not found');

    if (dto.translations) {
      // Apply all translation upserts atomically so a mid-loop failure can't
      // leave the category half-updated.
      try {
        await this.prisma.$transaction(
          dto.translations.map((t) =>
            this.translation.upsert({
              where: { category_id_lang: { category_id: id, lang: t.lang } },
              create: { category_id: id, lang: t.lang, title: t.title, slug: t.slug, description: t.description ?? null },
              update: { title: t.title, slug: t.slug, description: t.description ?? null },
            }),
          ),
        );
      } catch (err) {
        throw await this.asTranslationConflict(err, dto.translations, id);
      }
    }

    await this.audit.write({
      actorId,
      action: this.config.audit.updated,
      resourceType: this.config.resourceType,
      resourceId: id,
      changes: { method: 'PATCH', path: `/api/v1/${this.config.basePath}/${id}` },
    });

    const { data } = await this.findOne(id, null, true);
    return { message: 'Category updated', data };
  }

  /** List soft-deleted categories with translation slugs unsuffixed for display. */
  async findTrash(page: number, limit: number) {
    const rel = this.config.translationModel;
    const skip = (page - 1) * limit;
    const where = { deleted_at: { not: null } };
    const [rows, total] = await Promise.all([
      this.model.findMany({
        where,
        include: { [rel]: true },
        orderBy: [{ deleted_at: 'desc' }, { id: 'asc' }],
        skip,
        take: limit,
      }),
      this.model.count({ where }),
    ]);
    const items = rows.map((row) => {
      const translations = (row[rel] as CategoryTranslationRow[]).map((t) => ({ ...t, slug: stripSoftDeleteSuffix(t.slug) }));
      return {
        ...row,
        [rel]: translations,
        translation: resolveTranslation(translations, null, { includeInactive: true }),
      };
    });
    return { message: 'Trash fetched', data: { items, pagination: buildPaginationMeta(page, limit, total) } };
  }

  /**
   * Restore a soft-deleted category. Reverses the slug suffix from softDelete;
   * refused with 409 if a live category has taken the original (lang, slug).
   */
  async restore(id: string, actorId: string) {
    const { translationModel } = this.config;
    const category = await this.model.findFirst({
      where: { id, deleted_at: { not: null } },
      include: { [translationModel]: true },
    });
    if (!category) throw new NotFoundException('Deleted category not found');

    const restoredSlugs = (category[translationModel] as CategoryTranslationRow[]).map((t) => ({
      lang: t.lang,
      original: stripSoftDeleteSuffix(t.slug),
    }));

    await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      for (const { lang, original } of restoredSlugs) {
        const conflict = await this.translationOn(tx).findFirst({
          where: { lang, slug: original, NOT: { category_id: id } },
        });
        if (conflict) {
          throw new ConflictException(
            `Cannot restore: slug "${original}" (${lang}) is now used by another category`,
          );
        }
      }
      for (const { lang, original } of restoredSlugs) {
        await this.translationOn(tx).update({
          where: { category_id_lang: { category_id: id, lang } },
          data: { slug: original },
        });
      }
      await this.categoryOn(tx).update({ where: { id }, data: { deleted_at: null } });
    });

    await this.audit.write({
      actorId,
      action: this.config.audit.restored,
      resourceType: this.config.resourceType,
      resourceId: id,
      changes: { method: 'POST', path: `/api/v1/${this.config.basePath}/${id}/restore` },
    });

    return { message: 'Category restored', data: null };
  }

  async softDelete(id: string, actorId: string) {
    const category = await this.model.findFirst({ where: { id, deleted_at: null } });
    if (!category) throw new NotFoundException('Category not found');

    const childCount = await this.config.countLiveChildren(id);
    if (childCount > 0) throw new ConflictException(this.config.childConflictMessage);

    // Free the (lang, slug) unique constraint so a new category can claim the
    // slug while this one is in the trash. Restore reverses it.
    const deletedAt = new Date();
    const suffix = softDeleteSuffix(deletedAt);

    await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const translations = await this.translationOn(tx).findMany({ where: { category_id: id } });
      for (const t of translations) {
        await this.translationOn(tx).update({
          where: { category_id_lang: { category_id: id, lang: t.lang } },
          data: { slug: `${t.slug}${suffix}` },
        });
      }
      await this.categoryOn(tx).update({ where: { id }, data: { deleted_at: deletedAt } });
    });

    await this.audit.write({
      actorId,
      action: this.config.audit.deleted,
      resourceType: this.config.resourceType,
      resourceId: id,
      changes: { method: 'DELETE', path: `/api/v1/${this.config.basePath}/${id}` },
    });

    return { message: 'Category deleted', data: null };
  }
}
