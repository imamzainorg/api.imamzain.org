import { z } from '@hono/zod-openapi';
import { paginationShape } from '../../lib/pagination';

/** DTO_LIMITS in src/common/validators/dto-limits.ts; src/daily-hadiths/dto/daily-hadith.dto.ts. */
export const LIMITS = { content: 4000, source: 500, listItems: 50 } as const;

/** Shape check only; the service verifies the calendar date. */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

// Custom refinements, not `.regex`: the validation mapper would print "must match ... regular expression",
// Nest's DTOs carry their own `@Matches` message.
const dateOnly = (field: string) => z.string().refine((v) => DATE_ONLY.test(v), `${field} must be YYYY-MM-DD`);

const translationSchema = z.strictObject({
  lang: z.string().length(2),
  content: z.string().max(LIMITS.content).min(1),
  source: z.string().max(LIMITS.source).nullish(),
});

export type HadithTranslationInput = z.output<typeof translationSchema>;

export const createHadithBody = z.object({
  display_date: dateOnly('display_date').nullish(),
  translations: z.array(translationSchema).max(LIMITS.listItems).min(1),
});

export const updateHadithBody = z.object({
  // Nest's update DTO has no @IsString, only @Matches: any non-string fails with the same message.
  display_date: z.custom<string>((v) => typeof v === 'string' && DATE_ONLY.test(v), 'display_date must be YYYY-MM-DD').nullish(),
  translations: z.array(translationSchema).max(LIMITS.listItems).nullish(),
});

export const listQuery = z.object(paginationShape);

// The subclass's own properties are reported before the inherited pagination ones.
export const publicListQuery = z.object({
  date: dateOnly('date').optional(),
  from: dateOnly('from').optional(),
  to: dateOnly('to').optional(),
  ...paginationShape,
});

/** No uuid check: a malformed id reaches Postgres and comes back as 400 INVALID_IDENTIFIER, as in Nest. */
export const idParams = z.object({ id: z.string() });
