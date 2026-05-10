/**
 * Helpers for the slug / ISBN soft-delete suffix scheme.
 *
 * When a row whose unique column needs to stay reserveable is soft-deleted,
 * the existing services suffix the value with `__del_<unix_ms>` so the
 * unique constraint is freed up. Restore needs to reverse that.
 */

const SUFFIX_RE = /__del_\d+$/;

/** Returns true if the value carries a soft-delete suffix. */
export function hasSoftDeleteSuffix(value: string): boolean {
  return SUFFIX_RE.test(value);
}

/** Strip the `__del_<timestamp>` suffix, if any, from a slug or ISBN. */
export function stripSoftDeleteSuffix(value: string): string {
  return value.replace(SUFFIX_RE, '');
}

/** Build a unique soft-delete suffix from the deletion timestamp. */
export function softDeleteSuffix(at: Date): string {
  return `__del_${at.getTime()}`;
}
