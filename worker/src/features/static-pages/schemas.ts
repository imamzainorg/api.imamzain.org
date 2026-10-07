import { z } from '@hono/zod-openapi';
import { MAX_BODY_BYTES, utf8ByteLength } from '../../lib/html-sanitize';
import { paginationShape } from '../../lib/pagination';
import { queryBoolean } from '../../lib/query-boolean';
import { SLUG_PATTERN } from '../../lib/translatable-category/schemas';

/** DTO_LIMITS in src/common/validators/dto-limits.ts; the CMS forms use the same numbers. */
export const LIMITS = { title: 300, slug: 200, metaDescription: 500, listItems: 50 } as const;

// Checks are listed in the order class-validator reports them (its decorators, bottom-up).
export const staticPageTranslationSchema = z.strictObject({
  lang: z.string().length(2),
  title: z.string().max(LIMITS.title).min(1),
  // @MaxBytes: the mapper in lib/validation.ts turns `params.maxBytes` into Nest's text.
  body: z
    .string()
    .refine((v) => utf8ByteLength(v) <= MAX_BODY_BYTES, { params: { maxBytes: MAX_BODY_BYTES } })
    .min(1),
  meta_title: z.string().max(LIMITS.title).nullish(),
  meta_description: z.string().max(LIMITS.metaDescription).nullish(),
  og_image_id: z.uuid().nullish(),
  is_default: z.boolean().nullish(),
});

export type StaticPageTranslationInput = z.output<typeof staticPageTranslationSchema>;

const slug = z.string().max(LIMITS.slug).regex(SLUG_PATTERN);
const displayOrder = z.number().min(0).int();

export const createStaticPageBody = z.object({
  slug,
  translations: z.array(staticPageTranslationSchema).max(LIMITS.listItems).min(1),
  display_order: displayOrder.nullish(),
  is_published: z.boolean().nullish(),
});

export const updateStaticPageBody = z.object({
  slug: slug.nullish(),
  translations: z.array(staticPageTranslationSchema).max(LIMITS.listItems).nullish(),
  display_order: displayOrder.nullish(),
  is_published: z.boolean().nullish(),
});

export const togglePublishBody = z.object({ is_published: z.boolean() });

export type CreateStaticPageInput = z.output<typeof createStaticPageBody>;
export type UpdateStaticPageInput = z.output<typeof updateStaticPageBody>;

export const listQuery = z.object(paginationShape);

export const adminListQuery = z.object({ ...paginationShape, is_published: queryBoolean });

/** No uuid check: a malformed id reaches Postgres and comes back as 400 INVALID_IDENTIFIER, as in Nest. */
export const idParams = z.object({ id: z.string() });
export const slugParams = z.object({ slug: z.string() });
