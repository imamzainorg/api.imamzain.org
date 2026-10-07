import { z } from '@hono/zod-openapi';
import { documentLanguages as documentLanguagesOf } from '../../lib/document-languages';
import { paginationShape } from '../../lib/pagination';
import { searchTerm } from '../../lib/search-term';

/** DTO_LIMITS in src/common/validators/dto-limits.ts; the CMS forms use the same numbers. */
export const LIMITS = { title: 500, summary: 5000, person: 300, label: 200, code: 64, url: 2048, listItems: 50 } as const;

const urlShape = { protocol: /^(https?|ftp)$/, hostname: z.regexes.domain };

// class-validator's bare @IsUrl() (validator.js isURL): protocol optional, http(s)/ftp, a dotted host.
// A value without `://` is checked as if it had a scheme, which is what isURL's no-protocol branch does.
const isUrl = (v: string) =>
  z.url(urlShape).safeParse(v).success || (!v.includes('://') && z.url(urlShape).safeParse(`http://${v}`).success);

const pdfUrl = z.string().max(LIMITS.url).refine(isUrl, 'pdf_url must be a URL address');

// @IsUUID alone: a missing value reads "must be a UUID", not "must be a string".
const categoryId = z.custom<string>((v) => z.uuid().safeParse(v).success, 'category_id must be a UUID');

// Checks are listed in the order class-validator reports them (its decorators, bottom-up).
export const paperTranslationSchema = z.strictObject({
  lang: z.string().length(2),
  title: z.string().max(LIMITS.title).min(1),
  abstract: z.string().max(LIMITS.summary).nullish(),
  authors: z.array(z.string().max(LIMITS.person)).max(LIMITS.listItems).nullish(),
  keywords: z.array(z.string().max(LIMITS.label)).max(LIMITS.listItems).nullish(),
  publication_venue: z.string().max(LIMITS.title).nullish(),
  page_count: z.number().min(1).int().nullish(),
  is_default: z.boolean().nullish(),
});

export type PaperTranslationInput = z.output<typeof paperTranslationSchema>;

const documentLanguages = documentLanguagesOf(LIMITS.listItems);

export const createPaperBody = z.object({
  category_id: categoryId,
  published_year: z.string().max(LIMITS.code).nullish(),
  pdf_url: pdfUrl.nullish(),
  document_languages: documentLanguages.nullish(),
  is_published: z.boolean().nullish(),
  translations: z.array(paperTranslationSchema).max(LIMITS.listItems).min(1),
});

export const updatePaperBody = z.object({
  category_id: z.uuid().nullish(),
  published_year: z.string().max(LIMITS.code).nullish(),
  pdf_url: pdfUrl.nullish(),
  document_languages: documentLanguages.nullish(),
  is_published: z.boolean().nullish(),
  translations: z.array(paperTranslationSchema).max(LIMITS.listItems).nullish(),
});

export const togglePublishBody = z.object({ is_published: z.boolean() });

export type CreatePaperInput = z.output<typeof createPaperBody>;
export type UpdatePaperInput = z.output<typeof updatePaperBody>;

export const listQuery = z.object(paginationShape);

export const paperQuery = z.object({ ...paginationShape, category_id: z.uuid().optional(), search: searchTerm });

/** No uuid check: a malformed id reaches Postgres and comes back as 400 INVALID_IDENTIFIER, as in Nest. */
export const idParams = z.object({ id: z.string() });
