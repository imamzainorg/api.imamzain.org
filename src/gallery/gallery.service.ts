import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import { AUDIT_ACTIONS } from '../common/audit/audit.actions';
import { resolveTranslation } from '../common/utils/translation.util';
import { buildPaginationMeta, resolvePagination } from '../common/utils/pagination.util';
import { CreateGalleryImageDto, GalleryQueryDto, UpdateGalleryImageDto } from './dto/gallery.dto';

// List queries drop the description from translations.
const GALLERY_LIST_SELECT = {
  media_id: true,
  category_id: true,
  taken_at: true,
  author: true,
  tags: true,
  locations: true,
  created_at: true,
  updated_at: true,
  deleted_at: true,
  gallery_image_translations: {
    select: { media_id: true, lang: true, title: true },
  },
  media: {
    select: { id: true, url: true, filename: true, alt_text: true, mime_type: true, width: true, height: true },
  },
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
  private readonly logger = new Logger(GalleryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async findAll(query: GalleryQueryDto, lang: string | null) {
    const { page, limit, skip } = resolvePagination(query);

    const where: Prisma.gallery_imagesWhereInput = { deleted_at: null };
    if (query.category_id) where.category_id = query.category_id;
    if (query.tags && query.tags.length > 0) where.tags = { hasEvery: query.tags };
    if (query.locations && query.locations.length > 0) where.locations = { hasEvery: query.locations };

    const [items, total] = await Promise.all([
      this.prisma.gallery_images.findMany({
        where,
        select: GALLERY_LIST_SELECT,
        orderBy: { created_at: 'desc' },
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

  async findOne(id: string, lang: string | null) {
    const image = await this.prisma.gallery_images.findFirst({
      where: { media_id: id, deleted_at: null },
      include: {
        gallery_image_translations: true,
        media: true,
        gallery_categories: { include: { gallery_category_translations: true } },
      },
    });
    if (!image) throw new NotFoundException('Gallery image not found');
    return {
      message: 'Gallery image fetched',
      data: { ...image, translation: resolveTranslation(image.gallery_image_translations, lang) },
    };
  }

  async create(dto: CreateGalleryImageDto, userId: string, lang: string | null) {
    const media = await this.prisma.media.findUnique({ where: { id: dto.media_id } });
    if (!media) throw new NotFoundException('Media not found');

    const image = await this.prisma.$transaction(async (tx) => {
      const created = await tx.gallery_images.create({
        data: {
          media_id: dto.media_id,
          category_id: dto.category_id ?? null,
          taken_at: dto.taken_at ? new Date(dto.taken_at) : null,
          author: dto.author ?? null,
          tags: dto.tags ?? [],
          locations: dto.locations ?? [],
          added_by: userId,
        },
      });
      await tx.gallery_image_translations.createMany({
        data: dto.translations.map((t) => ({
          media_id: created.media_id,
          lang: t.lang,
          title: t.title,
          description: t.description ?? null,
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

    if (dto.category_id !== undefined && dto.category_id !== image.category_id) {
      const category = await this.prisma.gallery_categories.findFirst({
        where: { id: dto.category_id, deleted_at: null },
      });
      if (!category) throw new NotFoundException('Category not found');
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

      await tx.gallery_images.update({ where: { media_id: id }, data: updateData });

      if (dto.translations) {
        for (const t of dto.translations) {
          await tx.gallery_image_translations.upsert({
            where: { media_id_lang: { media_id: id, lang: t.lang } },
            create: { media_id: id, lang: t.lang, title: t.title, description: t.description ?? null },
            update: { title: t.title, description: t.description ?? null },
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

    await this.prisma.gallery_images.update({
      where: { media_id: id },
      data: { deleted_at: null, updated_at: new Date() },
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
