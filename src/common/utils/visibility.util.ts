/**
 * The "publicly visible" filter repeated by hand across most content
 * modules: never soft-deleted, and (for resources that carry a publish
 * flag) currently published. books/academic_papers/gallery_images all
 * gained an `is_published` column and are called with `hasPublishFlag:
 * true` like everything else. `false` still exists for models such as
 * gallery_categories that have `deleted_at` but no publish column of
 * their own — passing `true` for those would reference a column that
 * doesn't exist, so `false` omits `is_published` from the filter entirely.
 */
export function publicWhere(hasPublishFlag: true): { deleted_at: null; is_published: true };
export function publicWhere(hasPublishFlag: false): { deleted_at: null };
export function publicWhere(hasPublishFlag: boolean): { deleted_at: null; is_published?: true } {
  return hasPublishFlag ? { deleted_at: null, is_published: true } : { deleted_at: null };
}
