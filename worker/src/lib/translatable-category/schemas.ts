import { z } from '@hono/zod-openapi';
import { paginationShape } from '../pagination';

/** DTO_LIMITS in src/common/validators/dto-limits.ts; the CMS forms use the same numbers. */
export const LIMITS = { title: 500, slug: 200, summary: 5000, listItems: 50 } as const;

export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// Checks are listed in the order class-validator reports them (its decorators, bottom-up), so a value
// failing two of them gets Nest's `errors` array, in Nest's order.
export const categoryTranslationSchema = z.strictObject({
  lang: z.string().length(2),
  title: z.string().max(LIMITS.title).min(1),
  slug: z.string().max(LIMITS.slug).regex(SLUG_PATTERN),
  // Nest's @IsOptional lets null through too.
  description: z.string().max(LIMITS.summary).nullish(),
});

export type CategoryTranslationInput = z.output<typeof categoryTranslationSchema>;

export const createCategoryBody = z.object({
  translations: z.array(categoryTranslationSchema).max(LIMITS.listItems).min(1),
});

export const updateCategoryBody = z.object({
  translations: z.array(categoryTranslationSchema).max(LIMITS.listItems).nullish(),
});

export const listQuery = z.object(paginationShape);

/** No uuid check: a malformed id reaches Postgres and comes back as 400 INVALID_IDENTIFIER, as in Nest. */
export const idParams = z.object({ id: z.string() });
