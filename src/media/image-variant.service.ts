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
   *
   * Implementation note: `prisma.media_variants` is not yet present on the
   * generated client (the user runs `prisma:pull` after applying the SQL
   * migration). We use raw queries here so this code compiles before
   * regeneration. Once the typed model is available, both calls can be
   * refactored to `this.prisma.media_variants.create(...)`.
   */
  async generateForMedia(mediaId: string, originalKey: string): Promise<VariantRow[]> {
    const original = await this.r2.getObjectBuffer(originalKey).catch((err) => {
      this.logger.warn(`Could not fetch original ${originalKey} for variant generation: ${err}`);
      return null;
    });
    if (!original) return [];

    let metadata: sharp.Metadata;
    try {
      metadata = await sharp(original).metadata();
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
        const buffer = await sharp(original)
          .resize({ width, withoutEnlargement: true })
          .webp({ quality: VARIANT_QUALITY })
          .toBuffer();

        const key = this.r2.variantKey(mediaId, width);
        const url = await this.r2.putObjectBuffer(key, buffer, 'image/webp');

        // Insert via raw SQL (see class doc-block).
        await this.prisma.$executeRaw`
          INSERT INTO media_variants (media_id, width, url, file_size, format)
          VALUES (${mediaId}::uuid, ${width}, ${url}, ${buffer.length}::bigint, 'webp')
          ON CONFLICT (media_id, width) DO UPDATE
            SET url = EXCLUDED.url,
                file_size = EXCLUDED.file_size,
                format = EXCLUDED.format
        `;

        return { width, url, fileSize: buffer.length };
      }),
    );

    const rows: VariantRow[] = [];
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (r.status === 'fulfilled') {
        rows.push({
          id: '',
          width: r.value.width,
          url: r.value.url,
          file_size: BigInt(r.value.fileSize),
          format: 'webp',
        });
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
    return this.prisma.$queryRaw<VariantRow[]>`
      SELECT id::text AS id, width, url, file_size, format
      FROM media_variants
      WHERE media_id = ${mediaId}::uuid
      ORDER BY width ASC
    `;
  }

  /** Read variants for a batch of media ids in one query. */
  async findForMediaIds(mediaIds: string[]): Promise<Map<string, VariantRow[]>> {
    const map = new Map<string, VariantRow[]>();
    if (mediaIds.length === 0) return map;
    const rows = await this.prisma.$queryRaw<Array<VariantRow & { media_id: string }>>`
      SELECT id::text AS id, media_id::text AS media_id, width, url, file_size, format
      FROM media_variants
      WHERE media_id = ANY(${mediaIds}::uuid[])
      ORDER BY media_id, width ASC
    `;
    for (const r of rows) {
      const list = map.get(r.media_id) ?? [];
      const { media_id: _omit, ...rest } = r;
      list.push(rest);
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
