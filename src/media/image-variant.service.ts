import { Injectable, Logger } from '@nestjs/common';
import sharp from 'sharp';
import { PrismaService } from '../prisma/prisma.service';
import { R2Service } from '../storage/r2.service';

/**
 * Pre-generated responsive sizes (px width). The CMS picks among these via
 * `<img srcset>` instead of asking R2 / Cloudflare to transform on the fly.
 *
 * Why: Cloudflare Image Resizing's free tier is 5000 unique-transform-URLs
 * per month — each `image.png?w=768` counts as one. Pre-generating fixed
 * variants at upload time keeps that counter at zero forever; the only
 * cost is R2 storage, which the first 10 GB are free.
 */
export const VARIANT_WIDTHS = [320, 768, 1280, 1920] as const;
const VARIANT_QUALITY = 82;

/**
 * Hard ceiling on input pixel count for sharp. Default is ~268 MP, which
 * is high enough that a malicious 30000×30000 PNG (~3.6 GB decoded) would
 * decode and OOM the dyno before failing. 50 MP comfortably handles every
 * realistic camera output (current pro mirrorless tops out near 60 MP)
 * while bounding worst-case memory.
 */
const SHARP_LIMIT_INPUT_PIXELS = 50_000_000;

export interface VariantRow {
  id: string;
  width: number;
  url: string;
  file_size: bigint;
  format: string;
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
   * regenerate endpoint later.
   */
  async generateForMedia(mediaId: string, originalKey: string): Promise<VariantRow[]> {
    const original = await this.r2.getObjectBuffer(originalKey).catch((err) => {
      this.logger.warn(`Could not fetch original ${originalKey} for variant generation: ${err}`);
      return null;
    });
    if (!original) return [];

    let metadata: sharp.Metadata;
    try {
      metadata = await sharp(original, { limitInputPixels: SHARP_LIMIT_INPUT_PIXELS }).metadata();
    } catch (err) {
      this.logger.warn(`sharp.metadata failed for ${originalKey}: ${err}`);
      return [];
    }

    // Skip widths that would up-scale (variant width > original width). A
    // 480px-wide source has no business being served at 1920px.
    const sourceWidth = metadata.width ?? Infinity;
    const targetWidths = VARIANT_WIDTHS.filter((w) => w < sourceWidth);

    const results = await Promise.allSettled(
      targetWidths.map(async (width) => {
        // .rotate() applies the EXIF orientation tag then strips it, so
        // sideways phone photos come out the right way up in every variant.
        const buffer = await sharp(original, { limitInputPixels: SHARP_LIMIT_INPUT_PIXELS })
          .rotate()
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
        this.logger.warn(
          `Variant ${targetWidths[i]}px failed for media ${mediaId}: ${r.reason}`,
        );
      }
    }

    return rows;
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
   */
  async deleteR2Variants(mediaId: string): Promise<void> {
    await Promise.all(
      VARIANT_WIDTHS.map((width) =>
        this.r2.deleteObject(this.r2.variantKey(mediaId, width)).catch((err) => {
          // Best-effort: a missing variant is fine, log and continue.
          this.logger.debug(`Variant deleteObject skipped for ${mediaId} w${width}: ${err}`);
        }),
      ),
    );
  }
}
