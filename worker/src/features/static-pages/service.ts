import type { Context } from 'hono';
import type { Prisma } from '../../generated/prisma/client';
import { AUDIT_ACTIONS, audit } from '../../lib/audit';
import { getDb } from '../../lib/db';
import { badRequest, conflict, notFound, rethrowP2002AsConflict } from '../../lib/errors';
import { sanitizeEditorHtml } from '../../lib/html-sanitize';
import { assertExactlyOneDefault, loadActiveLanguages, resolveTranslation } from '../../lib/i18n';
import { OG_IMAGE_SELECT } from '../../lib/media-selects';
import { buildPaginationMeta, resolvePagination } from '../../lib/pagination';
import { assertSlugRenameAllowed } from '../../lib/publish-rules';
import { softDeleteSuffix, stripSoftDeleteSuffix } from '../../lib/soft-delete';
import type { AppEnv } from '../../lib/types';
import type { CreateStaticPageInput, StaticPageTranslationInput, UpdateStaticPageInput } from './schemas';

type Ctx = Context<AppEnv>;

// The public list is a directory (titles + SEO metadata), not a reading surface: no body, no
// translations array. The detail routes keep the body.
const LIST_TRANSLATION_SELECT = {
  page_id: true,
  lang: true,
  title: true,
  is_default: true,
  meta_title: true,
  meta_description: true,
  og_image_id: true,
} satisfies Prisma.static_page_translationsSelect;

const PUBLIC_LIST_SELECT = {
  id: true,
  display_order: true,
  is_published: true,
  slug: true,
  created_at: true,
  updated_at: true,
  deleted_at: true,
  static_page_translations: { select: LIST_TRANSLATION_SELECT },
} satisfies Prisma.static_pagesSelect;

const DETAIL_INCLUDE = { static_page_translations: { include: { og_image: { select: OG_IMAGE_SELECT } } } } satisfies Prisma.static_pagesInclude;

/** Message per violated unique index; only the slug index may say "slug already used". */
function pageConflictMessages(slug: string | null | undefined): { fallback: string; byTarget: Record<string, string> } {
  return {
    fallback: 'A value in this request is already in use by another record',
    byTarget: {
      slug: slug ? `Slug "${slug}" is already used by another static page` : 'The slug is already used by another static page',
      static_page_translations: 'The same language appears more than once in translations',
      lang: 'The same language appears more than once in translations',
    },
  };
}

export async function findAllPublic(c: Ctx, page: number, limit: number) {
  const db = getDb(c);
  const { skip } = resolvePagination({ page, limit });
  const where = { deleted_at: null, is_published: true };
  const [pages, total, active] = await Promise.all([
    db.static_pages.findMany({ where, select: PUBLIC_LIST_SELECT, orderBy: [{ display_order: 'asc' }, { id: 'asc' }], skip, take: limit }),
    db.static_pages.count({ where }),
    loadActiveLanguages(db),
  ]);
  const items = pages.map(({ static_page_translations, ...p }) => ({
    ...p,
    translation: resolveTranslation(static_page_translations, c.get('lang'), { active }),
  }));
  return { message: 'Static pages fetched', data: { items, pagination: buildPaginationMeta(page, limit, total) } };
}

/** Admin list: includes drafts; optional `is_published` filter. */
export async function findAllAdmin(c: Ctx, page: number, limit: number, isPublished: boolean | undefined) {
  const db = getDb(c);
  const { skip } = resolvePagination({ page, limit });
  const where: Prisma.static_pagesWhereInput = { deleted_at: null };
  if (isPublished !== undefined) where.is_published = isPublished;
  const [pages, total, active] = await Promise.all([
    db.static_pages.findMany({ where, include: { static_page_translations: true }, orderBy: [{ display_order: 'asc' }, { id: 'asc' }], skip, take: limit }),
    db.static_pages.count({ where }),
    loadActiveLanguages(db),
  ]);
  const items = pages.map((p) => ({ ...p, translation: resolveTranslation(p.static_page_translations, c.get('lang'), { active }) }));
  return { message: 'Static pages fetched', data: { items, pagination: buildPaginationMeta(page, limit, total) } };
}

/**
 * Public callers only ever see published pages (an unpublished draft isn't readable by its UUID);
 * the admin route and the post-write reads pass `allowUnpublished`.
 */
export async function findOne(c: Ctx, id: string, lang: string | null, opts: { allowUnpublished?: boolean } = {}) {
  const db = getDb(c);
  const where: Prisma.static_pagesWhereInput = { id, deleted_at: null };
  if (!opts.allowUnpublished) where.is_published = true;
  const [page, active] = await Promise.all([db.static_pages.findFirst({ where, include: DETAIL_INCLUDE }), loadActiveLanguages(db)]);
  if (!page) throw notFound('Static page not found');
  return { message: 'Static page fetched', data: { ...page, translation: resolveTranslation(page.static_page_translations, lang, { active }) } };
}

/** Public detail by canonical slug: one language-agnostic slug per page. */
export async function findBySlug(c: Ctx, slug: string, lang: string | null) {
  const db = getDb(c);
  const [page, active] = await Promise.all([
    db.static_pages.findFirst({ where: { slug, deleted_at: null, is_published: true }, include: DETAIL_INCLUDE }),
    loadActiveLanguages(db),
  ]);
  if (!page) throw notFound('Static page not found');
  return { message: 'Static page fetched', data: { ...page, translation: resolveTranslation(page.static_page_translations, lang, { active }) } };
}

/** A bad og_image_id is a 404 (same text and status as posts), not a Prisma FK error. */
async function assertOgImagesExist(c: Ctx, translations: { og_image_id?: string | null }[]): Promise<void> {
  const ogImageIds = translations.map((t) => t.og_image_id).filter((v): v is string => typeof v === 'string');
  if (ogImageIds.length === 0) return;
  const found = await getDb(c).media.findMany({ where: { id: { in: ogImageIds } }, select: { id: true } });
  if (found.length !== new Set(ogImageIds).size) throw notFound('One or more og_image_id values do not match any media record');
}

/** Rejects a slug that collides with another static page's slug. */
async function assertSlugAvailable(c: Ctx, slug: string, excludePageId: string | null): Promise<void> {
  const clash = await getDb(c).static_pages.findFirst({
    where: { slug, ...(excludePageId ? { NOT: { id: excludePageId } } : {}) },
    select: { id: true },
  });
  if (clash) throw conflict(`Slug "${slug}" is already used by another static page`);
}

const translationData = (t: StaticPageTranslationInput) => ({
  title: t.title,
  body: sanitizeEditorHtml(t.body),
  meta_title: t.meta_title ?? null,
  meta_description: t.meta_description ?? null,
  og_image_id: t.og_image_id ?? null,
  is_default: t.is_default ?? false,
});

export async function create(c: Ctx, input: CreateStaticPageInput) {
  const db = getDb(c);
  await assertOgImagesExist(c, input.translations);
  await assertSlugAvailable(c, input.slug, null);
  assertExactlyOneDefault(input.translations);

  let created: { id: string };
  try {
    created = await db.$transaction(async (tx) => {
      const row = await tx.static_pages.create({
        data: { slug: input.slug, display_order: input.display_order ?? 0, is_published: input.is_published ?? true },
      });
      await tx.static_page_translations.createMany({
        data: input.translations.map((t) => ({ page_id: row.id, lang: t.lang, ...translationData(t) })),
      });
      return row;
    });
  } catch (err) {
    const { fallback, byTarget } = pageConflictMessages(input.slug);
    rethrowP2002AsConflict(err, fallback, byTarget);
  }

  audit(c, {
    action: AUDIT_ACTIONS.STATIC_PAGE_CREATED,
    resourceType: 'static_page',
    resourceId: created.id,
    changes: { method: 'POST', path: '/api/v1/static-pages' },
  });

  const { data } = await findOne(c, created.id, null, { allowUnpublished: true });
  return { message: 'Static page created', data };
}

export async function update(c: Ctx, id: string, input: UpdateStaticPageInput) {
  const db = getDb(c);
  const existing = await db.static_pages.findFirst({ where: { id, deleted_at: null } });
  if (!existing) throw notFound('Static page not found');

  if (input.translations) await assertOgImagesExist(c, input.translations);

  assertSlugRenameAllowed({
    resourceLabel: 'static page',
    currentSlug: existing.slug,
    nextSlug: input.slug,
    isPublished: existing.is_published,
    willBePublished: input.is_published ?? existing.is_published,
  });
  if (input.slug !== undefined) await assertSlugAvailable(c, input.slug as string, id);

  try {
    await db.$transaction(async (tx) => {
      // A JSON null on a scalar reaches Prisma as null (Nest's `!== undefined` checks) and fails there, as in Nest.
      const scalarPatch: Prisma.static_pagesUpdateInput = { updated_at: new Date() };
      if (input.slug !== undefined) scalarPatch.slug = input.slug as string;
      if (input.display_order !== undefined) scalarPatch.display_order = input.display_order as number;
      if (input.is_published !== undefined) scalarPatch.is_published = input.is_published as boolean;
      if (Object.keys(scalarPatch).length > 1) await tx.static_pages.update({ where: { id }, data: scalarPatch });

      if (input.translations && input.translations.length > 0) {
        for (const t of input.translations) {
          const data = translationData(t);
          await tx.static_page_translations.upsert({
            where: { page_id_lang: { page_id: id, lang: t.lang } },
            create: { page_id: id, lang: t.lang, ...data },
            update: data,
          });
        }

        // The single-default invariant is re-checked on the full set once every upsert has landed: a
        // partial update flipping is_default on one row must not leave 0 or 2+ defaults.
        const defaults = await tx.static_page_translations.count({ where: { page_id: id, is_default: true } });
        if (defaults !== 1) throw badRequest('Exactly one translation must have is_default: true');
      }
    });
  } catch (err) {
    const { fallback, byTarget } = pageConflictMessages(input.slug);
    rethrowP2002AsConflict(err, fallback, byTarget);
  }

  audit(c, {
    action: AUDIT_ACTIONS.STATIC_PAGE_UPDATED,
    resourceType: 'static_page',
    resourceId: id,
    changes: { method: 'PATCH', path: `/api/v1/static-pages/${id}` },
  });

  const { data } = await findOne(c, id, null, { allowUnpublished: true });
  return { message: 'Static page updated', data };
}

export async function togglePublish(c: Ctx, id: string, isPublished: boolean) {
  const db = getDb(c);
  const existing = await db.static_pages.findFirst({ where: { id, deleted_at: null } });
  if (!existing) throw notFound('Static page not found');

  if (existing.is_published === isPublished) {
    const { data } = await findOne(c, id, null, { allowUnpublished: true });
    return { message: 'Static page already in requested state', data };
  }

  await db.static_pages.update({ where: { id }, data: { is_published: isPublished, updated_at: new Date() } });

  audit(c, {
    action: isPublished ? AUDIT_ACTIONS.STATIC_PAGE_PUBLISHED : AUDIT_ACTIONS.STATIC_PAGE_UNPUBLISHED,
    resourceType: 'static_page',
    resourceId: id,
    changes: { method: 'PATCH', path: `/api/v1/static-pages/${id}/publish`, is_published: isPublished },
  });

  const { data } = await findOne(c, id, null, { allowUnpublished: true });
  return { message: isPublished ? 'Static page published' : 'Static page unpublished', data };
}

/** Soft-deleted static pages, with the `__del_` suffix stripped from their slugs for display. */
export async function findTrash(c: Ctx, page: number, limit: number) {
  const db = getDb(c);
  const where = { deleted_at: { not: null } };
  const [rows, total, active] = await Promise.all([
    db.static_pages.findMany({
      where,
      include: { static_page_translations: true },
      orderBy: [{ deleted_at: 'desc' }, { id: 'asc' }],
      skip: (page - 1) * limit,
      take: limit,
    }),
    db.static_pages.count({ where }),
    loadActiveLanguages(db),
  ]);
  const items = rows.map((row) => ({
    ...row,
    slug: stripSoftDeleteSuffix(row.slug),
    translation: resolveTranslation(row.static_page_translations, null, { active }),
  }));
  return { message: 'Trash fetched', data: { items, pagination: buildPaginationMeta(page, limit, total) } };
}

/** Reverses softDelete's slug suffix; 409 if a live page has taken the original slug since. */
export async function restore(c: Ctx, id: string) {
  const db = getDb(c);
  const page = await db.static_pages.findFirst({ where: { id, deleted_at: { not: null } } });
  if (!page) throw notFound('Deleted static page not found');

  const originalSlug = stripSoftDeleteSuffix(page.slug);

  try {
    await db.$transaction(async (tx) => {
      const clash = await tx.static_pages.findFirst({ where: { slug: originalSlug, deleted_at: null, NOT: { id } }, select: { id: true } });
      if (clash) throw conflict(`Cannot restore: slug "${originalSlug}" is now used by another static page`);
      await tx.static_pages.update({ where: { id }, data: { deleted_at: null, updated_at: new Date(), slug: originalSlug } });
    });
  } catch (err) {
    // At READ COMMITTED a concurrent insert can still claim the slug after the check: the unique index is the backstop.
    rethrowP2002AsConflict(err, 'Cannot restore: the original slug was claimed by another static page');
  }

  audit(c, {
    action: AUDIT_ACTIONS.STATIC_PAGE_RESTORED,
    resourceType: 'static_page',
    resourceId: id,
    changes: { method: 'POST', path: `/api/v1/static-pages/${id}/restore` },
  });

  return { message: 'Static page restored', data: null };
}

export async function softDelete(c: Ctx, id: string) {
  const db = getDb(c);
  const page = await db.static_pages.findFirst({ where: { id, deleted_at: null } });
  if (!page) throw notFound('Static page not found');

  // The suffix frees the slug's unique index so a new page can claim it while this one is in the trash.
  const deletedAt = new Date();
  await db.static_pages.update({ where: { id }, data: { deleted_at: deletedAt, slug: `${page.slug}${softDeleteSuffix(deletedAt)}` } });

  audit(c, {
    action: AUDIT_ACTIONS.STATIC_PAGE_DELETED,
    resourceType: 'static_page',
    resourceId: id,
    changes: { method: 'DELETE', path: `/api/v1/static-pages/${id}` },
  });

  return { message: 'Static page deleted', data: null };
}
