/**
 * Pure rules for "what variants should this original have, and where is it in
 * getting them". Kept free of Prisma / sharp / R2 so every response shaper and
 * the variant pipeline agree on one definition, and so the rules are unit-testable
 * without a database.
 *
 * Nothing here is persisted: the status is derived from the media row plus its
 * `media_variants` rows at read time (no extra column), with an optional outcome
 * from a pass that just ran (regenerate) overriding the guesswork.
 */

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

/**
 * How long a row with missing variants is still considered "being generated".
 * Background generation normally lands in 1-3 s; past this the variants are
 * not coming on their own and the client should stop waiting.
 */
export const VARIANT_PROCESSING_WINDOW_MS = 2 * 60 * 1000;

/** The only image types uploads may carry — every other stored mime is non-raster for our purposes. */
const RASTER_MIMES: ReadonlySet<string> = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

export type VariantsStatus = 'ready' | 'processing' | 'partial' | 'unavailable' | 'not_applicable';

export type VariantsStatusReason =
  | 'ORIGINAL_MISSING'
  | 'TOO_SMALL'
  | 'ANIMATED'
  | 'NON_RASTER'
  | 'UNREADABLE'
  | 'GENERATION_INCOMPLETE';

/** What a variant pass (confirm's background job, regenerate) found out about the original. */
export type VariantPassOutcome =
  | 'ok'
  | 'original_missing'
  | 'unreadable'
  | 'animated'
  | 'non_raster'
  | 'error';

export interface VariantInfo {
  /** Widths the pipeline produces for THIS original (never wider than the original itself). */
  planned_widths: number[];
  variants_status: VariantsStatus;
  variants_status_reason?: VariantsStatusReason;
}

/** Widths the pipeline generates for an original `width` px wide — up-scaling is never planned. */
export function plannedWidthsFor(width: number): number[] {
  return VARIANT_WIDTHS.filter((w) => w < width);
}

interface OrientableMetadata {
  width?: number;
  height?: number;
  orientation?: number;
  autoOrient?: { width?: number; height?: number };
}

/**
 * The size the image is DISPLAYED at. sharp's `width` / `height` are the stored
 * raster, before the EXIF orientation is applied, so a phone photo taken in
 * portrait is stored landscape with orientation 6 or 8 and must be swapped.
 */
export function orientedSize(meta: OrientableMetadata): { width: number; height: number } | null {
  const auto = meta.autoOrient;
  if (auto && typeof auto.width === 'number' && typeof auto.height === 'number' && auto.width > 0 && auto.height > 0) {
    return { width: auto.width, height: auto.height };
  }
  const { width, height, orientation } = meta;
  if (typeof width !== 'number' || typeof height !== 'number' || width <= 0 || height <= 0) return null;
  // EXIF orientations 5-8 are the quarter-turn ones.
  return typeof orientation === 'number' && orientation >= 5 && orientation <= 8
    ? { width: height, height: width }
    : { width, height };
}

/**
 * Derive `planned_widths` / `variants_status` for one media row.
 *
 *  - ready:          every planned width has a variant
 *  - processing:     some are missing and the row is younger than the processing window
 *  - partial:        some are missing and the window has passed (failed generation, or an
 *                    original that is missing from storage — regenerate tells them apart)
 *  - unavailable:    the original is smaller than the smallest width (TOO_SMALL), or a pass
 *                    found it missing / undecodable
 *  - not_applicable: animated or non-raster — the original is the only rendition
 *
 * Whether a GIF is animated is not stored anywhere, so a GIF with no variants past the
 * processing window is inferred to be animated (a static GIF over 320 px always gets
 * variants); the regenerate route reports the exact answer.
 */
export function describeVariants(
  media: { mime_type: string; width: number | null; created_at: Date | string },
  variants: ReadonlyArray<{ width: number }>,
  opts: { now?: number; outcome?: VariantPassOutcome } = {},
): VariantInfo {
  const { outcome } = opts;
  const have = [...new Set(variants.map((v) => v.width))].sort((a, b) => a - b);
  const knownWidth = typeof media.width === 'number' && media.width > 0;

  if (!RASTER_MIMES.has(media.mime_type) || outcome === 'non_raster') {
    return { planned_widths: [], variants_status: 'not_applicable', variants_status_reason: 'NON_RASTER' };
  }
  if (outcome === 'animated') {
    return { planned_widths: [], variants_status: 'not_applicable', variants_status_reason: 'ANIMATED' };
  }

  // A row whose stored width is unknown has no plan of its own: the variants that
  // exist are the only evidence of what was producible. Otherwise the planned set is
  // widened by any variant that exists, so a stale width can never make a complete
  // set look partial.
  let planned: number[];
  if (knownWidth) {
    planned = [...new Set([...plannedWidthsFor(media.width as number), ...have])].sort((a, b) => a - b);
  } else {
    planned = have.length > 0 ? have : [...VARIANT_WIDTHS];
  }

  if (outcome === 'original_missing') {
    return { planned_widths: planned, variants_status: 'unavailable', variants_status_reason: 'ORIGINAL_MISSING' };
  }
  if (outcome === 'unreadable') {
    return { planned_widths: planned, variants_status: 'unavailable', variants_status_reason: 'UNREADABLE' };
  }
  if (planned.length === 0) {
    return { planned_widths: [], variants_status: 'unavailable', variants_status_reason: 'TOO_SMALL' };
  }
  if (planned.every((w) => have.includes(w))) {
    return { planned_widths: planned, variants_status: 'ready' };
  }

  const created = new Date(media.created_at).getTime();
  const age = (opts.now ?? Date.now()) - created;
  const stillProcessing = outcome === undefined && Number.isFinite(created) && age < VARIANT_PROCESSING_WINDOW_MS;
  if (stillProcessing) return { planned_widths: planned, variants_status: 'processing' };

  if (outcome === undefined && media.mime_type === 'image/gif' && have.length === 0) {
    return { planned_widths: [], variants_status: 'not_applicable', variants_status_reason: 'ANIMATED' };
  }
  return { planned_widths: planned, variants_status: 'partial', variants_status_reason: 'GENERATION_INCOMPLETE' };
}
