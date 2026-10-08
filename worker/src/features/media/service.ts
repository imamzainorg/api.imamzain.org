import type { Context } from 'hono';
import type { Prisma } from '../../generated/prisma/client';
import { AUDIT_ACTIONS, audit } from '../../lib/audit';
import { defer, getDb } from '../../lib/db';
import { ApiError, badRequest, conflict, forbidden, notFound } from '../../lib/errors';
import { parseImageHeader, sniffImageMime } from '../../lib/image-header';
import { describeVariants, type VariantPassOutcome } from '../../lib/media-variants';
import { buildPaginationMeta, resolvePagination } from '../../lib/pagination';
import {
  ALLOWED_IMAGE_MIMES,
  deleteObject,
  generateImageUploadUrl,
  getObjectPrefix,
  headObject,
  isManagedKey,
  keyFromPublicUrl,
  maxBytesFor,
  mediaIdFromKey,
  PENDING_UPLOAD_TTL_SECONDS,
  publicUrlForKey,
} from '../../lib/r2';
import type { AppEnv } from '../../lib/types';
import type { ConfirmInput, UpdateMediaInput } from './schemas';
import { deleteR2Variants, findForMedia, findForMediaIds, processMedia, type VariantRow } from './variants';

type Ctx = Context<AppEnv>;
type Db = Prisma.TransactionClient;

/** Enough of a fresh upload to sniff its magic number and read the image header, not the whole 25 MB. */
const UPLOAD_HEADER_PROBE_BYTES = 128 * 1024;

/** Most references listed per source and overall: the list is for a human to act on. */
const MEDIA_REFERENCE_LIMIT = 20;
/** How many of them the 409 message spells out. */
const REFERENCES_IN_MESSAGE = 5;

type MediaReferenceType = 'post' | 'book' | 'static_page' | 'gallery_image';
type MediaReferenceField = 'cover_image' | 'attachment' | 'og_image' | 'gallery_item';

interface MediaReference {
  type: MediaReferenceType;
  /** For `gallery_image` this is the media id itself. */
  id: string;
  field: MediaReferenceField;
  /** og:image is per language. */
  lang?: string;
  /** The referencing record is in the trash, and still holds the reference. */
  trashed: boolean;
}

interface ReferenceList {
  total: number;
  items: MediaReference[];
}

/** The media row with its variants and the derived `planned_widths` / `variants_status`. */
function withVariants<M extends { mime_type: string; width: number | null; created_at: Date }>(media: M, variants: VariantRow[], outcome?: VariantPassOutcome) {
  return { ...media, variants, ...describeVariants(media, variants, { outcome }) };
}

export async function requestUploadUrl(c: Ctx, dto: { filename: string; mime_type: string }, userId: string) {
  const result = await generateImageUploadUrl(c.env, dto.filename, dto.mime_type);
  await getDb(c).pending_media_uploads.create({
    // The row outlives the URL it tracks (same constant caps the URL's lifetime).
    data: { key: result.key, requested_by: userId, expires_at: new Date(Date.now() + PENDING_UPLOAD_TTL_SECONDS * 1000) },
  });
  return { message: 'Upload URL generated', data: result };
}

/**
 * Removes a rejected upload's object. The pending row stays until it expires: the presigned URL is still
 * valid, a re-PUT could land, and only the row lets the hourly sweep find that object too.
 */
async function discardRejectedUpload(c: Ctx, key: string): Promise<void> {
  await deleteObject(c.env, key).catch((err) => console.warn(`Failed to delete rejected R2 object ${key}: ${err}`));
}

const NOT_AN_IMAGE = 'Uploaded file is not a JPEG, PNG, GIF or WebP image';

export async function confirmUpload(c: Ctx, dto: ConfirmInput, userId: string) {
  if (!isManagedKey(dto.key)) throw badRequest('Invalid storage key');

  // Bound to the user the URL was issued to: otherwise any media:create holder could register a row
  // for any object in the bucket.
  const db = getDb(c);
  const pending = await db.pending_media_uploads.findFirst({ where: { key: dto.key } });
  if (!pending) throw notFound('No pending upload for that key — request a new upload URL');
  if (pending.requested_by !== userId) throw forbidden('Upload key was issued to a different user');
  if (pending.expires_at < new Date()) throw new ApiError(410, 'Upload URL has expired — request a new one');

  const head = await headObject(c.env, dto.key).catch((err) => {
    console.warn(`HeadObject failed for ${dto.key}: ${err}`);
    return null;
  });
  if (!head) throw badRequest('File not found in storage — upload the file before confirming');

  // The stored Content-Type is what the CDN serves, so it must be an allowed image type whatever the
  // client declared; anything with bucket access could have written another.
  const actualMime = head.contentType;
  if (!actualMime || !ALLOWED_IMAGE_MIMES.has(actualMime)) {
    await discardRejectedUpload(c, dto.key);
    throw badRequest(`Stored object type "${actualMime ?? 'unknown'}" is not an allowed image type`);
  }
  const actualSize = head.contentLength ?? dto.file_size;

  const maxBytes = maxBytesFor(actualMime);
  if (actualSize > maxBytes) {
    await discardRejectedUpload(c, dto.key);
    throw new ApiError(413, `File exceeds the ${Math.round(maxBytes / 1024 / 1024)} MB limit for ${actualMime}`);
  }

  // The bytes are the truth: an HTML / SVG payload labelled image/png must never become a media row
  // served from the CDN. The same read carries the header, so the row gets the file's real size.
  // An empty object has no range to read (Nest answered it with a 500).
  const prefix = actualSize > 0 ? await getObjectPrefix(c.env, dto.key, UPLOAD_HEADER_PROBE_BYTES).catch(() => new Uint8Array()) : new Uint8Array();
  const sniffed = sniffImageMime(prefix);
  if (!sniffed) {
    await discardRejectedUpload(c, dto.key);
    throw badRequest(NOT_AN_IMAGE);
  }
  // A PNG stored as image/jpeg would be served with the wrong type (Nest stored the label as is).
  if (sniffed !== actualMime) {
    await discardRejectedUpload(c, dto.key);
    throw badRequest(`Stored object type "${actualMime}" does not match the file, which is ${sniffed}`);
  }
  const probed = parseImageHeader(prefix);

  // A new-format key carries the planned media id, so originals and variants share one folder.
  const plannedMediaId = mediaIdFromKey(dto.key) ?? undefined;
  const media = await db.$transaction(async (tx) => {
    const created = await tx.media.create({
      data: {
        ...(plannedMediaId ? { id: plannedMediaId } : {}),
        filename: dto.filename,
        alt_text: dto.alt_text ?? null,
        url: publicUrlForKey(c.env, dto.key),
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

  // Variants after the response: clients poll GET /media/:id until variants_status leaves "processing".
  defer(
    c,
    processMedia(c, media, dto.key).catch((err) => console.warn(`Background variant generation failed for ${media.id}: ${err}`)),
  );

  audit(c, {
    actorId: userId,
    action: AUDIT_ACTIONS.MEDIA_CREATED,
    resourceType: 'media',
    resourceId: media.id,
    changes: { method: 'POST', path: '/api/v1/media/confirm', variants_generated: 'pending' },
  });

  return { message: 'Media created', data: withVariants(media, []) };
}

/** Re-runs the variant pass; answers 200 with `variants_status` explaining a no-variants result. */
export async function regenerateVariants(c: Ctx, id: string, actorId: string) {
  const media = await getDb(c).media.findUnique({ where: { id } });
  if (!media) throw notFound('Media not found');

  const pass = await processMedia(c, media, keyFromPublicUrl(c.env, media.url));
  // Read back: rows from earlier runs still count, and a partial run must not hide them.
  const variants = await findForMedia(c, id);
  const data = withVariants({ ...media, ...pass.mediaPatch }, variants, pass.outcome);

  audit(c, {
    actorId,
    action: AUDIT_ACTIONS.MEDIA_VARIANTS_REGENERATED,
    resourceType: 'media',
    resourceId: id,
    changes: { method: 'POST', path: `/api/v1/media/${id}/regenerate-variants`, variants_generated: pass.variants.length, variants_status: data.variants_status },
  });

  return { message: 'Variants regenerated', data };
}

export async function findAll(c: Ctx, query: { page?: number; limit?: number; search?: string; mime_type?: string }) {
  const { page, limit, skip } = resolvePagination(query);
  const where: Prisma.mediaWhereInput = {};
  if (query.mime_type) where.mime_type = query.mime_type;
  if (query.search) {
    where.OR = [{ filename: { contains: query.search, mode: 'insensitive' } }, { alt_text: { contains: query.search, mode: 'insensitive' } }];
  }

  const db = getDb(c);
  const [items, total] = await Promise.all([
    db.media.findMany({ where, orderBy: [{ created_at: 'desc' }, { id: 'asc' }], skip, take: limit }),
    db.media.count({ where }),
  ]);
  const variants = await findForMediaIds(c, items.map((m) => m.id));
  return {
    message: 'Media fetched',
    data: { items: items.map((m) => withVariants(m, variants.get(m.id) ?? [])), pagination: buildPaginationMeta(page, limit, total) },
  };
}

export async function findOne(c: Ctx, id: string) {
  const media = await getDb(c).media.findUnique({ where: { id } });
  if (!media) throw notFound('Media not found');
  return { message: 'Media fetched', data: withVariants(media, await findForMedia(c, id)) };
}

export async function update(c: Ctx, id: string, dto: UpdateMediaInput, userId: string) {
  const db = getDb(c);
  const media = await db.media.findUnique({ where: { id } });
  if (!media) throw notFound('Media not found');

  const data: Prisma.mediaUpdateInput = {};
  if (dto.alt_text !== undefined) data.alt_text = dto.alt_text;
  if (dto.filename !== undefined) data.filename = dto.filename as string;
  const updated = await db.media.update({ where: { id }, data });

  audit(c, { actorId: userId, action: AUDIT_ACTIONS.MEDIA_UPDATED, resourceType: 'media', resourceId: id, changes: { method: 'PATCH', path: `/api/v1/media/${id}` } });

  return { message: 'Media updated', data: updated };
}

/** Everything that still points at this media, trashed parents included (their FKs still hold it). */
export async function findReferences(c: Ctx, id: string) {
  const db = getDb(c);
  const media = await db.media.findUnique({ where: { id }, select: { id: true } });
  if (!media) throw notFound('Media not found');
  const { total, items } = await listReferences(db, id);
  return { message: 'Media references fetched', data: { media_id: id, total, shown: items.length, truncated: total > items.length, items } };
}

export async function remove(c: Ctx, id: string, userId: string) {
  const db = getDb(c);
  const media = await db.media.findUnique({ where: { id } });
  if (!media) throw notFound('Media not found');

  // Every FK into media counts, from trashed parents too: a delete must never silently null a
  // record's cover or og:image (SET NULL) or hit a RESTRICT.
  if ((await countReferences(db, id)) > 0) throw await mediaInUse(db, id);

  // DB first, storage last. The check above is not authoritative: the recheck and the delete share a
  // transaction, so a reference added meanwhile wins and the row survives. Only once the row is gone is
  // R2 touched, so that race can never leave a live reference pointing at a 404.
  const stillReferenced = await db.$transaction(async (tx) => {
    if ((await countReferences(tx, id)) > 0) return true;
    await tx.media.delete({ where: { id } });
    return false;
  });
  if (stillReferenced) throw await mediaInUse(db, id);

  audit(c, { actorId: userId, action: AUDIT_ACTIONS.MEDIA_DELETED, resourceType: 'media', resourceId: id, changes: { method: 'DELETE', path: `/api/v1/media/${id}` } });

  // Best effort now: a failure orphans a blob nothing references, logged for cleanup; the delete succeeded.
  const failed = await deleteStoredFiles(c, id, media.url);
  if (failed.length > 0) console.error(`Media ${id} deleted, but R2 cleanup failed for ${failed.join(', ')} — orphaned blob(s)`);

  return { message: 'Media deleted', data: null };
}

async function deleteStoredFiles(c: Ctx, id: string, url: string): Promise<string[]> {
  const failed = await deleteR2Variants(c, id);
  if (failed.length > 0) return failed;
  const key = keyFromPublicUrl(c.env, url);
  try {
    await deleteObject(c.env, key);
  } catch (err) {
    console.warn(`R2 delete failed for ${key}: ${err}`);
    return [key];
  }
  return [];
}

async function countReferences(db: Db, id: string): Promise<number> {
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

/** One source: capped rows, and the real total only when the cap was hit. */
async function collect<Row>(rows: Promise<Row[]>, count: () => Promise<number>, toReference: (row: Row) => MediaReference): Promise<ReferenceList> {
  const found = await rows;
  const total = found.length < MEDIA_REFERENCE_LIMIT ? found.length : await count();
  return { total, items: found.map(toReference) };
}

async function listReferences(db: Db, id: string): Promise<ReferenceList> {
  const take = MEDIA_REFERENCE_LIMIT;
  const trashed = (row: { deleted_at: Date | null }) => row.deleted_at !== null;

  const sources = await Promise.all([
    collect(
      db.posts.findMany({ where: { cover_image_id: id }, select: { id: true, deleted_at: true }, orderBy: { id: 'asc' }, take }),
      () => db.posts.count({ where: { cover_image_id: id } }),
      (r): MediaReference => ({ type: 'post', id: r.id, field: 'cover_image', trashed: trashed(r) }),
    ),
    collect(
      db.post_attachments.findMany({ where: { media_id: id }, select: { post_id: true, posts: { select: { deleted_at: true } } }, orderBy: { post_id: 'asc' }, take }),
      () => db.post_attachments.count({ where: { media_id: id } }),
      (r): MediaReference => ({ type: 'post', id: r.post_id, field: 'attachment', trashed: trashed(r.posts) }),
    ),
    collect(
      db.post_translations.findMany({
        where: { og_image_id: id },
        select: { post_id: true, lang: true, posts: { select: { deleted_at: true } } },
        orderBy: [{ post_id: 'asc' }, { lang: 'asc' }],
        take,
      }),
      () => db.post_translations.count({ where: { og_image_id: id } }),
      (r): MediaReference => ({ type: 'post', id: r.post_id, field: 'og_image', lang: r.lang, trashed: trashed(r.posts) }),
    ),
    collect(
      db.books.findMany({ where: { cover_image_id: id }, select: { id: true, deleted_at: true }, orderBy: { id: 'asc' }, take }),
      () => db.books.count({ where: { cover_image_id: id } }),
      (r): MediaReference => ({ type: 'book', id: r.id, field: 'cover_image', trashed: trashed(r) }),
    ),
    collect(
      db.book_translations.findMany({
        where: { og_image_id: id },
        select: { book_id: true, lang: true, books: { select: { deleted_at: true } } },
        orderBy: [{ book_id: 'asc' }, { lang: 'asc' }],
        take,
      }),
      () => db.book_translations.count({ where: { og_image_id: id } }),
      (r): MediaReference => ({ type: 'book', id: r.book_id, field: 'og_image', lang: r.lang, trashed: trashed(r.books) }),
    ),
    collect(
      db.static_page_translations.findMany({
        where: { og_image_id: id },
        select: { page_id: true, lang: true, static_pages: { select: { deleted_at: true } } },
        orderBy: [{ page_id: 'asc' }, { lang: 'asc' }],
        take,
      }),
      () => db.static_page_translations.count({ where: { og_image_id: id } }),
      (r): MediaReference => ({ type: 'static_page', id: r.page_id, field: 'og_image', lang: r.lang, trashed: trashed(r.static_pages) }),
    ),
    // A gallery item's primary key IS the media id.
    collect(
      db.gallery_images.findMany({ where: { media_id: id }, select: { media_id: true, deleted_at: true }, take }),
      () => db.gallery_images.count({ where: { media_id: id } }),
      (r): MediaReference => ({ type: 'gallery_image', id: r.media_id, field: 'gallery_item', trashed: trashed(r) }),
    ),
    collect(
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

  return { total: sources.reduce((sum, s) => sum + s.total, 0), items: sources.flatMap((s) => s.items).slice(0, MEDIA_REFERENCE_LIMIT) };
}

/** The 409 for a media still in use: the message names the first few records; the full list is one GET away. */
async function mediaInUse(db: Db, id: string): Promise<ApiError> {
  const { total, items } = await listReferences(db, id);
  const shown = items.slice(0, REFERENCES_IN_MESSAGE).map((r) => {
    const where = r.lang ? `${r.type} ${r.id} (${r.field}, ${r.lang})` : `${r.type} ${r.id} (${r.field})`;
    return r.trashed ? `${where}, in the trash` : where;
  });
  const more = total > shown.length ? `, and ${total - shown.length} more` : '';
  const hints = ['Detach the image from those records first; a record in the trash still holds its reference until the image is changed on the record itself.'];
  if (items.some((r) => r.type === 'gallery_image' && r.field === 'gallery_item')) {
    hints.push('A gallery item uses the media id as its own id, so this file IS that gallery item: delete the gallery item first.');
  }
  return conflict(
    `Media is still referenced by ${total} record${total === 1 ? '' : 's'}` + (shown.length > 0 ? ` (${shown.join('; ')}${more})` : '') + `. ${hints.join(' ')} Full list: GET /media/${id}/references`,
    { code: 'MEDIA_IN_USE' },
  );
}
