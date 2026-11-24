import { z } from '@hono/zod-openapi';
import { paginationShape } from '../../lib/pagination';
import { queryBoolean } from '../../lib/query-boolean';
import { searchTerm } from '../../lib/search-term';

export const LIMITS = { slug: 200, order: 100_000 } as const;

// Wider than the other groups' slugs: a slug defaults to YouTube's own id (capitals, `_`), and six of the
// website's live video URLs have `(`, `)` or `.` in them.
export const VIDEO_SLUG_PATTERN = /^[A-Za-z0-9_.()-]+$/;

const slug = z.string().max(LIMITS.slug).regex(VIDEO_SLUG_PATTERN);
const order = z.number().max(LIMITS.order).min(0).int();

export const slugParams = z.object({ slug: z.string() });
export const videoIdParams = z.object({ videoId: z.string() });
export const playlistIdParams = z.object({ playlistId: z.string() });

export const videoQuery = z.object({
  ...paginationShape,
  kind: z.enum(['video', 'short']).optional(),
  series: z.string().optional(),
  featured: queryBoolean,
  search: searchTerm,
});

export const videoAdminQuery = z.object({
  ...paginationShape,
  status: z.enum(['published', 'pending', 'hidden']).optional(),
  kind: z.enum(['video', 'short']).optional(),
  search: searchTerm,
});

export const updateVideoBody = z.object({
  slug: slug.nullish(),
  status: z.enum(['published', 'pending', 'hidden']).nullish(),
  is_featured: z.boolean().nullish(),
  featured_order: order.nullish(),
  speaker_id: z.uuid().nullish(),
});

export const updateSeriesBody = z.object({
  slug: slug.nullish(),
  section: z.enum(['programmes', 'commentaries', 'majalis', 'events']).nullish(),
  is_hidden: z.boolean().nullish(),
  display_order: order.nullish(),
  speaker_id: z.uuid().nullish(),
});

export const videoSettingsBody = z.object({ auto_publish: z.boolean() });

export type VideoQuery = z.output<typeof videoQuery>;
export type VideoAdminQuery = z.output<typeof videoAdminQuery>;
export type UpdateVideoInput = z.output<typeof updateVideoBody>;
export type UpdateSeriesInput = z.output<typeof updateSeriesBody>;
