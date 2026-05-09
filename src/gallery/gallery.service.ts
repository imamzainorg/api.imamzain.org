import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateGalleryImageDto, GalleryQueryDto, UpdateGalleryImageDto } from './dto/gallery.dto';

function resolveTranslation(translations: any[], lang: string | null) {
  if (!translations || translations.length === 0) return null;
  if (lang) {
    const match = translations.find((t) => t.lang === lang);
    if (match) return match;
  }
  return translations.find((t) => t.is_default) ?? translations[0];
}

@Injectable()
export class GalleryService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: GalleryQueryDto, lang: string | null) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const where: any = { deleted_at: null };
    if (query.category_id) where.category_id = query.category_id;
    if (query.tags && query.tags.length > 0) where.tags = { hasEvery: query.tags };
    if (query.locations && query.locations.length > 0) where.locations = { hasEvery: query.locations };

    const [items, total] = await Promise.all([
      this.prisma.gallery_images.findMany({
        where,
        include: {
          gallery_image_translations: true,
          media: true,
          gallery_categories: { include: { gallery_category_translations: true } },
        },
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
    return { message: 'Gallery fetched', data: { items: mapped, pagination: { page, limit, total, pages: Math.ceil(total / limit) } } };
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

  async create(dto: CreateGalleryImageDto, userId: string) {
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

    try {
      await this.prisma.audit_logs.create({
        data: {
          user_id: userId,
          action: 'GALLERY_IMAGE_CREATED',
          resource_type: 'gallery_image',
          resource_id: image.media_id,
          changes: { method: 'POST', path: '/api/v1/gallery' },
        },
      });
    } catch {}

    return { message: 'Gallery image created', data: image };
  }

  async update(id: string, dto: UpdateGalleryImageDto, userId: string) {
    const image = await this.prisma.gallery_images.findFirst({ where: { media_id: id, deleted_at: null } });
    if (!image) throw new NotFoundException('Gallery image not found');

    if (dto.category_id !== undefined && dto.category_id !== image.category_id) {
      const category = await this.prisma.gallery_categories.findFirst({
        where: { id: dto.category_id, deleted_at: null },
      });
      if (!category) throw new NotFoundException('Category not found');
    }

    await this.prisma.$transaction(async (tx) => {
      // Defensively strip media_id (the primary key) and translations from
      // the data spread; the DTO no longer exposes media_id, but this guards
      // the service against future DTO regressions.
      const { translations, media_id: _media_id, ...rest } = dto as any;
      await tx.gallery_images.update({ where: { media_id: id }, data: { ...rest, updated_at: new Date() } });
      if (translations) {
        for (const t of translations) {
          await tx.gallery_image_translations.upsert({
            where: { media_id_lang: { media_id: id, lang: t.lang } },
            create: { media_id: id, lang: t.lang, title: t.title, description: t.description ?? null },
            update: { title: t.title, description: t.description ?? null },
          });
        }
      }
    });

    try {
      await this.prisma.audit_logs.create({
        data: {
          user_id: userId,
          action: 'GALLERY_IMAGE_UPDATED',
          resource_type: 'gallery_image',
          resource_id: id,
          changes: { method: 'PATCH', path: `/api/v1/gallery/${id}` },
        },
      });
    } catch {}

    return { message: 'Gallery image updated', data: null };
  }

  async softDelete(id: string, userId: string) {
    const image = await this.prisma.gallery_images.findFirst({ where: { media_id: id, deleted_at: null } });
    if (!image) throw new NotFoundException('Gallery image not found');

    await this.prisma.gallery_images.update({ where: { media_id: id }, data: { deleted_at: new Date() } });

    try {
      await this.prisma.audit_logs.create({
        data: {
          user_id: userId,
          action: 'GALLERY_IMAGE_DELETED',
          resource_type: 'gallery_image',
          resource_id: id,
          changes: { method: 'DELETE', path: `/api/v1/gallery/${id}` },
        },
      });
    } catch {}

    return { message: 'Gallery image deleted', data: null };
  }
}
