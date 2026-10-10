// src/media/image-variant.service.ts on the Images binding: Cloudflare's transformations apply the EXIF
// orientation themselves (sharp's `.rotate()`), and their WebP / PNG output carries no metadata.
import type { Context } from 'hono';
import { getDb } from '../../lib/db';
import { parseImageHeader, type ImageHeader } from '../../lib/image-header';
import { plannedWidthsFor, VARIANT_WIDTHS, type VariantPassOutcome } from '../../lib/media-variants';
import { deleteObject, getObjectBytes, headObject, putObject, variantKey } from '../../lib/r2';
import type { AppEnv } from '../../lib/types';

type Ctx = Context<AppEnv>;

const VARIANT_QUALITY = 82;
/** The clean copy replaces the only full-resolution original, so it is encoded high. */
const ORIGINAL_REENCODE_QUALITY = 92;

const OUTPUT_MIME = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' } as const;

export interface VariantRow {
  id: string;
  media_id: string;
  width: number;
  url: string;
  file_size: bigint;
  format: string;
  created_at: Date;
}

export interface VariantPassResult {
  outcome: VariantPassOutcome;
  /** Rows written by this pass. */
  variants: VariantRow[];
  /** Corrections this pass persisted on the media row (only fields that changed). */
  mediaPatch: { width?: number; height?: number; file_size?: bigint };
  /** The original was rewritten without its EXIF / XMP / IPTC. */
  sanitized: boolean;
}

const streamOf = (bytes: Uint8Array) => new Blob([bytes]).stream();

/**
 * One pass over an original: correct the row's width / height to the displayed size, write the WebP
 * variants (never wider than the image; none for an animated one), then, unless told not to, replace
 * an original carrying EXIF / XMP / IPTC (GPS, device serials) with a clean copy. Never throws for a
 * bad image or a storage hiccup: the outcome says what happened.
 */
export async function processMedia(
  c: Ctx,
  media: { id: string; width?: number | null; height?: number | null },
  originalKey: string,
  options: { sanitizeOriginal?: boolean } = {},
): Promise<VariantPassResult> {
  const result: VariantPassResult = { outcome: 'ok', variants: [], mediaPatch: {}, sanitized: false };

  let original: Uint8Array | null;
  try {
    original = await getObjectBytes(c.env, originalKey);
  } catch (err) {
    console.warn(`Could not fetch original ${originalKey} for variant generation: ${err}`);
    return { ...result, outcome: 'error' };
  }
  if (!original) {
    console.warn(`Original ${originalKey} is not in storage`);
    return { ...result, outcome: 'original_missing' };
  }

  const header = parseImageHeader(original);
  if (!header) return { ...result, outcome: 'unreadable' };

  // The client's width / height are not trusted: EXIF-rotated photos arrive with the stored raster size.
  await reconcileDimensions(c, media, header, result);

  // A static first frame would replace the animation wherever the site prefers variants.
  if (header.animated) return { ...result, outcome: 'animated' };

  result.variants = await writeVariants(c, media.id, original, plannedWidthsFor(header.width));

  // After the variants: the editor is waiting on those.
  if (options.sanitizeOriginal !== false) {
    const cleanedBytes = await sanitizeOriginal(c, media.id, originalKey, original, header);
    if (cleanedBytes !== null) {
      result.sanitized = true;
      result.mediaPatch.file_size = BigInt(cleanedBytes);
    }
  }
  return result;
}

export function findForMedia(c: Ctx, mediaId: string): Promise<VariantRow[]> {
  return getDb(c).media_variants.findMany({ where: { media_id: mediaId }, orderBy: { width: 'asc' } });
}

export async function findForMediaIds(c: Ctx, mediaIds: string[]): Promise<Map<string, VariantRow[]>> {
  const map = new Map<string, VariantRow[]>();
  if (mediaIds.length === 0) return map;
  const rows = await getDb(c).media_variants.findMany({ where: { media_id: { in: mediaIds } }, orderBy: [{ media_id: 'asc' }, { width: 'asc' }] });
  for (const r of rows) map.set(r.media_id, [...(map.get(r.media_id) ?? []), r]);
  return map;
}

/** Deletes every variant object (the rows cascade with the media row). Returns the keys that failed. */
export async function deleteR2Variants(c: Ctx, mediaId: string): Promise<string[]> {
  const failed: string[] = [];
  await Promise.all(
    VARIANT_WIDTHS.map(async (width) => {
      const key = variantKey(mediaId, width);
      try {
        await deleteObject(c.env, key);
      } catch (err) {
        console.warn(`Variant delete failed for ${mediaId} w${width}: ${err}`);
        failed.push(key);
      }
    }),
  );
  return failed;
}

async function reconcileDimensions(c: Ctx, media: { id: string; width?: number | null; height?: number | null }, size: ImageHeader, result: VariantPassResult) {
  const patch: { width?: number; height?: number } = {};
  if (media.width !== size.width) patch.width = size.width;
  if (media.height !== size.height) patch.height = size.height;
  if (Object.keys(patch).length === 0) return;
  try {
    // updateMany: a row deleted while the pass ran is a no-op, not a P2025.
    await getDb(c).media.updateMany({ where: { id: media.id }, data: patch });
    Object.assign(result.mediaPatch, patch);
  } catch (err) {
    console.warn(`Could not reconcile dimensions for media ${media.id}: ${err}`);
  }
}

async function writeVariants(c: Ctx, mediaId: string, original: Uint8Array, widths: number[]): Promise<VariantRow[]> {
  const results = await Promise.allSettled(
    widths.map(async (width) => {
      const out = await c.env.IMAGES.input(streamOf(original))
        .transform({ width, fit: 'scale-down' })
        .output({ format: 'image/webp', quality: VARIANT_QUALITY });
      const bytes = new Uint8Array(await out.response().arrayBuffer());
      const url = await putObject(c.env, variantKey(mediaId, width), bytes, 'image/webp');
      return getDb(c).media_variants.upsert({
        where: { media_id_width: { media_id: mediaId, width } },
        create: { media_id: mediaId, width, url, file_size: bytes.length, format: 'webp' },
        update: { url, file_size: bytes.length, format: 'webp' },
      });
    }),
  );
  const rows: VariantRow[] = [];
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') rows.push(r.value);
    else console.warn(`Variant ${widths[i]}px failed for media ${mediaId}: ${r.reason}`);
  });
  return rows;
}

/**
 * Overwrites the original with a copy without EXIF / XMP / IPTC, in the same format and Content-Type,
 * orientation baked in. Returns the new size when the copy was written AND the row's file_size was
 * updated, else null. GIFs carry no camera metadata (and would be re-quantised); a CMYK JPEG would
 * shift in colour. The copy must prove it is the same picture minus the metadata before it replaces
 * the only full-resolution copy; a JPEG whose EXIF holds a copyright tag keeps it (Cloudflare's
 * default) and so stays untouched.
 */
async function sanitizeOriginal(c: Ctx, mediaId: string, originalKey: string, original: Uint8Array, header: ImageHeader): Promise<number | null> {
  if (!header.hasMetadata || header.format === 'gif' || header.cmyk) return null;
  try {
    const out = await c.env.IMAGES.input(streamOf(original)).output({ format: OUTPUT_MIME[header.format], quality: ORIGINAL_REENCODE_QUALITY });
    const cleaned = new Uint8Array(await out.response().arrayBuffer());

    const check = parseImageHeader(cleaned);
    if (!check || check.hasMetadata || check.width !== header.width || check.height !== header.height) {
      console.warn(`Sanitised copy of ${originalKey} failed verification; original left untouched`);
      return null;
    }

    const head = await headObject(c.env, originalKey);
    if (!head?.contentType) {
      console.warn(`Could not read headers of ${originalKey}; original left untouched`);
      return null;
    }
    await putObject(c.env, originalKey, cleaned, head.contentType, head.cacheControl);

    // Only a size that reached the row is reported (Nest reported it either way).
    try {
      await getDb(c).media.updateMany({ where: { id: mediaId }, data: { file_size: cleaned.length } });
    } catch (err) {
      console.warn(`Original of media ${mediaId} was sanitised but file_size was not updated: ${err}`);
      return null;
    }
    return cleaned.length;
  } catch (err) {
    console.warn(`Could not sanitise original ${originalKey}; left untouched: ${err}`);
    return null;
  }
}
