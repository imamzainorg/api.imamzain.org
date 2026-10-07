import { z } from '@hono/zod-openapi';
import { MAX_BODY_BYTES, utf8ByteLength } from '../../lib/html-sanitize';
import { paginationShape } from '../../lib/pagination';
import { queryBoolean } from '../../lib/query-boolean';
import { searchTerm } from '../../lib/search-term';
import { SLUG_PATTERN } from '../../lib/translatable-category/schemas';

/** DTO_LIMITS in src/common/validators/dto-limits.ts, plus the post DTO's own constants. */
export const LIMITS = { title: 500, summary: 5000, slug: 200, metaTitle: 120, metaDescription: 320, listItems: 50, ids: 200 } as const;

// @IsUUID alone: a missing value reads "must be a UUID", not "must be a string".
const requiredUuid = (field: string) => z.custom<string>((v) => z.uuid().safeParse(v).success, `${field} must be a UUID`);

// iso-instant-offset.validator.ts: an ISO-8601 instant that names its time zone, so a value without one
// is not read in the server's zone and fired hours late. Impossible days ("2026-02-31") are rejected too.
const ISO_INSTANT_WITH_OFFSET = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(?:Z|[+-](\d{2}):(\d{2}))$/;

function isIsoInstantWithOffset(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const m = ISO_INSTANT_WITH_OFFSET.exec(value);
  if (!m) return false;
  const [year, month, day, hour, minute] = [m[1], m[2], m[3], m[4], m[5]].map(Number);
  const second = m[6] === undefined ? 0 : Number(m[6]);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth) return false;
  if (hour > 23 || minute > 59 || second > 59) return false;
  if (m[7] !== undefined && (Number(m[7]) > 23 || Number(m[8]) > 59)) return false;
  return true;
}

const publishedAt = z.custom<string>(
  isIsoInstantWithOffset,
  'published_at must be an ISO-8601 timestamp with an explicit UTC offset, e.g. 2026-06-01T09:00:00Z or 2026-06-01T12:00:00+03:00',
);

// @ArrayUnique(uuidIdentity): Postgres compares uuids case-insensitively, so ids differing only by case collide.
// Listed before the size caps: class-validator reports the decorators bottom-up.
const uuidList = (field: string) =>
  z.array(z.uuid()).refine((ids) => new Set(ids.map((id) => id.toLowerCase())).size === ids.length, `All ${field}'s elements must be unique`);

// Checks are listed in the order class-validator reports them (its decorators, bottom-up).
export const postTranslationSchema = z.strictObject({
  lang: z.string().length(2),
  title: z.string().max(LIMITS.title).min(1),
  summary: z.string().max(LIMITS.summary).nullish(),
  // @MaxBytes: the mapper in lib/validation.ts turns `params.maxBytes` into Nest's text.
  body: z
    .string()
    .refine((v) => utf8ByteLength(v) <= MAX_BODY_BYTES, { params: { maxBytes: MAX_BODY_BYTES } })
    .min(1),
  is_default: z.boolean().nullish(),
  meta_title: z.string().max(LIMITS.metaTitle).nullish(),
  meta_description: z.string().max(LIMITS.metaDescription).nullish(),
  og_image_id: z.uuid().nullish(),
});

export type PostTranslationInput = z.output<typeof postTranslationSchema>;

const slug = z.string().max(LIMITS.slug).regex(SLUG_PATTERN);

export const createPostBody = z.object({
  category_id: requiredUuid('category_id'),
  cover_image_id: z.uuid().nullish(),
  slug,
  is_published: z.boolean().nullish(),
  is_featured: z.boolean().nullish(),
  published_at: publishedAt.nullish(),
  translations: z.array(postTranslationSchema).max(LIMITS.listItems).min(1),
  attachment_ids: uuidList('attachment_ids').max(LIMITS.ids).nullish(),
});

export const updatePostBody = z.object({
  category_id: z.uuid().nullish(),
  cover_image_id: z.uuid().nullish(),
  slug: slug.nullish(),
  is_published: z.boolean().nullish(),
  is_featured: z.boolean().nullish(),
  published_at: publishedAt.nullish(),
  translations: z.array(postTranslationSchema).max(LIMITS.listItems).nullish(),
  attachment_ids: uuidList('attachment_ids').max(LIMITS.ids).nullish(),
});

export const togglePublishBody = z.object({ is_published: z.boolean() });

export const bulkIdsBody = z.object({ ids: uuidList('ids').max(LIMITS.ids).min(1) });
export const bulkPublishBody = z.object({ ids: bulkIdsBody.shape.ids, is_published: z.boolean() });

export type CreatePostInput = z.output<typeof createPostBody>;
export type UpdatePostInput = z.output<typeof updatePostBody>;

export const listQuery = z.object(paginationShape);

export const postQuery = z.object({
  ...paginationShape,
  category_id: z.uuid().optional(),
  search: searchTerm,
  featured: queryBoolean,
  sort: z.enum(['newest', 'views']).optional(),
  status: z.enum(['draft', 'scheduled', 'published', 'all']).optional(),
});

export type PostQuery = z.output<typeof postQuery>;

export const slugParams = z.object({ slug: z.string() });

/** No uuid check: a malformed id reaches Postgres and comes back as 400 INVALID_IDENTIFIER, as in Nest. */
export const idParams = z.object({ id: z.string() });
