import { z } from '@hono/zod-openapi';
import { isoDate } from '../../lib/iso-date';
import { paginationShape } from '../../lib/pagination';

/** DTO_LIMITS in src/common/validators/dto-limits.ts; the CMS forms use the same numbers. */
export const LIMITS = { title: 500, summary: 5000, person: 300, label: 200, metaTitle: 300, metaDescription: 500, listItems: 50 } as const;

// Checks are listed in the order class-validator reports them (its decorators, bottom-up).
export const galleryTranslationSchema = z.strictObject({
  lang: z.string().length(2),
  title: z.string().max(LIMITS.title).min(1),
  description: z.string().max(LIMITS.summary).nullish(),
  meta_title: z.string().max(LIMITS.metaTitle).nullish(),
  meta_description: z.string().max(LIMITS.metaDescription).nullish(),
  og_image_id: z.uuid().nullish(),
});

export type GalleryTranslationInput = z.output<typeof galleryTranslationSchema>;

const labels = z.array(z.string().max(LIMITS.label)).max(LIMITS.listItems);

export const createGalleryBody = z.object({
  // @IsUUID alone: a missing value reads "must be a UUID", not "must be a string".
  media_id: z.custom<string>((v) => z.uuid().safeParse(v).success, 'media_id must be a UUID'),
  category_id: z.uuid().nullish(),
  taken_at: isoDate('taken_at').nullish(),
  author: z.string().max(LIMITS.person).nullish(),
  tags: labels.nullish(),
  locations: labels.nullish(),
  is_published: z.boolean().nullish(),
  translations: z.array(galleryTranslationSchema).max(LIMITS.listItems).min(1),
});

export const updateGalleryBody = z.object({
  category_id: z.uuid().nullish(),
  taken_at: isoDate('taken_at').nullish(),
  author: z.string().max(LIMITS.person).nullish(),
  tags: labels.nullish(),
  locations: labels.nullish(),
  is_published: z.boolean().nullish(),
  translations: z.array(galleryTranslationSchema).max(LIMITS.listItems).nullish(),
});

export const togglePublishBody = z.object({ is_published: z.boolean() });

export type CreateGalleryInput = z.output<typeof createGalleryBody>;
export type UpdateGalleryInput = z.output<typeof updateGalleryBody>;

export const listQuery = z.object(paginationShape);

// @Transform: a single `?tags=a` becomes ['a'].
const queryList = z.preprocess((v) => (v === undefined || Array.isArray(v) ? v : [v]), labels.optional());

export const galleryQuery = z.object({ ...paginationShape, category_id: z.uuid().optional(), tags: queryList, locations: queryList });

/** No uuid check: a malformed id reaches Postgres and comes back as 400 INVALID_IDENTIFIER, as in Nest. */
export const idParams = z.object({ id: z.string() });
