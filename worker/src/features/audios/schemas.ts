import { z } from '@hono/zod-openapi';
import { paginationShape } from '../../lib/pagination';
import { queryBoolean } from '../../lib/query-boolean';
import { searchTerm } from '../../lib/search-term';
import { SLUG_PATTERN } from '../../lib/translatable-category/schemas';

/** DTO_LIMITS in src/common/validators/dto-limits.ts, plus the audio DTO's own constants. */
export const LIMITS = { title: 500, slug: 200, url: 2000, peaks: 300, listItems: 50 } as const;

// Legacy CDN urls contain spaces and Arabic characters, so only the scheme is checked.
const HTTP_URL = /^https?:\/\/.+/i;
const httpUrl = (field: string) => z.string().refine((v) => HTTP_URL.test(v), `${field} must be an http(s) URL`).max(LIMITS.url);

const slug = z.string().max(LIMITS.slug).regex(SLUG_PATTERN);
const durationSeconds = z.number().min(0).int();
const sizeMb = z.number().min(0);
const peaks = z.array(z.number().max(1).min(0)).max(LIMITS.peaks);

// Checks are listed in the order class-validator reports them (its decorators, bottom-up).
export const audioTranslationSchema = z.strictObject({
  lang: z.string().length(2),
  title: z.string().max(LIMITS.title).min(1),
  is_default: z.boolean().nullish(),
});

export type AudioTranslationInput = z.output<typeof audioTranslationSchema>;

export const createAudioBody = z.object({
  speaker_id: z.uuid().nullish(),
  audio_url: httpUrl('audio_url'),
  pdf_url: httpUrl('pdf_url').nullish(),
  slug: slug.nullish(),
  duration_seconds: durationSeconds.nullish(),
  size_mb: sizeMb.nullish(),
  peaks: peaks.nullish(),
  is_published: z.boolean().nullish(),
  translations: z.array(audioTranslationSchema).max(LIMITS.listItems).min(1),
});

export const updateAudioBody = z.object({
  speaker_id: z.uuid().nullish(),
  audio_url: httpUrl('audio_url').nullish(),
  pdf_url: httpUrl('pdf_url').nullish(),
  slug: slug.nullish(),
  duration_seconds: durationSeconds.nullish(),
  size_mb: sizeMb.nullish(),
  peaks: peaks.nullish(),
  is_published: z.boolean().nullish(),
  translations: z.array(audioTranslationSchema).max(LIMITS.listItems).nullish(),
});

export const togglePublishBody = z.object({ is_published: z.boolean() });

export const audioUploadBody = z.object({
  filename: z.string().max(255).min(1),
  content_type: z.string().regex(/^(audio\/(mpeg|mp4|x-m4a)|application\/pdf)$/),
});

export type CreateAudioInput = z.output<typeof createAudioBody>;
export type UpdateAudioInput = z.output<typeof updateAudioBody>;

export const listQuery = z.object(paginationShape);

export const audioQuery = z.object({ ...paginationShape, speaker_id: z.uuid().optional(), search: searchTerm });

export const audioAdminQuery = z.object({ ...paginationShape, speaker_id: z.uuid().optional(), search: searchTerm, is_published: queryBoolean });

export const slugParams = z.object({ slug: z.string() });

/** No uuid check: a malformed id reaches Postgres and comes back as 400 INVALID_IDENTIFIER, as in Nest. */
export const idParams = z.object({ id: z.string() });
