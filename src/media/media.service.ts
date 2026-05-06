import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { R2Service } from '../storage/r2.service';
import { ConfirmUploadDto, RequestUploadUrlDto, UpdateMediaDto } from './dto/media.dto';

@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly r2Service: R2Service,
  ) {}

  async requestUploadUrl(dto: RequestUploadUrlDto, userId: string) {
    const result = await this.r2Service.generateUploadUrl(dto.filename, dto.mime_type);

    // Track the pending upload so the cleanup cron can delete orphans
    await this.prisma.pending_media_uploads.create({
      data: { key: result.key, requested_by: userId },
    });

    return { message: 'Upload URL generated', data: result };
  }

  async confirmUpload(dto: ConfirmUploadDto, userId: string) {
    const exists = await this.r2Service.objectExists(dto.key);
    if (!exists) {
      throw new BadRequestException('File not found in storage — upload the file before confirming');
    }

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

    // Remove the pending tracking record now that the upload is confirmed
    await this.prisma.pending_media_uploads.deleteMany({ where: { key: dto.key } });

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

  /** Runs every hour at :00. Deletes R2 objects whose presigned URL expired without confirmation. */
  @Cron('0 * * * *')
  async cleanupOrphanUploads() {
    const expired = await this.prisma.pending_media_uploads.findMany({
      where: { expires_at: { lt: new Date() } },
    });

    if (expired.length === 0) return;

    this.logger.log(`[MediaCleanup] Found ${expired.length} expired pending upload(s)`);

    for (const record of expired) {
      try {
        await this.r2Service.deleteObject(record.key);
        this.logger.log(`[MediaCleanup] Deleted orphan R2 object: ${record.key}`);
      } catch (err) {
        this.logger.warn(`[MediaCleanup] Failed to delete R2 object ${record.key}: ${err}`);
      }

      await this.prisma.pending_media_uploads.delete({ where: { id: record.id } });
    }
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
