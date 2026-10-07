import type { Context } from 'hono';
import type { Prisma } from '../../generated/prisma/client';
import { AUDIT_ACTIONS, audit } from '../../lib/audit';
import { getDb } from '../../lib/db';
import { conflict, DUPLICATE_LANG_MESSAGE, notFound, UNIQUE_CONFLICT_CODES, uniqueViolationTarget } from '../../lib/errors';
import { loadActiveLanguages, resolveTranslation } from '../../lib/i18n';
import { MEDIA_VARIANT_SELECT, OG_IMAGE_SELECT, PUBLIC_MEDIA_SELECT } from '../../lib/media-selects';
import { buildPaginationMeta, resolvePagination } from '../../lib/pagination';
import type { AppEnv } from '../../lib/types';
import type { CreateGalleryInput, UpdateGalleryInput } from './schemas';

type Ctx = Context<AppEnv>;

interface ListFilters {
  page: number;
  limit: number;
  category_id?: string;
  tags?: string[];
  locations?: string[];
}

// List queries drop the description from translations.
const GALLERY_LIST_SELECT = {
  media_id: true,
  category_id: true,
  taken_at: true,
  author: true,
  tags: true,
  locations: true,
  views: true,
  is_published: true,
  created_at: true,
  updated_at: true,
  deleted_at: true,
  gallery_image_translations: {
    select: { media_id: true, lang: true, title: true, meta_title: true, meta_description: true, og_image_id: true },
  },
  media: { select: PUBLIC_MEDIA_SELECT },
  gallery_categories: {
    select: {
      id: true,
      created_at: true,
      gallery_category_translations: { select: { category_id: true, lang: true, title: true, slug: true, description: true } },
    },
  },
} satisfies Prisma.gallery_imagesSelect;

// What the CMS reads: the whole row (added_by included) and full media.
const GALLERY_ADMIN_DETAIL_INCLUDE = {
  gallery_image_translations: { include: { og_image: { select: OG_IMAGE_SELECT } } },
  media: { include: { media_variants: { select: MEDIA_VARIANT_SELECT, orderBy: { width: 'asc' } } } },
  gallery_categories: { include: { gallery_category_translations: true } },
} satisfies Prisma.gallery_imagesInclude;

// What anonymous visitors read: every column of the row except the staff UUID (added_by), and the
// slim public media shape instead of the whole media row (file_size, uploaded_by).
const GALLERY_PUBLIC_DETAIL_SELECT = {
  media_id: true,
  category_id: true,
  taken_at: true,
  author: true,
  tags: true,
  locations: true,
  views: true,
  is_published: true,
  created_at: true,
  updated_at: true,
  deleted_at: true,
  gallery_image_translations: GALLERY_ADMIN_DETAIL_INCLUDE.gallery_image_translations,
  media: { select: PUBLIC_MEDIA_SELECT },
  gallery_categories: GALLERY_ADMIN_DETAIL_INCLUDE.gallery_categories,
} satisfies Prisma.gallery_imagesSelect;

export async function findAll(c: Ctx, query: ListFilters, lang: string | null, isAdmin = false) {
  const db = getDb(c);
  const { page, limit, skip } = resolvePagination(query);

  const where: Prisma.gallery_imagesWhereInput = { deleted_at: null };
  if (!isAdmin) where.is_published = true;
  if (query.category_id) where.category_id = query.category_id;
  if (query.tags && query.tags.length > 0) where.tags = { hasEvery: query.tags };
  if (query.locations && query.locations.length > 0) where.locations = { hasEvery: query.locations };

  const [items, total, active] = await Promise.all([
    db.gallery_images.findMany({
      where,
      select: GALLERY_LIST_SELECT,
      orderBy: [{ created_at: 'desc' }, { media_id: 'asc' }],
      skip,
      take: limit,
    }),
    db.gallery_images.count({ where }),
    isAdmin ? null : loadActiveLanguages(db),
  ]);

  const mapped = items.map((img) => ({
    ...img,
    translation: resolveTranslation(img.gallery_image_translations, lang, { active, includeInactive: isAdmin }),
  }));
  return { message: 'Gallery fetched', data: { items: mapped, pagination: buildPaginationMeta(page, limit, total) } };
}

export async function findOne(c: Ctx, id: string, lang: string | null, isAdmin = false) {
  const db = getDb(c);
  const where: Prisma.gallery_imagesWhereInput = { media_id: id, deleted_at: null };
  if (!isAdmin) where.is_published = true;

  const [image, active] = await Promise.all([
    isAdmin
      ? db.gallery_images.findFirst({ where, include: GALLERY_ADMIN_DETAIL_INCLUDE })
      : db.gallery_images.findFirst({ where, select: GALLERY_PUBLIC_DETAIL_SELECT }),
    isAdmin ? null : loadActiveLanguages(db),
  ]);
  if (!image) throw notFound('Gallery image not found');
  return {
    message: 'Gallery image fetched',
    data: { ...image, translation: resolveTranslation(image.gallery_image_translations, lang, { active, includeInactive: isAdmin }) },
  };
}

export async function trackView(c: Ctx, id: string) {
  const result = await getDb(c).gallery_images.updateMany({
    where: { media_id: id, deleted_at: null, is_published: true },
    data: { views: { increment: 1 } },
  });
  if (result.count === 0) throw notFound('Gallery image not found');
  return { message: 'View tracked', data: null };
}

export async function togglePublish(c: Ctx, id: string, isPublished: boolean, lang: string | null) {
  const db = getDb(c);
  const existing = await db.gallery_images.findFirst({ where: { media_id: id, deleted_at: null }, select: { media_id: true, is_published: true } });
  if (!existing) throw notFound('Gallery image not found');

  if (existing.is_published === isPublished) {
    const { data } = await findOne(c, id, lang, true);
    return { message: 'Gallery image already in requested state', data };
  }

  await db.gallery_images.update({ where: { media_id: id }, data: { is_published: isPublished, updated_at: new Date() } });

  audit(c, {
    action: isPublished ? AUDIT_ACTIONS.GALLERY_IMAGE_PUBLISHED : AUDIT_ACTIONS.GALLERY_IMAGE_UNPUBLISHED,
    resourceType: 'gallery_image',
    resourceId: id,
    changes: { method: 'PATCH', path: `/api/v1/gallery/${id}/publish`, is_published: isPublished },
  });

  const { data } = await findOne(c, id, lang, true);
  return { message: isPublished ? 'Gallery image published' : 'Gallery image unpublished', data };
}

/** A bad og_image_id is a 404 with a useful message, not a Prisma FK error. */
async function assertOgImagesExist(c: Ctx, translations: { og_image_id?: string | null }[]): Promise<void> {
  const ogImageIds = translations.map((t) => t.og_image_id).filter((v): v is string => typeof v === 'string');
  if (ogImageIds.length === 0) return;
  const found = await getDb(c).media.findMany({ where: { id: { in: ogImageIds } }, select: { id: true } });
  if (found.length !== new Set(ogImageIds).size) throw notFound('One or more og_image_id values do not match any media record');
}

export async function create(c: Ctx, dto: CreateGalleryInput, lang: string | null) {
  const db = getDb(c);
  const media = await db.media.findUnique({ where: { id: dto.media_id } });
  if (!media) throw notFound('Media not found');

  // The FK alone doesn't exclude soft-deleted categories; a new public image must not bind to a trashed one.
  if (dto.category_id) {
    const category = await db.gallery_categories.findFirst({ where: { id: dto.category_id, deleted_at: null } });
    if (!category) throw notFound('Category not found');
  }

  await assertOgImagesExist(c, dto.translations);

  let image: { media_id: string };
  try {
    image = await db.$transaction(async (tx) => {
      const created = await tx.gallery_images.create({
        data: {
          media_id: dto.media_id,
          category_id: dto.category_id ?? null,
          taken_at: dto.taken_at ? new Date(dto.taken_at) : null,
          author: dto.author ?? null,
          tags: dto.tags ?? [],
          locations: dto.locations ?? [],
          // Gallery photos are typically uploaded already-final by staff: default to published.
          is_published: dto.is_published ?? true,
          added_by: c.get('user')?.id,
        },
      });
      await tx.gallery_image_translations.createMany({
        data: dto.translations.map((t) => ({
          media_id: created.media_id,
          lang: t.lang,
          title: t.title,
          description: t.description ?? null,
          meta_title: t.meta_title ?? null,
          meta_description: t.meta_description ?? null,
          og_image_id: t.og_image_id ?? null,
        })),
      });
      return created;
    });
  } catch (err) {
    throw await asCreateConflict(c, err, dto.media_id);
  }

  audit(c, {
    action: AUDIT_ACTIONS.GALLERY_IMAGE_CREATED,
    resourceType: 'gallery_image',
    resourceId: image.media_id,
    changes: { method: 'POST', path: '/api/v1/gallery' },
  });

  // Hydrate with the admin flag: a draft is filtered out by the public read, and the write has committed.
  const { data } = await findOne(c, image.media_id, lang, true);
  return { message: 'Gallery image created', data };
}

/**
 * A gallery entry is keyed by its media id, so re-adding a media that is already there (live or in the
 * trash) trips the primary key. Say which, and tell the editor what to do, instead of the generic 409.
 */
async function asCreateConflict(c: Ctx, err: unknown, mediaId: string): Promise<unknown> {
  const target = uniqueViolationTarget(err);
  if (target === null) return err;
  // Checked first: the translations key (media_id, lang) also mentions media_id.
  if (target.includes('translations') || target.includes('lang')) {
    return conflict(DUPLICATE_LANG_MESSAGE, { code: UNIQUE_CONFLICT_CODES.DUPLICATE_TRANSLATION_LANG });
  }
  if (target.includes('media_id') || target.includes('pkey')) {
    let trashed = false;
    try {
      const existing = await getDb(c).gallery_images.findUnique({ where: { media_id: mediaId }, select: { deleted_at: true } });
      trashed = existing?.deleted_at != null;
    } catch {
      // Fall through to the live-entry message; the lookup only sharpens it.
    }
    return trashed
      ? conflict('This media is in the gallery trash (a gallery entry is keyed by its media id); restore it instead of adding it again', {
          code: UNIQUE_CONFLICT_CODES.GALLERY_IMAGE_IN_TRASH,
        })
      : conflict('This media is already in the gallery (a gallery entry is keyed by its media id)', {
          code: UNIQUE_CONFLICT_CODES.GALLERY_IMAGE_EXISTS,
        });
  }
  return err;
}

export async function update(c: Ctx, id: string, dto: UpdateGalleryInput, lang: string | null) {
  const db = getDb(c);
  const image = await db.gallery_images.findFirst({ where: { media_id: id, deleted_at: null } });
  if (!image) throw notFound('Gallery image not found');

  // Gated on a TRUTHY id so an explicit `null` clears the category instead of failing the lookup.
  if (dto.category_id && dto.category_id !== image.category_id) {
    const category = await db.gallery_categories.findFirst({ where: { id: dto.category_id, deleted_at: null } });
    if (!category) throw notFound('Category not found');
  }

  if (dto.translations) await assertOgImagesExist(c, dto.translations);

  await db.$transaction(async (tx) => {
    // Built explicitly so a DTO addition can't slip into the row data (e.g. a media_id repointing the PK).
    const updateData: Prisma.gallery_imagesUpdateInput = { updated_at: new Date() };
    if (dto.category_id !== undefined) {
      updateData.gallery_categories = dto.category_id ? { connect: { id: dto.category_id } } : { disconnect: true };
    }
    if (dto.taken_at !== undefined) updateData.taken_at = dto.taken_at ? new Date(dto.taken_at) : null;
    // A JSON null on these reaches Prisma as null (Nest's `!== undefined` checks), as in Nest.
    if (dto.author !== undefined) updateData.author = dto.author;
    if (dto.tags !== undefined) updateData.tags = dto.tags as string[];
    if (dto.locations !== undefined) updateData.locations = dto.locations as string[];
    if (dto.is_published !== undefined) updateData.is_published = dto.is_published as boolean;

    await tx.gallery_images.update({ where: { media_id: id }, data: updateData });

    if (dto.translations) {
      for (const t of dto.translations) {
        const trData = {
          title: t.title,
          description: t.description ?? null,
          meta_title: t.meta_title ?? null,
          meta_description: t.meta_description ?? null,
          og_image_id: t.og_image_id ?? null,
        };
        await tx.gallery_image_translations.upsert({
          where: { media_id_lang: { media_id: id, lang: t.lang } },
          create: { media_id: id, lang: t.lang, ...trData },
          update: trData,
        });
      }
    }
  });

  audit(c, {
    action: AUDIT_ACTIONS.GALLERY_IMAGE_UPDATED,
    resourceType: 'gallery_image',
    resourceId: id,
    changes: { method: 'PATCH', path: `/api/v1/gallery/${id}` },
  });

  const { data } = await findOne(c, id, lang, true);
  return { message: 'Gallery image updated', data };
}

export async function findTrash(c: Ctx, page: number, limit: number) {
  const db = getDb(c);
  const where: Prisma.gallery_imagesWhereInput = { deleted_at: { not: null } };

  const [items, total] = await Promise.all([
    db.gallery_images.findMany({
      where,
      select: GALLERY_LIST_SELECT,
      orderBy: [{ deleted_at: 'desc' }, { media_id: 'asc' }],
      skip: (page - 1) * limit,
      take: limit,
    }),
    db.gallery_images.count({ where }),
  ]);

  const mapped = items.map((img) => ({
    ...img,
    translation: resolveTranslation(img.gallery_image_translations, null, { includeInactive: true }),
  }));
  return { message: 'Trash fetched', data: { items: mapped, pagination: buildPaginationMeta(page, limit, total) } };
}

export async function restore(c: Ctx, id: string) {
  const db = getDb(c);
  const image = await db.gallery_images.findFirst({ where: { media_id: id, deleted_at: { not: null } } });
  if (!image) throw notFound('Deleted gallery image not found');

  // A category trashed while the image sat in the trash would leak through public reads: detach it.
  let categoryReset: Prisma.gallery_imagesUpdateInput = {};
  if (image.category_id) {
    const category = await db.gallery_categories.findFirst({ where: { id: image.category_id, deleted_at: null } });
    if (!category) categoryReset = { gallery_categories: { disconnect: true } };
  }

  await db.gallery_images.update({ where: { media_id: id }, data: { deleted_at: null, updated_at: new Date(), ...categoryReset } });

  audit(c, {
    action: AUDIT_ACTIONS.GALLERY_IMAGE_RESTORED,
    resourceType: 'gallery_image',
    resourceId: id,
    changes: { method: 'POST', path: `/api/v1/gallery/${id}/restore` },
  });

  return { message: 'Gallery image restored', data: null };
}

export async function softDelete(c: Ctx, id: string) {
  const db = getDb(c);
  const image = await db.gallery_images.findFirst({ where: { media_id: id, deleted_at: null } });
  if (!image) throw notFound('Gallery image not found');

  await db.gallery_images.update({ where: { media_id: id }, data: { deleted_at: new Date() } });

  audit(c, {
    action: AUDIT_ACTIONS.GALLERY_IMAGE_DELETED,
    resourceType: 'gallery_image',
    resourceId: id,
    changes: { method: 'DELETE', path: `/api/v1/gallery/${id}` },
  });

  return { message: 'Gallery image deleted', data: null };
}
