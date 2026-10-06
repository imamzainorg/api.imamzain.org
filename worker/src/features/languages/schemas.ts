import { z } from '@hono/zod-openapi';

/** A language name is a word or two; the cap only keeps a stray paste out of the language list. */
export const LIMITS = { name: 100 } as const;

// Nest lowercases and trims `code` before validating it; non-strings pass through to the type error.
const code = z
  .string()
  .transform((v) => v.toLowerCase().trim())
  .refine((v) => /^[a-z]{2}$/.test(v), { message: 'code must be a 2-letter lowercase ISO 639-1 code' });

export const createLanguageBody = z.object({
  code,
  name: z.string().max(LIMITS.name).min(1),
  native_name: z.string().max(LIMITS.name).min(1),
  is_active: z.boolean().nullish(),
});

export const updateLanguageBody = z.object({
  name: z.string().max(LIMITS.name).nullish(),
  native_name: z.string().max(LIMITS.name).nullish(),
  is_active: z.boolean().nullish(),
});

export type CreateLanguageInput = z.output<typeof createLanguageBody>;
export type UpdateLanguageInput = z.output<typeof updateLanguageBody>;

export const codeParams = z.object({ code: z.string() });
