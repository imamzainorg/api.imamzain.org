import { z } from '@hono/zod-openapi';

// `@Length(2, 2, { each: true })` words its message from the length of the whole ARRAY, not of the
// element: shorter than 2 elements reads "longer than", more reads "shorter than", exactly 2 both.
export const documentLanguages = (maxItems: number) =>
  z
    .array(z.string())
    .superRefine((codes, ctx) => {
      const range = codes.length < 2 ? 'longer than or equal to 2' : codes.length > 2 ? 'shorter than or equal to 2' : 'longer than or equal to 2 and shorter than or equal to 2';
      codes.forEach((code, index) => {
        if (code.length !== 2) ctx.addIssue({ code: 'custom', path: [index], message: `each value in document_languages must be ${range} characters` });
      });
    })
    .max(maxItems);
