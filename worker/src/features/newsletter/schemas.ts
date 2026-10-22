import { z } from '@hono/zod-openapi';
import isEmail from 'validator/es/lib/isEmail';
import { paginationShape } from '../../lib/pagination';
import { queryBoolean } from '../../lib/query-boolean';
import { searchTerm } from '../../lib/search-term';

const LIMITS = { email: 254, token: 256 } as const;

// Trimmed so a pasted trailing space does not create a second, never-confirmable row.
const email = z.preprocess(
  (v) => (typeof v === 'string' ? v.trim() : v),
  z
    .string()
    .max(LIMITS.email)
    .refine((v) => isEmail(v), 'Please provide a valid email address'),
);

const token = z.string().max(LIMITS.token);

export const subscribeBody = z.object({ email });
export const confirmBody = z.object({ email, token });
export const unsubscribeBody = z.object({ email, token });

export type SubscribeInput = z.output<typeof subscribeBody>;
export type ConfirmInput = z.output<typeof confirmBody>;
export type UnsubscribeInput = z.output<typeof unsubscribeBody>;

// The trash list takes the same query (Nest reuses the DTO) and ignores the filters.
export const subscriberQuery = z.object({
  ...paginationShape,
  search: searchTerm,
  is_active: queryBoolean,
});

/** No uuid check: a malformed id reaches Postgres and comes back as 400 INVALID_IDENTIFIER, as in Nest. */
export const idParams = z.object({ id: z.string() });
