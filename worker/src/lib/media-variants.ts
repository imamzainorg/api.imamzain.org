// What variants an original should have and where it is in getting them (src/media/media-variants.util.ts).
// Derived at read time from the media row and its media_variants rows; nothing is persisted.

/**
 * Pre-generated responsive widths: the CMS picks among them with `srcset` instead of on-the-fly
 * transforms, which keeps per-URL transformation billing at zero.
 */
export const VARIANT_WIDTHS = [320, 768, 1280, 1920] as const;

/** Background generation lands in seconds; past this window the variants are not coming on their own. */
export const VARIANT_PROCESSING_WINDOW_MS = 2 * 60 * 1000;

const RASTER_MIMES: ReadonlySet<string> = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

export type VariantsStatus = 'ready' | 'processing' | 'partial' | 'unavailable' | 'not_applicable';

export type VariantsStatusReason = 'ORIGINAL_MISSING' | 'TOO_SMALL' | 'ANIMATED' | 'NON_RASTER' | 'UNREADABLE' | 'GENERATION_INCOMPLETE';

/** What a variant pass (confirm's background job, regenerate) found out about the original. */
export type VariantPassOutcome = 'ok' | 'original_missing' | 'unreadable' | 'animated' | 'non_raster' | 'error';

export interface VariantInfo {
  planned_widths: number[];
  variants_status: VariantsStatus;
  variants_status_reason?: VariantsStatusReason;
}

/** Widths generated for an original `width` px wide: never an up-scale. */
export const plannedWidthsFor = (width: number): number[] => VARIANT_WIDTHS.filter((w) => w < width);

/**
 * - ready: every planned width has a variant
 * - processing: some missing, row younger than the processing window
 * - partial: some missing, window passed (failed generation or missing original; regenerate tells)
 * - unavailable: too small for the smallest width, or a pass found the original missing / unreadable
 * - not_applicable: animated or non-raster; the original is the only rendition
 *
 * Animation isn't stored, so a GIF with no variants past the window is inferred to be animated (a
 * static GIF over 320 px always gets variants); regenerate reports the exact answer.
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
  if (outcome === 'animated') return { planned_widths: [], variants_status: 'not_applicable', variants_status_reason: 'ANIMATED' };

  // Without a stored width, the variants that exist are the only evidence of what was producible.
  // Otherwise the plan is widened by any existing variant, so a stale width can't make a full set look partial.
  let planned: number[];
  if (knownWidth) planned = [...new Set([...plannedWidthsFor(media.width as number), ...have])].sort((a, b) => a - b);
  else planned = have.length > 0 ? have : [...VARIANT_WIDTHS];

  if (outcome === 'original_missing') return { planned_widths: planned, variants_status: 'unavailable', variants_status_reason: 'ORIGINAL_MISSING' };
  if (outcome === 'unreadable') return { planned_widths: planned, variants_status: 'unavailable', variants_status_reason: 'UNREADABLE' };
  if (planned.length === 0) return { planned_widths: [], variants_status: 'unavailable', variants_status_reason: 'TOO_SMALL' };
  if (planned.every((w) => have.includes(w))) return { planned_widths: planned, variants_status: 'ready' };

  const created = new Date(media.created_at).getTime();
  const age = (opts.now ?? Date.now()) - created;
  if (outcome === undefined && Number.isFinite(created) && age < VARIANT_PROCESSING_WINDOW_MS) return { planned_widths: planned, variants_status: 'processing' };

  if (outcome === undefined && media.mime_type === 'image/gif' && have.length === 0) {
    return { planned_widths: [], variants_status: 'not_applicable', variants_status_reason: 'ANIMATED' };
  }
  return { planned_widths: planned, variants_status: 'partial', variants_status_reason: 'GENERATION_INCOMPLETE' };
}
