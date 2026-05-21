import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, PayloadTooLargeException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { R2Service } from '../storage/r2.service';
import { AuditService } from '../common/audit/audit.service';
import { AUDIT_ACTIONS } from '../common/audit/audit.actions';
import { buildPaginationMeta, resolvePagination } from '../common/utils/pagination.util';
import { ConfirmUploadDto, RequestUploadUrlDto, UpdateMediaDto } from './dto/media.dto';
import { ImageVariantService } from './image-variant.service';

@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly r2Service: R2Service,
    private readonly variants: ImageVariantService,
    private readonly audit: AuditService,
  ) {}

  async requestUploadUrl(dto: RequestUploadUrlDto, userId: string) {
    const result = await this.r2Service.generateUploadUrl(dto.filename, dto.mime_type);

    await this.prisma.pending_media_uploads.create({
      data: { key: result.key, requested_by: userId },
    });

    return { message: 'Upload URL generated', data: result };
  }

  async confirmUpload(dto: ConfirmUploadDto, userId: string) {
    if (!this.r2Service.isManagedKey(dto.key)) {
      throw new BadRequestException('Invalid storage key');
    }

    // Bind the confirm step to the user that issued the presigned URL.
    // Without this check, anyone with media:create could register a row
    // pointing at any object in the bucket — including objects uploaded
    // by other users for unrelated flows.
    const pending = await this.prisma.pending_media_uploads.findFirst({
      where: { key: dto.key },
    });
    if (!pending) {
      throw new NotFoundException('No pending upload for that key — request a new upload URL');
    }
    if (pending.requested_by !== userId) {
      throw new ForbiddenException('Upload key was issued to a different user');
    }

    const head = await this.r2Service.headObject(dto.key);
    if (!head) {
      throw new BadRequestException('File not found in storage — upload the file before confirming');
    }

    // Trust HeadObject over the client-declared metadata. The DTO values are
    // attacker-controlled (they could declare image/jpeg for an HTML or SVG
    // payload, or claim 1×1 px for a 100 MB file).
    const actualMime = head.contentType ?? dto.mime_type;
    const actualSize = head.contentLength ?? dto.file_size;

    // Enforce the MIME-aware size cap. Past this point sharp would try to
    // decode the file into memory; rejecting here keeps the dyno safe and
    // reclaims the storage we paid R2 for.
    const maxBytes = this.r2Service.maxBytesFor(actualMime);
    if (actualSize > maxBytes) {
      await this.r2Service.deleteObject(dto.key).catch((err) => {
        this.logger.warn(`Failed to delete oversized R2 object ${dto.key}: ${err}`);
      });
      await this.prisma.pending_media_uploads.deleteMany({ where: { key: dto.key } });
      const maxMb = Math.round(maxBytes / 1024 / 1024);
      throw new PayloadTooLargeException(
        `File exceeds the ${maxMb} MB limit for ${actualMime}`,
      );
    }

    const publicBaseUrl = (process.env.R2_PUBLIC_BASE_URL ?? 'https://cdn.imamzain.org').replace(/\/$/, '');
    const url = `${publicBaseUrl}/${dto.key}`;

    // For new-format keys (`media/originals/<uuid>/...`) we pin the media
    // row's id to the same uuid baked into the path. That way the originals
    // folder and the variants folder share the same `<media_id>` segment,
    // making "all R2 objects for this row" a single prefix.
    const plannedMediaId = this.r2Service.mediaIdFromKey(dto.key) ?? undefined;

    const media = await this.prisma.$transaction(async (tx) => {
      const created = await tx.media.create({
        data: {
          ...(plannedMediaId ? { id: plannedMediaId } : {}),
          filename: dto.filename,
          alt_text: dto.alt_text ?? null,
          url,
          mime_type: actualMime,
          file_size: actualSize,
          width: dto.width ?? null,
          height: dto.height ?? null,
          uploaded_by: userId,
        },
      });

      await tx.pending_media_uploads.deleteMany({ where: { key: dto.key } });

      return created;
    });

    // Generate responsive variants synchronously so the editor can reference
    // them in the response and start using <img srcset> immediately. Failures
    // are isolated inside the variant service — the media row is still
    // created if some / all variants fail.
    const generatedVariants = await this.variants.generateForMedia(media.id, dto.key);

    await this.audit.write({
      actorId: userId,
      action: AUDIT_ACTIONS.MEDIA_CREATED,
      resourceType: 'media',
      resourceId: media.id,
      changes: {
        method: 'POST',
        path: '/api/v1/media/confirm',
        variants_generated: generatedVariants.length,
      },
    });

    return { message: 'Media created', data: { ...media, variants: generatedVariants } };
  }

  /**
   * Re-run variant generation for an existing media row. Useful when a
   * variant width set changes, or if generation failed at upload time.
   */
  async regenerateVariants(id: string, actorId: string) {
    const media = await this.prisma.media.findUnique({ where: { id } });
    if (!media) throw new NotFoundException('Media not found');

    const key = this.r2Service.keyFromPublicUrl(media.url);
    const variants = await this.variants.generateForMedia(id, key);

    await this.audit.write({
      actorId,
      action: AUDIT_ACTIONS.MEDIA_VARIANTS_REGENERATED,
      resourceType: 'media',
      resourceId: id,
      changes: {
        method: 'POST',
        path: `/api/v1/media/${id}/regenerate-variants`,
        variants_generated: variants.length,
      },
    });

    return { message: 'Variants regenerated', data: { ...media, variants } };
  }

  /** Runs every hour at :00. Deletes R2 objects whose presigned URL expired without confirmation. */
  @Cron('0 * * * *')
  async cleanupOrphanUploads() {
    const expired = await this.prisma.pending_media_uploads.findMany({
      where: { expires_at: { lt: new Date() } },
    });

    if (expired.length === 0) return;

    this.logger.log(`Found ${expired.length} expired pending upload(s)`);

    for (const record of expired) {
      // Only delete the pending row when the R2 deletion succeeded. If we
      // dropped the row anyway, a transient R2 outage would silently leave
      // an orphan blob with no remaining tracking record.
      try {
        await this.r2Service.deleteObject(record.key);
      } catch (err) {
        this.logger.warn(`Failed to delete R2 object ${record.key}: ${err}`);
        continue;
      }

      try {
        await this.prisma.pending_media_uploads.delete({ where: { id: record.id } });
        this.logger.log(`Cleaned up orphan upload ${record.key}`);
      } catch (err) {
        // Multi-instance: another worker may have already deleted the row
        // (P2025). Ignore so the loop continues.
        this.logger.debug(`pending_media_uploads.delete skipped for ${record.id}: ${err}`);
      }
    }
  }

  async findAll(query: { page?: number; limit?: number; search?: string; mime_type?: string }) {
    const { page, limit, skip } = resolvePagination(query);

    const where: Prisma.mediaWhereInput = {};
    if (query.mime_type) where.mime_type = query.mime_type;
    if (query.search) {
      where.OR = [
        { filename: { contains: query.search, mode: 'insensitive' } },
        { alt_text: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.media.findMany({
        where,
        orderBy: [{ created_at: 'desc' }, { id: 'asc' }],
        skip,
        take: limit,
      }),
      this.prisma.media.count({ where }),
    ]);

    const variantMap = await this.variants.findForMediaIds(items.map((m) => m.id));
    const itemsWithVariants = items.map((m) => ({ ...m, variants: variantMap.get(m.id) ?? [] }));

    return {
      message: 'Media fetched',
      data: { items: itemsWithVariants, pagination: buildPaginationMeta(page, limit, total) },
    };
  }

  async findOne(id: string) {
    const media = await this.prisma.media.findUnique({ where: { id } });
    if (!media) throw new NotFoundException('Media not found');
    const variants = await this.variants.findForMedia(id);
    return { message: 'Media fetched', data: { ...media, variants } };
  }

  async update(id: string, dto: UpdateMediaDto, userId: string) {
    const media = await this.prisma.media.findUnique({ where: { id } });
    if (!media) throw new NotFoundException('Media not found');

    // Build the update payload explicitly. A bare `data: dto` spread would
    // let future DTO fields leak into the row update unchecked.
    const updateData: Prisma.mediaUpdateInput = {};
    if (dto.alt_text !== undefined) updateData.alt_text = dto.alt_text;
    if (dto.filename !== undefined) updateData.filename = dto.filename;

    const updated = await this.prisma.media.update({ where: { id }, data: updateData });

    await this.audit.write({
      actorId: userId,
      action: AUDIT_ACTIONS.MEDIA_UPDATED,
      resourceType: 'media',
      resourceId: id,
      changes: { method: 'PATCH', path: `/api/v1/media/${id}` },
    });

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

    // Delete the DB row first so a downstream R2 failure leaves only a
    // detectable orphan blob (which the cleanup cron can sweep), instead
    // of the previous order which kept the DB row pointing at a key that
    // could already have been deleted in R2. media_variants rows cascade
    // automatically via the FK; we only have to clean up R2 ourselves.
    await this.prisma.media.delete({ where: { id } });

    const key = this.r2Service.keyFromPublicUrl(media.url);
    await Promise.all([
      this.r2Service.deleteObject(key).catch((err) => {
        this.logger.warn(`R2 delete failed for ${key}: ${err}`);
      }),
      this.variants.deleteR2Variants(id),
    ]);

    await this.audit.write({
      actorId: userId,
      action: AUDIT_ACTIONS.MEDIA_DELETED,
      resourceType: 'media',
      resourceId: id,
      changes: { method: 'DELETE', path: `/api/v1/media/${id}` },
    });

    return { message: 'Media deleted', data: null };
  }
}
