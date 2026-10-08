import { z } from '@hono/zod-openapi';
import isEmail from 'validator/es/lib/isEmail';
import { isoDate } from '../../lib/iso-date';
import { paginationShape } from '../../lib/pagination';

const LIMITS = { nameMin: 2, nameMax: 100, email: 254, messageMin: 10, messageMax: 2000, notes: 2000 } as const;

const COUNTRY = /^[A-Z]{2}$/;
const E164 = /^\+[1-9]\d{1,14}$/;

export const PROXY_VISIT_STATUSES = ['PENDING', 'APPROVED', 'COMPLETED', 'REJECTED'] as const;
export const CONTACT_STATUSES = ['NEW', 'RESPONDED', 'SPAM'] as const;

const notes = z.string().max(LIMITS.notes).nullish();

export const createProxyVisitBody = z.object({
  visitor_name: z.string().max(LIMITS.nameMax).min(LIMITS.nameMin),
  // A refinement, so the DTO's own message is used verbatim.
  visitor_phone: z.string().refine((v) => E164.test(v), 'Phone must be in E.164 format e.g. +9647801234567'),
  visitor_country: z.string().regex(COUNTRY).length(2),
});

export const updateProxyVisitBody = z.object({
  status: z.enum(PROXY_VISIT_STATUSES).nullish(),
  processed_at: isoDate('processed_at').nullish(),
  notes,
});

export const createContactBody = z.object({
  name: z.string().max(LIMITS.nameMax).min(LIMITS.nameMin),
  // validator.js's isEmail, as class-validator's @IsEmail().
  email: z
    .string()
    .max(LIMITS.email)
    .refine((v) => isEmail(v), 'email must be an email'),
  country: z.string().regex(COUNTRY).length(2).nullish(),
  message: z.string().max(LIMITS.messageMax).min(LIMITS.messageMin),
});

export const updateContactBody = z.object({
  status: z.enum(CONTACT_STATUSES).nullish(),
  responded_at: isoDate('responded_at').nullish(),
  notes,
});

export type CreateProxyVisitInput = z.output<typeof createProxyVisitBody>;
export type UpdateProxyVisitInput = z.output<typeof updateProxyVisitBody>;
export type CreateContactInput = z.output<typeof createContactBody>;
export type UpdateContactInput = z.output<typeof updateContactBody>;

export const proxyVisitQuery = z.object({ ...paginationShape, status: z.enum(PROXY_VISIT_STATUSES).optional() });
export const contactQuery = z.object({ ...paginationShape, status: z.enum(CONTACT_STATUSES).optional() });

/** No uuid check: a malformed id reaches Postgres and comes back as 400 INVALID_IDENTIFIER, as in Nest. */
export const idParams = z.object({ id: z.string() });
