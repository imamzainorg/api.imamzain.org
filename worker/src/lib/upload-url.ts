import { z } from '@hono/zod-openapi';

/** RequestPdfUploadUrlDto (books', academic-papers' `POST .../upload-url`): always application/pdf. */
export const pdfUploadBody = z.object({ filename: z.string().max(255).min(1) });
