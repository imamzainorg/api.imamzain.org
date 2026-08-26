import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import { AUDIT_ACTIONS } from '../common/audit/audit.actions';
import { resolveTranslation } from '../common/utils/translation.util';
import { buildPaginationMeta, resolvePagination } from '../common/utils/pagination.util';
import { publicWhere } from '../common/utils/visibility.util';
import { MEDIA_VARIANT_SELECT, OG_IMAGE_SELECT, PUBLIC_MEDIA_SELECT } from '../common/crud/media-selects';
import { CreateGalleryImageDto, GalleryQueryDto, UpdateGalleryImageDto } from './dto/gallery.dto';

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
    select: {
      media_id: true,
      lang: true,
      title: true,
      meta_title: true,
      meta_description: true,
      og_image_id: true,
    },
  },
  media: { select: PUBLIC_MEDIA_SELECT },
  gallery_categories: {
    select: {
      id: true,
      created_at: true,
      gallery_category_translations: {
        select: { category_id: true, lang: true, title: true, slug: true, description: true },
      },
    },
  },
} satisfies Prisma.gallery_imagesSelect;

@Injectable()
export class GalleryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async findAll(query: GalleryQueryDto, lang: string | null, isAdmin = false) {
    const { page, limit, skip } = resolvePagination(query);

    const where: Prisma.gallery_imagesWhereInput = { deleted_at: null };
    if (!isAdmin) where.is_published = true;
    if (query.category_id) where.category_id = query.category_id;
    if (query.tags && query.tags.length > 0) where.tags = { hasEvery: query.tags };
    if (query.locations && query.locations.length > 0) where.locations = { hasEvery: query.locations };

    const [items, total] = await Promise.all([
      this.prisma.gallery_images.findMany({
        where,
        select: GALLERY_LIST_SELECT,
        orderBy: [{ created_at: 'desc' }, { media_id: 'asc' }],
        skip,
        take: limit,
      }),
      this.prisma.gallery_images.count({ where }),
    ]);

    const mapped = items.map((img) => ({
      ...img,
      translation: resolveTranslation(img.gallery_image_translations, lang),
    }));
    return { message: 'Gallery fetched', data: { items: mapped, pagination: buildPaginationMeta(page, limit, total) } };
  }

  async findOne(id: string, lang: string | null, isAdmin = false) {
    const where: Prisma.gallery_imagesWhereInput = { media_id: id, deleted_at: null };
    if (!isAdmin) where.is_published = true;

    const image = await this.prisma.gallery_images.findFirst({
      where,
      include: {
        gallery_image_translations: { include: { og_image: { select: OG_IMAGE_SELECT } } },
        media: { include: { media_variants: { select: MEDIA_VARIANT_SELECT, orderBy: { width: 'asc' } } } },
        gallery_categories: { include: { gallery_category_translations: true } },
      },
    });
    if (!image) throw new NotFoundException('Gallery image not found');
    return {
      message: 'Gallery image fetched',
      data: { ...image, translation: resolveTranslation(image.gallery_image_translations, lang) },
    };
  }

  async trackView(id: string) {
    const result = await this.prisma.gallery_images.updateMany({
      where: { media_id: id, ...publicWhere(true) },
      data: { views: { increment: 1 } },
    });
    if (result.count === 0) throw new NotFoundException('Gallery image not found');
    return { message: 'View tracked', data: null };
  }

  async togglePublish(id: string, isPublished: boolean, actorId: string, lang: string | null) {
    const existing = await this.prisma.gallery_images.findFirst({
      where: { media_id: id, deleted_at: null },
      select: { media_id: true, is_published: true },
    });
    if (!existing) throw new NotFoundException('Gallery image not found');

    if (existing.is_published === isPublished) {
      const { data } = await this.findOne(id, lang, true);
      return { message: 'Gallery image already in requested state', data };
    }

    await this.prisma.gallery_images.update({
      where: { media_id: id },
      data: { is_published: isPublished, updated_at: new Date() },
    });

    await this.audit.write({
      actorId,
      action: isPublished ? AUDIT_ACTIONS.GALLERY_IMAGE_PUBLISHED : AUDIT_ACTIONS.GALLERY_IMAGE_UNPUBLISHED,
      resourceType: 'gallery_image',
      resourceId: id,
      changes: { method: 'PATCH', path: `/api/v1/gallery/${id}/publish`, is_published: isPublished },
    });

    const { data } = await this.findOne(id, lang, true);
    return { message: isPublished ? 'Gallery image published' : 'Gallery image unpublished', data };
  }

  async create(dto: CreateGalleryImageDto, userId: string, lang: string | null) {
    const media = await this.prisma.media.findUnique({ where: { id: dto.media_id } });
    if (!media) throw new NotFoundException('Media not found');

    // Validate the category is live (the FK alone doesn't exclude soft-deleted
    // categories), mirroring update() and posts.create(). Without this a new
    // public image could be bound to a trashed category.
    if (dto.category_id) {
      const category = await this.prisma.gallery_categories.findFirst({
        where: { id: dto.category_id, deleted_at: null },
      });
      if (!category) throw new NotFoundException('Category not found');
    }

    // Validate every translation-level og_image_id up front so a bad one
    // surfaces as 404 with a useful message instead of a Prisma FK error.
    const ogImageIds = dto.translations
      .map((t) => t.og_image_id)
      .filter((v): v is string => typeof v === 'string');
    if (ogImageIds.length > 0) {
      const found = await this.prisma.media.findMany({
        where: { id: { in: ogImageIds } },
        select: { id: true },
      });
      if (found.length !== new Set(ogImageIds).size) {
        throw new NotFoundException('One or more og_image_id values do not match any media record');
      }
    }

    const image = await this.prisma.$transaction(async (tx) => {
      const created = await tx.gallery_images.create({
        data: {
          media_id: dto.media_id,
          category_id: dto.category_id ?? null,
          taken_at: dto.taken_at ? new Date(dto.taken_at) : null,
          author: dto.author ?? null,
          tags: dto.tags ?? [],
          locations: dto.locations ?? [],
          // Gallery photos are typically uploaded already-final by staff —
          // default to published, matching books/papers/audios.
          is_published: dto.is_published ?? true,
          added_by: userId,
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

    await this.audit.write({
      actorId: userId,
      action: AUDIT_ACTIONS.GALLERY_IMAGE_CREATED,
      resourceType: 'gallery_image',
      resourceId: image.media_id,
      changes: { method: 'POST', path: '/api/v1/gallery' },
    });

    const { data } = await this.findOne(image.media_id, lang);
    return { message: 'Gallery image created', data };
  }

  async update(id: string, dto: UpdateGalleryImageDto, userId: string, lang: string | null) {
    const image = await this.prisma.gallery_images.findFirst({ where: { media_id: id, deleted_at: null } });
    if (!image) throw new NotFoundException('Gallery image not found');

    // Gate the existence check on a TRUTHY id so an explicit `null` clears the
    // category (reaching the disconnect branch below) instead of triggering a
    // spurious 'Category not found'. A provided UUID is still validated live.
    if (dto.category_id && dto.category_id !== image.category_id) {
      const category = await this.prisma.gallery_categories.findFirst({
        where: { id: dto.category_id, deleted_at: null },
      });
      if (!category) throw new NotFoundException('Category not found');
    }

    if (dto.translations) {
      const ogImageIds = dto.translations
        .map((t) => t.og_image_id)
        .filter((v): v is string => typeof v === 'string');
      if (ogImageIds.length > 0) {
        const found = await this.prisma.media.findMany({
          where: { id: { in: ogImageIds } },
          select: { id: true },
        });
        if (found.length !== new Set(ogImageIds).size) {
          throw new NotFoundException('One or more og_image_id values do not match any media record');
        }
      }
    }

    await this.prisma.$transaction(async (tx) => {
      // Build the update payload explicitly so DTO additions can't slip into
      // the row data (e.g. an accidental media_id field that would attempt
      // to repoint the PK).
      const updateData: Prisma.gallery_imagesUpdateInput = { updated_at: new Date() };
      if (dto.category_id !== undefined) {
        updateData.gallery_categories = dto.category_id
          ? { connect: { id: dto.category_id } }
          : { disconnect: true };
      }
      if (dto.taken_at !== undefined) {
        updateData.taken_at = dto.taken_at ? new Date(dto.taken_at) : null;
      }
      if (dto.author !== undefined) updateData.author = dto.author;
      if (dto.tags !== undefined) updateData.tags = dto.tags;
      if (dto.locations !== undefined) updateData.locations = dto.locations;
      if (dto.is_published !== undefined) updateData.is_published = dto.is_published;

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

    await this.audit.write({
      actorId: userId,
      action: AUDIT_ACTIONS.GALLERY_IMAGE_UPDATED,
      resourceType: 'gallery_image',
      resourceId: id,
      changes: { method: 'PATCH', path: `/api/v1/gallery/${id}` },
    });

    const { data } = await this.findOne(id, lang);
    return { message: 'Gallery image updated', data };
  }

  /** List soft-deleted gallery images (admin trash view). */
  async findTrash(page: number, limit: number) {
    const skip = (page - 1) * limit;
    const where: Prisma.gallery_imagesWhereInput = { deleted_at: { not: null } };

    const [items, total] = await Promise.all([
      this.prisma.gallery_images.findMany({
        where,
        select: GALLERY_LIST_SELECT,
        orderBy: [{ deleted_at: 'desc' }, { media_id: 'asc' }],
        skip,
        take: limit,
      }),
      this.prisma.gallery_images.count({ where }),
    ]);

    const mapped = items.map((img) => ({
      ...img,
      translation: resolveTranslation(img.gallery_image_translations, null),
    }));

    return {
      message: 'Trash fetched',
      data: { items: mapped, pagination: buildPaginationMeta(page, limit, total) },
    };
  }

  /** Restore a soft-deleted gallery image. */
  async restore(id: string, userId: string) {
    const image = await this.prisma.gallery_images.findFirst({
      where: { media_id: id, deleted_at: { not: null } },
    });
    if (!image) throw new NotFoundException('Deleted gallery image not found');

    // If the image's category was soft-deleted while the image sat in trash,
    // don't bring back a live image pointing at a deleted category — it would
    // leak the trashed category's data in public reads. Detach it on restore.
    let categoryReset: Prisma.gallery_imagesUpdateInput = {};
    if (image.category_id) {
      const category = await this.prisma.gallery_categories.findFirst({
        where: { id: image.category_id, deleted_at: null },
      });
      if (!category) categoryReset = { gallery_categories: { disconnect: true } };
    }

    await this.prisma.gallery_images.update({
      where: { media_id: id },
      data: { deleted_at: null, updated_at: new Date(), ...categoryReset },
    });

    await this.audit.write({
      actorId: userId,
      action: AUDIT_ACTIONS.GALLERY_IMAGE_RESTORED,
      resourceType: 'gallery_image',
      resourceId: id,
      changes: { method: 'POST', path: `/api/v1/gallery/${id}/restore` },
    });

    return { message: 'Gallery image restored', data: null };
  }

  async softDelete(id: string, userId: string) {
    const image = await this.prisma.gallery_images.findFirst({ where: { media_id: id, deleted_at: null } });
    if (!image) throw new NotFoundException('Gallery image not found');

    await this.prisma.gallery_images.update({ where: { media_id: id }, data: { deleted_at: new Date() } });

    await this.audit.write({
      actorId: userId,
      action: AUDIT_ACTIONS.GALLERY_IMAGE_DELETED,
      resourceType: 'gallery_image',
      resourceId: id,
      changes: { method: 'DELETE', path: `/api/v1/gallery/${id}` },
    });

    return { message: 'Gallery image deleted', data: null };
  }
}
