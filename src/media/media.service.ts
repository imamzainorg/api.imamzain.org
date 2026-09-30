import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  Injectable,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { cronsDisabled } from '../common/utils/cron.util';
import { Prisma } from '@prisma/client';
import pLimit from 'p-limit';
import { PrismaService } from '../prisma/prisma.service';
import { isStorageNotFound, PENDING_UPLOAD_TTL_SECONDS, R2Service } from '../storage/r2.service';
import { AuditService } from '../common/audit/audit.service';
import { AUDIT_ACTIONS } from '../common/audit/audit.actions';
import { buildPaginationMeta, resolvePagination } from '../common/utils/pagination.util';
import { sniffImageMime } from '../common/utils/image-sniff.util';
import { ConfirmUploadDto, RequestUploadUrlDto, UpdateMediaDto } from './dto/media.dto';
import { ImageVariantService, VariantRow } from './image-variant.service';
import { describeVariants, VariantPassOutcome } from './media-variants.util';

// Process-wide gate on sharp variant generation. Each confirmUpload fans
// out to 4 sharp jobs; without a cap, parallel calls on large images can
// OOM the dyno. Move to BullMQ if/when Redis lands. Confirm's background job
// AND the regenerate route both go through it.
const variantLimit = pLimit(2);

/**
 * Bytes read from the head of a freshly uploaded object: enough to sniff the
 * magic number and for sharp to read the image header (dimensions + EXIF
 * orientation) without pulling a 25 MB original through the dyno.
 */
const UPLOAD_HEADER_PROBE_BYTES = 128 * 1024;

/** Most references listed per source and overall — the usage list is for a human to act on, not to page through. */
export const MEDIA_REFERENCE_LIMIT = 20;
/** How many of them the 409 message spells out (the full capped list is at GET /media/:id/references). */
const REFERENCES_IN_MESSAGE = 5;

export type MediaReferenceType = 'post' | 'book' | 'static_page' | 'gallery_image';
export type MediaReferenceField = 'cover_image' | 'attachment' | 'og_image' | 'gallery_item';

export interface MediaReference {
  type: MediaReferenceType;
  /** Id of the referencing resource (for `gallery_image` that is the media id itself). */
  id: string;
  field: MediaReferenceField;
  /** Set for translation-level references (og:image is per language). */
  lang?: string;
  /** The referencing resource is in the trash — it still holds the reference. */
  trashed: boolean;
}

interface ReferenceList {
  total: number;
  items: MediaReference[];
}

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
      data: {
        key: result.key,
        requested_by: userId,
        // Same constant that caps the presigned URL's lifetime, so the row always
        // outlives the URL it tracks.
        expires_at: new Date(Date.now() + PENDING_UPLOAD_TTL_SECONDS * 1000),
      },
    });

    return { message: 'Upload URL generated', data: result };
  }

  /**
   * Remove a rejected upload's object. The pending row is deliberately KEPT until
   * it expires: the presigned PUT URL is still valid for the rest of its lifetime,
   * so the uploader could re-PUT bytes to the same key, and only a surviving row
   * lets the hourly sweep delete that second object too. (Best effort on the R2
   * side — a failed delete is logged and the sweep retries it.)
   */
  private async discardRejectedUpload(key: string): Promise<void> {
    await this.r2Service.deleteObject(key).catch((err) => {
      this.logger.warn(`Failed to delete rejected R2 object ${key}: ${err}`);
    });
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
    if (pending.expires_at < new Date()) {
      throw new GoneException('Upload URL has expired — request a new one');
    }

    const head = await this.r2Service.headObject(dto.key);
    if (!head) {
      throw new BadRequestException('File not found in storage — upload the file before confirming');
    }

    // Trust HeadObject over the client-declared metadata. The DTO values are
    // attacker-controlled (they could declare image/jpeg for an HTML or SVG
    // payload, or claim 1×1 px for a 100 MB file). The stored Content-Type is
    // what the CDN will serve, so it must be an allowed image type. The
    // presigned PUT signs Content-Type, but anything with bucket access can
    // still write another type — re-check here and purge anything else.
    if (!this.r2Service.isAllowedImageMime(head.contentType)) {
      await this.discardRejectedUpload(dto.key);
      throw new BadRequestException(
        `Stored object type "${head.contentType ?? 'unknown'}" is not an allowed image type`,
      );
    }
    const actualMime = head.contentType;
    const actualSize = head.contentLength ?? dto.file_size;

    // Enforce the MIME-aware size cap. Past this point sharp would try to
    // decode the file into memory; rejecting here keeps the dyno safe and
    // reclaims the storage we paid R2 for.
    const maxBytes = this.r2Service.maxBytesFor(actualMime);
    if (actualSize > maxBytes) {
      await this.discardRejectedUpload(dto.key);
      const maxMb = Math.round(maxBytes / 1024 / 1024);
      throw new PayloadTooLargeException(
        `File exceeds the ${maxMb} MB limit for ${actualMime}`,
      );
    }

    // Content-Type is metadata the uploader chose; the bytes are the truth.
    // Sniff the magic number (one small ranged GET) so an HTML/SVG payload
    // labelled image/png never becomes a media row served from the CDN origin.
    // The same read carries the image header, so the row can be created with
    // the file's true, orientation-aware size instead of the client's claim.
    const prefix = await this.r2Service.getObjectPrefix(dto.key, UPLOAD_HEADER_PROBE_BYTES);
    if (!sniffImageMime(prefix)) {
      await this.discardRejectedUpload(dto.key);
      throw new BadRequestException('Uploaded file is not a JPEG, PNG, GIF or WebP image');
    }
    const probed = await this.variants.probeDimensions(prefix);

    const url = this.r2Service.publicUrlForKey(dto.key);

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
          width: probed?.width ?? dto.width ?? null,
          height: probed?.height ?? dto.height ?? null,
          uploaded_by: userId,
        },
      });

      await tx.pending_media_uploads.deleteMany({ where: { key: dto.key } });

      return created;
    });

    // Generate responsive variants in the background. The original media
    // row is returned immediately so the editor isn't blocked by a 2–5s
    // sharp decode. Clients that need the variants poll GET /media/:id until
    // `variants_status` leaves "processing"; until then the original URL is fully
    // usable. Failures are isolated inside the variant service — the media row
    // is still created if some / all variants fail. Gated by `variantLimit` so
    // parallel confirms don't OOM the dyno.
    setImmediate(() => {
      variantLimit(() => this.variants.processMedia(media, dto.key))
        .catch((err) => this.logger.warn(`Background variant generation failed for ${media.id}: ${err}`));
    });

    this.audit.write({
      actorId: userId,
      action: AUDIT_ACTIONS.MEDIA_CREATED,
      resourceType: 'media',
      resourceId: media.id,
      changes: {
        method: 'POST',
        path: '/api/v1/media/confirm',
        variants_generated: 'pending',
      },
    });

    return { message: 'Media created', data: this.withVariants(media, []) };
  }

  /**
   * Re-run variant generation for an existing media row. Useful when a
   * variant width set changes, or if generation failed at upload time. It
   * shares confirm's concurrency gate, reconciles the stored dimensions with
   * the real file, and answers 200 with `variants_status` explaining a
   * no-variants result (original missing from storage, too small, animated).
   */
  async regenerateVariants(id: string, actorId: string) {
    const media = await this.prisma.media.findUnique({ where: { id } });
    if (!media) throw new NotFoundException('Media not found');

    const key = this.r2Service.keyFromPublicUrl(media.url);
    const pass = await variantLimit(() => this.variants.processMedia(media, key));

    // Read back rather than trusting this run alone: rows from earlier runs still
    // count, and a partial run must not hide them.
    const variants = await this.variants.findForMedia(id);
    const current = { ...media, ...pass.mediaPatch };
    const data = this.withVariants(current, variants, pass.outcome);

    await this.audit.write({
      actorId,
      action: AUDIT_ACTIONS.MEDIA_VARIANTS_REGENERATED,
      resourceType: 'media',
      resourceId: id,
      changes: {
        method: 'POST',
        path: `/api/v1/media/${id}/regenerate-variants`,
        variants_generated: pass.variants.length,
        variants_status: data.variants_status,
      },
    });

    return { message: 'Variants regenerated', data };
  }

  /** Runs every hour at :00. Deletes R2 objects whose presigned URL expired without confirmation. */
  @Cron('0 * * * *')
  async cleanupOrphanUploads() {
    if (cronsDisabled()) return;
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
    const itemsWithVariants = items.map((m) => this.withVariants(m, variantMap.get(m.id) ?? []));

    return {
      message: 'Media fetched',
      data: { items: itemsWithVariants, pagination: buildPaginationMeta(page, limit, total) },
    };
  }

  async findOne(id: string) {
    const media = await this.prisma.media.findUnique({ where: { id } });
    if (!media) throw new NotFoundException('Media not found');
    const variants = await this.variants.findForMedia(id);
    return { message: 'Media fetched', data: this.withVariants(media, variants) };
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

  /**
   * Everything that still points at this media — the answer to "why can't I
   * delete it". Soft-deleted parents are included and flagged `trashed`: their
   * FKs still reference the row.
   */
  async findReferences(id: string) {
    const media = await this.prisma.media.findUnique({ where: { id }, select: { id: true } });
    if (!media) throw new NotFoundException('Media not found');

    const { total, items } = await this.listReferences(this.prisma, id);
    return {
      message: 'Media references fetched',
      data: { media_id: id, total, shown: items.length, truncated: total > items.length, items },
    };
  }

  async delete(id: string, userId: string) {
    const media = await this.prisma.media.findUnique({ where: { id } });
    if (!media) throw new NotFoundException('Media not found');

    // Refuse deletion while ANY row physically references this media, so the
    // caller gets a clean 409 instead of a silent FK SET NULL (post cover /
    // og:image) or a raw FK error (book cover RESTRICT). References are counted
    // regardless of the parent's deleted_at: the FKs still point at this row
    // even from a soft-deleted post/book. This must cover EVERY FK into media —
    // the og_image_id columns on post/book/static-page/gallery-image
    // translations all SET NULL on delete, so any one missed here lets a
    // delete silently strip a resource's SEO image (book/page og:image were
    // previously unguarded; gallery joined this set when it gained SEO fields
    // — see 20260818170000_gallery_image_seo_fields). academic_paper_translations
    // .og_image_id was removed entirely (dead feature, never used) — no
    // longer a reference source to check here.
    if ((await this.countReferences(this.prisma, id)) > 0) {
      throw await this.mediaInUse(id);
    }

    // DB first, storage last. The pre-check above only reduces how often we
    // reach here — it is not authoritative, so a reference can still land
    // between it and this point. The final recheck-and-delete therefore runs
    // inside one transaction and is what actually decides whether the media
    // is gone: a reference added in that race is caught here and the row
    // survives untouched. Only once the row is confirmed deleted do we touch
    // R2, so that race can never leave a live reference pointing at a 404 —
    // the earlier "storage first" ordering avoided orphaning storage on a
    // failed DB delete, but did so by allowing exactly that worse outcome.
    // media_variants rows cascade via the FK.
    const stillReferenced = await this.prisma.$transaction(async (tx) => {
      if ((await this.countReferences(tx, id)) > 0) return true;
      await tx.media.delete({ where: { id } });
      return false;
    });
    if (stillReferenced) throw await this.mediaInUse(id);

    await this.audit.write({
      actorId: userId,
      action: AUDIT_ACTIONS.MEDIA_DELETED,
      resourceType: 'media',
      resourceId: id,
      changes: { method: 'DELETE', path: `/api/v1/media/${id}` },
    });

    // Best-effort now that the row is gone for good: a failure here orphans
    // a blob (wasted storage, no functional impact — nothing references it
    // any more) rather than the row-survives-but-files-are-gone outcome this
    // ordering exists to prevent. Logged for manual cleanup (or a future
    // sweep job, mirroring cleanupOrphanUploads' approach for expired
    // pending uploads), not surfaced to the caller — the delete they asked
    // for did succeed.
    const failedKeys = await this.deleteStoredFiles(id, media.url);
    if (failedKeys.length > 0) {
      this.logger.error(`Media ${id} deleted, but R2 cleanup failed for ${failedKeys.join(', ')} — orphaned blob(s)`);
    }

    return { message: 'Media deleted', data: null };
  }

  /**
   * Media row + its variants, plus the derived `planned_widths` /
   * `variants_status` (see media-variants.util.ts). `variants` itself is exactly
   * the array clients already consume.
   */
  private withVariants<
    M extends { mime_type: string; width: number | null; created_at: Date },
  >(media: M, variants: VariantRow[], outcome?: VariantPassOutcome) {
    return { ...media, variants, ...describeVariants(media, variants, { outcome }) };
  }

  /** Delete the original and every variant object; a key that is already gone counts as deleted. Returns the keys that genuinely failed. */
  private async deleteStoredFiles(id: string, url: string): Promise<string[]> {
    const failed = await this.variants.deleteR2Variants(id);
    if (failed.length > 0) return failed;

    const key = this.r2Service.keyFromPublicUrl(url);
    try {
      await this.r2Service.deleteObject(key);
    } catch (err) {
      if (isStorageNotFound(err)) return [];
      this.logger.warn(`R2 delete failed for ${key}: ${err}`);
      return [key];
    }
    return [];
  }

  private async countReferences(db: Prisma.TransactionClient, id: string): Promise<number> {
    const counts = await Promise.all([
      db.posts.count({ where: { cover_image_id: id } }),
      db.books.count({ where: { cover_image_id: id } }),
      db.gallery_images.count({ where: { media_id: id } }),
      db.post_attachments.count({ where: { media_id: id } }),
      db.post_translations.count({ where: { og_image_id: id } }),
      db.book_translations.count({ where: { og_image_id: id } }),
      db.static_page_translations.count({ where: { og_image_id: id } }),
      db.gallery_image_translations.count({ where: { og_image_id: id } }),
    ]);
    return counts.reduce((sum, n) => sum + n, 0);
  }

  /** One source of references: capped rows, and the real total only when the cap was hit. */
  private async collectReferences<Row>(
    rows: Promise<Row[]>,
    count: () => Promise<number>,
    toReference: (row: Row) => MediaReference,
  ): Promise<ReferenceList> {
    const found = await rows;
    const total = found.length < MEDIA_REFERENCE_LIMIT ? found.length : await count();
    return { total, items: found.map(toReference) };
  }

  private async listReferences(db: Prisma.TransactionClient, id: string): Promise<ReferenceList> {
    const take = MEDIA_REFERENCE_LIMIT;
    const trashed = (row: { deleted_at: Date | null }) => row.deleted_at !== null;

    const sources = await Promise.all([
      this.collectReferences(
        db.posts.findMany({ where: { cover_image_id: id }, select: { id: true, deleted_at: true }, orderBy: { id: 'asc' }, take }),
        () => db.posts.count({ where: { cover_image_id: id } }),
        (r): MediaReference => ({ type: 'post', id: r.id, field: 'cover_image', trashed: trashed(r) }),
      ),
      this.collectReferences(
        db.post_attachments.findMany({
          where: { media_id: id },
          select: { post_id: true, posts: { select: { deleted_at: true } } },
          orderBy: { post_id: 'asc' },
          take,
        }),
        () => db.post_attachments.count({ where: { media_id: id } }),
        (r): MediaReference => ({ type: 'post', id: r.post_id, field: 'attachment', trashed: trashed(r.posts) }),
      ),
      this.collectReferences(
        db.post_translations.findMany({
          where: { og_image_id: id },
          select: { post_id: true, lang: true, posts: { select: { deleted_at: true } } },
          orderBy: [{ post_id: 'asc' }, { lang: 'asc' }],
          take,
        }),
        () => db.post_translations.count({ where: { og_image_id: id } }),
        (r): MediaReference => ({ type: 'post', id: r.post_id, field: 'og_image', lang: r.lang, trashed: trashed(r.posts) }),
      ),
      this.collectReferences(
        db.books.findMany({ where: { cover_image_id: id }, select: { id: true, deleted_at: true }, orderBy: { id: 'asc' }, take }),
        () => db.books.count({ where: { cover_image_id: id } }),
        (r): MediaReference => ({ type: 'book', id: r.id, field: 'cover_image', trashed: trashed(r) }),
      ),
      this.collectReferences(
        db.book_translations.findMany({
          where: { og_image_id: id },
          select: { book_id: true, lang: true, books: { select: { deleted_at: true } } },
          orderBy: [{ book_id: 'asc' }, { lang: 'asc' }],
          take,
        }),
        () => db.book_translations.count({ where: { og_image_id: id } }),
        (r): MediaReference => ({ type: 'book', id: r.book_id, field: 'og_image', lang: r.lang, trashed: trashed(r.books) }),
      ),
      this.collectReferences(
        db.static_page_translations.findMany({
          where: { og_image_id: id },
          select: { page_id: true, lang: true, static_pages: { select: { deleted_at: true } } },
          orderBy: [{ page_id: 'asc' }, { lang: 'asc' }],
          take,
        }),
        () => db.static_page_translations.count({ where: { og_image_id: id } }),
        (r): MediaReference => ({ type: 'static_page', id: r.page_id, field: 'og_image', lang: r.lang, trashed: trashed(r.static_pages) }),
      ),
      // A gallery item's primary key IS the media id, so this reference has the
      // same id as the media being asked about.
      this.collectReferences(
        db.gallery_images.findMany({ where: { media_id: id }, select: { media_id: true, deleted_at: true }, take }),
        () => db.gallery_images.count({ where: { media_id: id } }),
        (r): MediaReference => ({ type: 'gallery_image', id: r.media_id, field: 'gallery_item', trashed: trashed(r) }),
      ),
      this.collectReferences(
        db.gallery_image_translations.findMany({
          where: { og_image_id: id },
          select: { media_id: true, lang: true, gallery_images: { select: { deleted_at: true } } },
          orderBy: [{ media_id: 'asc' }, { lang: 'asc' }],
          take,
        }),
        () => db.gallery_image_translations.count({ where: { og_image_id: id } }),
        (r): MediaReference => ({ type: 'gallery_image', id: r.media_id, field: 'og_image', lang: r.lang, trashed: trashed(r.gallery_images) }),
      ),
    ]);

    return {
      total: sources.reduce((sum, s) => sum + s.total, 0),
      items: sources.flatMap((s) => s.items).slice(0, MEDIA_REFERENCE_LIMIT),
    };
  }

  /**
   * The 409 for a media that is still in use. The AllExceptionsFilter only
   * surfaces `message` and `code`, so the message itself names the first few
   * referencing records; the full capped list is one GET away, and `details`
   * carries it for any client that reads the raw exception body.
   */
  private async mediaInUse(id: string): Promise<ConflictException> {
    const { total, items } = await this.listReferences(this.prisma, id);

    const shown = items.slice(0, REFERENCES_IN_MESSAGE).map((r) => {
      const where = r.lang ? `${r.type} ${r.id} (${r.field}, ${r.lang})` : `${r.type} ${r.id} (${r.field})`;
      return r.trashed ? `${where}, in the trash` : where;
    });
    const more = total > shown.length ? `, and ${total - shown.length} more` : '';
    const hints = [
      'Detach the image from those records first; a record in the trash still holds its reference until the image is changed on the record itself.',
    ];
    if (items.some((r) => r.type === 'gallery_image' && r.field === 'gallery_item')) {
      hints.push('A gallery item uses the media id as its own id, so this file IS that gallery item: delete the gallery item first.');
    }

    return new ConflictException({
      message:
        `Media is still referenced by ${total} record${total === 1 ? '' : 's'}` +
        (shown.length > 0 ? ` (${shown.join('; ')}${more})` : '') +
        `. ${hints.join(' ')} Full list: GET /media/${id}/references`,
      code: 'MEDIA_IN_USE',
      details: { total, shown: items.length, truncated: total > items.length, references: items },
    });
  }
}
