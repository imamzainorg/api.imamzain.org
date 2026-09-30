import { Injectable, Logger } from '@nestjs/common';
import sharp from 'sharp';
import { PrismaService } from '../prisma/prisma.service';
import { isStorageNotFound, R2Service } from '../storage/r2.service';
import { orientedSize, plannedWidthsFor, VARIANT_WIDTHS, VariantPassOutcome } from './media-variants.util';

// Re-exported so existing importers keep working; the rules now live in media-variants.util.
export { VARIANT_WIDTHS };

const VARIANT_QUALITY = 82;

/**
 * Quality of the metadata-stripped re-encode that replaces an original. High,
 * because it overwrites the only full-resolution copy of the image.
 */
const ORIGINAL_REENCODE_QUALITY = 92;

/**
 * Hard ceiling on input pixel count for sharp. Default is ~268 MP, which
 * is high enough that a malicious 30000×30000 PNG (~3.6 GB decoded) would
 * decode and OOM the dyno before failing. 50 MP comfortably handles every
 * realistic camera output (current pro mirrorless tops out near 60 MP)
 * while bounding worst-case memory.
 */
const SHARP_LIMIT_INPUT_PIXELS = 50_000_000;

/** Decoder names (sharp `metadata().format`) of the four raster types uploads may carry. */
const RASTER_FORMATS: ReadonlySet<string> = new Set(['jpeg', 'png', 'webp', 'gif']);

type SharpInstance = ReturnType<typeof sharp>;

/**
 * Derived rather than written as `sharp.Metadata`. sharp 0.35 moved its
 * declarations to `dist/index.d.mts` / `.d.cts` behind an `exports` map, and
 * this project compiles with `module: commonjs` and no explicit
 * `moduleResolution`, so TypeScript falls back to node10 resolution — which
 * ignores `exports` and cannot read the `.d.mts` the `types` field points at.
 * Naming the namespace therefore resolves only against a stale `lib/index.d.ts`
 * left behind by an in-place upgrade, and breaks on a clean `npm ci`.
 * Reading the type off the method keeps this correct however sharp ships it.
 */
type SharpMetadata = Awaited<ReturnType<SharpInstance['metadata']>>;

export interface VariantRow {
  id: string;
  width: number;
  url: string;
  file_size: bigint;
  format: string;
}

export interface VariantPassResult {
  outcome: VariantPassOutcome;
  /** Rows written by THIS pass (not the rows that already existed). */
  variants: VariantRow[];
  /** Corrections this pass already persisted on the media row (only fields that changed). */
  mediaPatch: { width?: number; height?: number; file_size?: bigint };
  /** True when the original was rewritten without its EXIF / XMP / IPTC metadata. */
  sanitized: boolean;
}

@Injectable()
export class ImageVariantService {
  private readonly logger = new Logger(ImageVariantService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly r2: R2Service,
  ) {}

  /**
   * Generate WebP variants for an uploaded image and persist `media_variants`
   * rows. Failures are logged but do not throw — the original media row is
   * still useful even when variants are missing, and the editor can call the
   * regenerate endpoint later. Returns the rows this run wrote.
   *
   * Kept for prisma/backfill-media-variants.ts, which only wants the rows: it
   * reconciles the stored dimensions (DB only) but never rewrites originals in
   * the bucket — that is a decision for an operator, not a side effect of a backfill.
   */
  async generateForMedia(mediaId: string, originalKey: string): Promise<VariantRow[]> {
    const pass = await this.processMedia({ id: mediaId }, originalKey, { sanitizeOriginal: false });
    return pass.variants;
  }

  /**
   * One decode-once pass over an original:
   *  - reads the true, orientation-aware size and corrects the media row when the
   *    client-declared width/height disagree with it;
   *  - writes the WebP variants (never wider than the real image; none for
   *    animated or non-raster files);
   *  - unless `sanitizeOriginal` is false, rewrites the ORIGINAL without its EXIF /
   *    XMP / IPTC metadata (GPS, device serials) — only when it carries any, in the
   *    same format, orientation baked in, ICC profile kept, same Content-Type and
   *    Cache-Control. If that fails for any reason the original is left untouched.
   *
   * Never throws for a bad image or a storage hiccup: the outcome says what happened.
   */
  async processMedia(
    media: { id: string; width?: number | null; height?: number | null },
    originalKey: string,
    options: { sanitizeOriginal?: boolean } = {},
  ): Promise<VariantPassResult> {
    const result: VariantPassResult = { outcome: 'ok', variants: [], mediaPatch: {}, sanitized: false };

    let original: Buffer;
    try {
      original = await this.r2.getObjectBuffer(originalKey);
    } catch (err) {
      const missing = isStorageNotFound(err);
      this.logger.warn(`Could not fetch original ${originalKey} for variant generation: ${err}`);
      return { ...result, outcome: missing ? 'original_missing' : 'error' };
    }

    let metadata: SharpMetadata;
    try {
      metadata = await sharp(original, { limitInputPixels: SHARP_LIMIT_INPUT_PIXELS }).metadata();
    } catch (err) {
      this.logger.warn(`sharp.metadata failed for ${originalKey}: ${err}`);
      return { ...result, outcome: 'unreadable' };
    }
    if (!RASTER_FORMATS.has(metadata.format)) return { ...result, outcome: 'non_raster' };

    const size = orientedSize(metadata);
    if (!size) return { ...result, outcome: 'unreadable' };

    // The client declares width/height at confirm and is not trusted: EXIF-rotated
    // photos arrive with the stored (sideways) raster size. Fix the row first so a
    // client polling the variants sees a plan that matches the file.
    await this.reconcileDimensions(media, size, result);

    if ((metadata.pages ?? 1) > 1) {
      // Animated GIF / WebP: a static first-frame WebP would replace the animation
      // wherever the front end prefers variants, so the original is the only rendition.
      return { ...result, outcome: 'animated' };
    }

    // One shared instance — the original is decoded once per output and each width
    // clones the pipeline. .rotate() applies the EXIF orientation tag then strips it,
    // so sideways phone photos come out the right way up in every variant.
    const base = sharp(original, { limitInputPixels: SHARP_LIMIT_INPUT_PIXELS }).rotate();

    result.variants = await this.writeVariants(media.id, base, plannedWidthsFor(size.width));

    // After the variants, not beside them: the editor is waiting on those, and a
    // full-resolution re-encode running alongside four resizes would add a fifth
    // concurrent decode to a pass the caller's gate sizes for four.
    const cleanedBytes =
      options.sanitizeOriginal === false ? null : await this.sanitizeOriginal(media.id, originalKey, base, metadata, size);
    if (cleanedBytes !== null) {
      result.sanitized = true;
      result.mediaPatch.file_size = BigInt(cleanedBytes);
    }
    return result;
  }

  /**
   * Size of the image as displayed, from the first bytes of the file alone (a
   * ranged read of the header). Lets confirm answer with the true dimensions
   * without downloading a 25 MB original. null when the header does not parse
   * from what was given — the background pass then corrects the row.
   */
  async probeDimensions(prefix: Buffer): Promise<{ width: number; height: number } | null> {
    try {
      // failOn 'none': the prefix is deliberately cut mid-file, which sharp would
      // otherwise report as a warning-level error even though the header is intact.
      const meta = await sharp(prefix, { limitInputPixels: SHARP_LIMIT_INPUT_PIXELS, failOn: 'none' }).metadata();
      return orientedSize(meta);
    } catch {
      return null;
    }
  }

  /** Read all variants for a media id. Used by media response shaping. */
  async findForMedia(mediaId: string): Promise<VariantRow[]> {
    return this.prisma.media_variants.findMany({
      where: { media_id: mediaId },
      orderBy: { width: 'asc' },
    });
  }

  /** Read variants for a batch of media ids in one query. */
  async findForMediaIds(mediaIds: string[]): Promise<Map<string, VariantRow[]>> {
    const map = new Map<string, VariantRow[]>();
    if (mediaIds.length === 0) return map;
    const rows = await this.prisma.media_variants.findMany({
      where: { media_id: { in: mediaIds } },
      orderBy: [{ media_id: 'asc' }, { width: 'asc' }],
    });
    for (const r of rows) {
      const list = map.get(r.media_id) ?? [];
      list.push(r);
      map.set(r.media_id, list);
    }
    return map;
  }

  /**
   * Delete all R2 variant blobs for a media row. The DB rows are removed via
   * ON DELETE CASCADE on the FK, so we only handle the storage side here.
   * A variant that is already gone counts as deleted; returns the keys whose
   * delete genuinely failed so the caller can refuse to drop the row.
   */
  async deleteR2Variants(mediaId: string): Promise<string[]> {
    const failed: string[] = [];
    await Promise.all(
      VARIANT_WIDTHS.map(async (width) => {
        const key = this.r2.variantKey(mediaId, width);
        try {
          await this.r2.deleteObject(key);
        } catch (err) {
          if (isStorageNotFound(err)) return;
          this.logger.warn(`Variant deleteObject failed for ${mediaId} w${width}: ${err}`);
          failed.push(key);
        }
      }),
    );
    return failed;
  }

  private async reconcileDimensions(
    media: { id: string; width?: number | null; height?: number | null },
    size: { width: number; height: number },
    result: VariantPassResult,
  ): Promise<void> {
    const patch: { width?: number; height?: number } = {};
    if (media.width !== size.width) patch.width = size.width;
    if (media.height !== size.height) patch.height = size.height;
    if (Object.keys(patch).length === 0) return;

    try {
      // updateMany: a row deleted while the pass ran is a no-op, not a P2025.
      await this.prisma.media.updateMany({ where: { id: media.id }, data: patch });
      Object.assign(result.mediaPatch, patch);
    } catch (err) {
      this.logger.warn(`Could not reconcile dimensions for media ${media.id}: ${err}`);
    }
  }

  private async writeVariants(mediaId: string, base: SharpInstance, widths: number[]): Promise<VariantRow[]> {
    const results = await Promise.allSettled(
      widths.map(async (width) => {
        const buffer = await base
          .clone()
          .resize({ width, withoutEnlargement: true })
          .webp({ quality: VARIANT_QUALITY })
          .toBuffer();

        const key = this.r2.variantKey(mediaId, width);
        const url = await this.r2.putObjectBuffer(key, buffer, 'image/webp');

        const row = await this.prisma.media_variants.upsert({
          where: { media_id_width: { media_id: mediaId, width } },
          create: { media_id: mediaId, width, url, file_size: buffer.length, format: 'webp' },
          update: { url, file_size: buffer.length, format: 'webp' },
        });

        return row;
      }),
    );

    const rows: VariantRow[] = [];
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (r.status === 'fulfilled') {
        rows.push(r.value);
      } else {
        this.logger.warn(`Variant ${widths[i]}px failed for media ${mediaId}: ${r.reason}`);
      }
    }
    return rows;
  }

  /**
   * Overwrite the original with a copy that has no EXIF / XMP / IPTC. Returns the
   * new byte size, or null when nothing was (or could safely be) rewritten.
   */
  private async sanitizeOriginal(
    mediaId: string,
    originalKey: string,
    base: SharpInstance,
    metadata: SharpMetadata,
    size: { width: number; height: number },
  ): Promise<number | null> {
    if (!metadata.exif && !metadata.xmp && !metadata.iptc) return null;
    // GIFs carry no camera metadata, and a palette re-quantise would only degrade them.
    // CMYK sources would change colour on a re-encode.
    if (metadata.format === 'gif' || metadata.space === 'cmyk') return null;

    try {
      const cleaned = await this.encodeLike(base.clone().keepIccProfile(), metadata.format)?.toBuffer();
      if (!cleaned) return null;

      // Prove the replacement is the same picture, minus the metadata, before it
      // overwrites the only full-resolution copy. Orientation is baked in by now,
      // so the stored size of the copy is the displayed size of the source.
      const check = await sharp(cleaned, { limitInputPixels: SHARP_LIMIT_INPUT_PIXELS }).metadata();
      const checked = orientedSize(check);
      if (check.exif || check.xmp || check.iptc || checked?.width !== size.width || checked?.height !== size.height) {
        this.logger.warn(`Sanitised copy of ${originalKey} failed verification; original left untouched`);
        return null;
      }

      // Same Content-Type and Cache-Control as the object being replaced.
      const head = await this.r2.headObject(originalKey);
      if (!head?.contentType) {
        this.logger.warn(`Could not read headers of ${originalKey}; original left untouched`);
        return null;
      }
      await this.r2.putObjectBuffer(originalKey, cleaned, head.contentType, head.cacheControl);

      try {
        await this.prisma.media.updateMany({ where: { id: mediaId }, data: { file_size: cleaned.length } });
      } catch (err) {
        this.logger.warn(`Original of media ${mediaId} was sanitised but file_size was not updated: ${err}`);
      }
      return cleaned.length;
    } catch (err) {
      this.logger.warn(`Could not sanitise original ${originalKey}; left untouched: ${err}`);
      return null;
    }
  }

  private encodeLike(pipeline: SharpInstance, format: string): SharpInstance | null {
    switch (format) {
      case 'jpeg':
        return pipeline.jpeg({ quality: ORIGINAL_REENCODE_QUALITY });
      case 'png':
        return pipeline.png();
      case 'webp':
        return pipeline.webp({ quality: ORIGINAL_REENCODE_QUALITY });
      default:
        return null;
    }
  }
}
