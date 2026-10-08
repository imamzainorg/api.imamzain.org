import { z } from '@hono/zod-openapi';

export const SEARCH_TYPES = ['post', 'book', 'academic_paper', 'gallery_image', 'audio'] as const;
export type SearchType = (typeof SEARCH_TYPES)[number];

const LIMITS = { q: { min: 2, max: 200 }, limit: { default: 10, max: 50 } };

const trim = (v: unknown) => (typeof v === 'string' ? v.trim() : v);

// `?types=post,book` or repeated `?types=`; an empty value means "all types".
const splitTypes = (v: unknown) => {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string' && v.length > 0) return v.split(',').map((s) => s.trim());
  return undefined;
};

export const searchQuery = z.strictObject({
  q: z.preprocess(trim, z.string().max(LIMITS.q.max).min(LIMITS.q.min)),
  types: z.preprocess(
    splitTypes,
    z
      .array(z.enum(SEARCH_TYPES))
      .refine((a) => new Set(a).size === a.length, {
        message: "All types's elements must be unique",
      })
      .nullish(),
  ),
  limit: z.coerce.number().max(LIMITS.limit.max).min(1).int().default(LIMITS.limit.default),
});

export type SearchInput = z.output<typeof searchQuery>;
