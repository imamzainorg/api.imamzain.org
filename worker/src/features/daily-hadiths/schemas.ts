import { z } from '@hono/zod-openapi';
import { paginationShape } from '../../lib/pagination';

/** DTO_LIMITS in src/common/validators/dto-limits.ts; src/daily-hadiths/dto/daily-hadith.dto.ts. */
export const LIMITS = { content: 4000, source: 500, listItems: 50 } as const;

const hijriMonth = z.number().int().min(1).max(12);
const hijriDay = z.number().int().min(1).max(30);

const translationSchema = z.strictObject({
  lang: z.string().length(2),
  content: z.string().max(LIMITS.content).min(1),
  source: z.string().max(LIMITS.source).nullish(),
});

export type HadithTranslationInput = z.output<typeof translationSchema>;

// The two Hijri fields go together; the service says so when only one is sent.
export const createHadithBody = z.object({
  hijri_month: hijriMonth.nullish(),
  hijri_day: hijriDay.nullish(),
  translations: z.array(translationSchema).max(LIMITS.listItems).min(1),
});

export const updateHadithBody = z.object({
  hijri_month: hijriMonth.nullish(),
  hijri_day: hijriDay.nullish(),
  translations: z.array(translationSchema).max(LIMITS.listItems).nullish(),
});

export const setHijriDateBody = z.object({
  year: z.number().int().min(1300).max(1700),
  month: hijriMonth,
  day: hijriDay,
});

export const listQuery = z.object(paginationShape);

export const publicListQuery = z.object({
  hijri_month: z.coerce.number().int().min(1).max(12).optional(),
  hijri_day: z.coerce.number().int().min(1).max(30).optional(),
  ...paginationShape,
});

/** No uuid check: a malformed id reaches Postgres and comes back as 400 INVALID_IDENTIFIER, as in Nest. */
export const idParams = z.object({ id: z.string() });
