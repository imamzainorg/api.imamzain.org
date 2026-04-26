import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { R2Service } from '../storage/r2.service';
import { ConfirmUploadDto, RequestUploadUrlDto, UpdateMediaDto } from './dto/media.dto';

@Injectable()
export class MediaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly r2Service: R2Service,
  ) {}

  async requestUploadUrl(dto: RequestUploadUrlDto, userId: string) {
    const result = await this.r2Service.generateUploadUrl(dto.filename, dto.mime_type);
    return { message: 'Upload URL generated', data: result };
  }

  async confirmUpload(dto: ConfirmUploadDto, userId: string) {
    const publicBaseUrl = process.env.R2_PUBLIC_BASE_URL ?? 'https://cdn.imamzain.org';
    const url = `${publicBaseUrl}/${dto.key}`;

    const media = await this.prisma.media.create({
      data: {
        filename: dto.filename,
        alt_text: dto.alt_text ?? null,
        url,
        mime_type: dto.mime_type,
        file_size: dto.file_size,
        width: dto.width ?? null,
        height: dto.height ?? null,
        uploaded_by: userId,
      },
    });

    try {
      await this.prisma.audit_logs.create({
        data: {
          user_id: userId,
          action: 'MEDIA_CREATED',
          resource_type: 'media',
          resource_id: media.id,
          changes: { method: 'POST', path: '/api/v1/media/confirm' },
        },
      });
    } catch {}

    return { message: 'Media created', data: media };
  }

  async findAll(page: number, limit: number) {
    const skip = (page - 1) * limit;
    const [items, total] = await Promise.all([
      this.prisma.media.findMany({
        orderBy: { created_at: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.media.count(),
    ]);

    return {
      message: 'Media fetched',
      data: { items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } },
    };
  }

  async findOne(id: string) {
    const media = await this.prisma.media.findUnique({ where: { id } });
    if (!media) throw new NotFoundException('Media not found');
    return { message: 'Media fetched', data: media };
  }

  async update(id: string, dto: UpdateMediaDto, userId: string) {
    const media = await this.prisma.media.findUnique({ where: { id } });
    if (!media) throw new NotFoundException('Media not found');

    const updated = await this.prisma.media.update({ where: { id }, data: dto });

    try {
      await this.prisma.audit_logs.create({
        data: {
          user_id: userId,
          action: 'MEDIA_UPDATED',
          resource_type: 'media',
          resource_id: id,
          changes: { method: 'PATCH', path: `/api/v1/media/${id}` },
        },
      });
    } catch {}

    return { message: 'Media updated', data: updated };
  }

  async delete(id: string, userId: string) {
    const media = await this.prisma.media.findUnique({ where: { id } });
    if (!media) throw new NotFoundException('Media not found');

    const [postRef, bookRef, galleryRef, attachRef] = await Promise.all([
      this.prisma.posts.count({ where: { cover_image_id: id, deleted_at: null } }),
      this.prisma.books.count({ where: { cover_image_id: id, deleted_at: null } }),
      this.prisma.gallery_images.count({ where: { media_id: id } }),
      this.prisma.post_attachments.count({ where: { media_id: id } }),
    ]);

    if (postRef + bookRef + galleryRef + attachRef > 0) {
      throw new ConflictException('Media is still referenced by other records');
    }

    const publicBaseUrl = process.env.R2_PUBLIC_BASE_URL ?? 'https://cdn.imamzain.org';
    const key = media.url.replace(publicBaseUrl + '/', '');
    this.r2Service.deleteObject(key).catch((err) => {
      console.error('[MediaService] R2 delete failed:', err);
    });

    await this.prisma.media.delete({ where: { id } });

    try {
      await this.prisma.audit_logs.create({
        data: {
          user_id: userId,
          action: 'MEDIA_DELETED',
          resource_type: 'media',
          resource_id: id,
          changes: { method: 'DELETE', path: `/api/v1/media/${id}` },
        },
      });
    } catch {}

    return { message: 'Media deleted', data: null };
  }
}
