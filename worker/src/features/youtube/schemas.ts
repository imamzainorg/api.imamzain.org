import { z } from '@hono/zod-openapi';
import { paginationShape } from '../../lib/pagination';

const LIMITS = { playlistVideos: { default: 50, max: 200 } };

export const listQuery = z.strictObject(paginationShape);

export const playlistParams = z.object({ playlistId: z.string() });

export const playlistVideosQuery = z.strictObject({
  limit: z.coerce
    .number()
    .max(LIMITS.playlistVideos.max)
    .min(1)
    .int()
    .default(LIMITS.playlistVideos.default),
});
