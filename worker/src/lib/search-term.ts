import { z } from '@hono/zod-openapi';

export const SEARCH_MIN_LENGTH = 2;
export const SEARCH_MAX_LENGTH = 200;

/** Nest's @SearchTerm: trimmed, blank means absent, otherwise 2–200 characters. */
export const searchTerm = z.preprocess(
  (v) => {
    if (typeof v !== 'string') return v;
    const trimmed = v.trim();
    return trimmed === '' ? undefined : trimmed;
  },
  z.string().max(SEARCH_MAX_LENGTH).min(SEARCH_MIN_LENGTH).optional(),
);
