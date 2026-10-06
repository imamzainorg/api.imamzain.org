// Soft-deleting a row whose slug (or ISBN) must stay claimable suffixes it with `__del_<unix ms>`; restore strips it.
const SUFFIX = /__del_\d+$/;

export const stripSoftDeleteSuffix = (value: string): string => value.replace(SUFFIX, '');

export const softDeleteSuffix = (at: Date): string => `__del_${at.getTime()}`;
