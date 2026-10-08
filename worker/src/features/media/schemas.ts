import { z } from '@hono/zod-openapi';
import { paginationShape } from '../../lib/pagination';
import { searchTerm } from '../../lib/search-term';

/** DTO_LIMITS in src/common/validators/dto-limits.ts. */
const LIMITS = { filename: 255, caption: 500, mimeType: 127, storageKey: 1024 } as const;

const imageMime = z.string().max(LIMITS.mimeType).regex(/^image\//);

export const uploadUrlBody = z.object({
  filename: z.string().max(LIMITS.filename),
  mime_type: imageMime,
});

export const confirmBody = z.object({
  key: z.string().max(LIMITS.storageKey),
  filename: z.string().max(LIMITS.filename),
  alt_text: z.string().max(LIMITS.caption).nullish(),
  mime_type: imageMime,
  file_size: z.number().min(1).int(),
  width: z.number().min(1).int().nullish(),
  height: z.number().min(1).int().nullish(),
});

export const updateMediaBody = z.object({
  filename: z.string().max(LIMITS.filename).nullish(),
  alt_text: z.string().max(LIMITS.caption).nullish(),
});

export type ConfirmInput = z.output<typeof confirmBody>;
export type UpdateMediaInput = z.output<typeof updateMediaBody>;

export const mediaQuery = z.object({
  ...paginationShape,
  search: searchTerm,
  mime_type: z
    .string()
    .max(LIMITS.mimeType)
    .regex(/^[\w.+-]+\/[\w.+-]+$/)
    .optional(),
});

/** No uuid check: a malformed id reaches Postgres and comes back as 400 INVALID_IDENTIFIER, as in Nest. */
export const idParams = z.object({ id: z.string() });
