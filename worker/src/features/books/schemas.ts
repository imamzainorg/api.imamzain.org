import { z } from '@hono/zod-openapi';
import { documentLanguages } from '../../lib/document-languages';
import { paginationShape } from '../../lib/pagination';
import { queryBoolean } from '../../lib/query-boolean';
import { searchTerm } from '../../lib/search-term';
import { SLUG_PATTERN } from '../../lib/translatable-category/schemas';

/** DTO_LIMITS in src/common/validators/dto-limits.ts, plus the book DTO's own constants. */
export const LIMITS = { title: 500, summary: 5000, person: 300, code: 64, slug: 200, url: 2000, metaTitle: 300, metaDescription: 500, listItems: 50 } as const;

// Legacy CDN urls contain spaces and Arabic characters, so only the scheme is checked.
const HTTP_URL = /^https?:\/\/.+/i;
const pdfUrl = z.string().refine((v) => HTTP_URL.test(v), 'pdf_url must be an http(s) URL').max(LIMITS.url);

const slug = z.string().max(LIMITS.slug).regex(SLUG_PATTERN);
const isbn = z.string().max(LIMITS.code).min(1);
const positiveInt = z.number().min(1).int();

// @IsUUID alone: a missing value reads "must be a UUID", not "must be a string".
const requiredUuid = (field: string) => z.custom<string>((v) => z.uuid().safeParse(v).success, `${field} must be a UUID`);

// Checks are listed in the order class-validator reports them (its decorators, bottom-up).
export const bookTranslationSchema = z.strictObject({
  lang: z.string().length(2),
  title: z.string().max(LIMITS.title).min(1),
  author: z.string().max(LIMITS.person).nullish(),
  publisher: z.string().max(LIMITS.person).nullish(),
  description: z.string().max(LIMITS.summary).nullish(),
  series: z.string().max(LIMITS.title).nullish(),
  meta_title: z.string().max(LIMITS.metaTitle).nullish(),
  meta_description: z.string().max(LIMITS.metaDescription).nullish(),
  og_image_id: z.uuid().nullish(),
  is_default: z.boolean().nullish(),
});

export type BookTranslationInput = z.output<typeof bookTranslationSchema>;

const docLanguages = documentLanguages(LIMITS.listItems);

export const createBookBody = z.object({
  category_id: requiredUuid('category_id'),
  cover_image_id: requiredUuid('cover_image_id'),
  slug: slug.nullish(),
  isbn: isbn.nullish(),
  pages: positiveInt.nullish(),
  publish_year: z.string().max(LIMITS.code).nullish(),
  pdf_url: pdfUrl.nullish(),
  document_languages: docLanguages.nullish(),
  part_number: positiveInt.nullish(),
  parts: positiveInt.nullish(),
  is_published: z.boolean().nullish(),
  parent_id: z.uuid().nullish(),
  is_publication: z.boolean().nullish(),
  translations: z.array(bookTranslationSchema).max(LIMITS.listItems).min(1),
});

export const updateBookBody = z.object({
  category_id: z.uuid().nullish(),
  cover_image_id: z.uuid().nullish(),
  slug: slug.nullish(),
  isbn: isbn.nullish(),
  pages: positiveInt.nullish(),
  publish_year: z.string().max(LIMITS.code).nullish(),
  pdf_url: pdfUrl.nullish(),
  document_languages: docLanguages.nullish(),
  part_number: positiveInt.nullish(),
  parts: positiveInt.nullish(),
  is_published: z.boolean().nullish(),
  parent_id: z.uuid().nullish(),
  is_publication: z.boolean().nullish(),
  translations: z.array(bookTranslationSchema).max(LIMITS.listItems).nullish(),
});

export const togglePublishBody = z.object({ is_published: z.boolean() });

export type CreateBookInput = z.output<typeof createBookBody>;
export type UpdateBookInput = z.output<typeof updateBookBody>;

export const listQuery = z.object(paginationShape);

export const bookQuery = z.object({ ...paginationShape, category_id: z.uuid().optional(), search: searchTerm, is_publication: queryBoolean });

export const slugParams = z.object({ slug: z.string() });

/** No uuid check: a malformed id reaches Postgres and comes back as 400 INVALID_IDENTIFIER, as in Nest. */
export const idParams = z.object({ id: z.string() });
