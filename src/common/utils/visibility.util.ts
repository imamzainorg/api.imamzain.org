/**
 * The "publicly visible" filter repeated by hand across most content
 * modules: never soft-deleted, and (for resources that carry a publish
 * flag) currently published. books/academic_papers/gallery_images have no
 * publish flag of their own — the absence of soft-delete already means
 * "live" for them, so `hasPublishFlag: false` omits `is_published` entirely
 * rather than defaulting it to `true` (there's no such column to filter on).
 */
export function publicWhere(hasPublishFlag: true): { deleted_at: null; is_published: true };
export function publicWhere(hasPublishFlag: false): { deleted_at: null };
export function publicWhere(hasPublishFlag: boolean): { deleted_at: null; is_published?: true } {
  return hasPublishFlag ? { deleted_at: null, is_published: true } : { deleted_at: null };
}
