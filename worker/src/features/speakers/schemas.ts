import { z } from '@hono/zod-openapi';
import { paginationShape } from '../../lib/pagination';
import { searchTerm } from '../../lib/search-term';

export const LIMITS = { name: 300, listItems: 50 } as const;

export const speakerTranslationSchema = z.strictObject({
  lang: z.string().length(2),
  name: z.string().max(LIMITS.name).min(1),
  is_default: z.boolean().nullish(),
});

export type SpeakerTranslationInput = z.output<typeof speakerTranslationSchema>;

export const createSpeakerBody = z.object({
  translations: z.array(speakerTranslationSchema).max(LIMITS.listItems).min(1),
});

export const updateSpeakerBody = z.object({
  translations: z.array(speakerTranslationSchema).max(LIMITS.listItems).nullish(),
});

export const listQuery = z.object(paginationShape);
export const speakerQuery = z.object({ ...paginationShape, search: searchTerm });

export const idParams = z.object({ id: z.string() });
