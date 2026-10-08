import { z } from '@hono/zod-openapi';
import { paginationShape } from '../../lib/pagination';
import { queryBoolean } from '../../lib/query-boolean';

const LIMITS = { name: 150, contact: 200, questionId: 64, token: 128, answersMax: 500 } as const;

export const startBody = z.object({
  name: z.string().max(LIMITS.name),
  // Checked against contactType by the service, which answers its own 400.
  contact: z.string().max(LIMITS.contact),
  contactType: z.enum(['phone', 'email']),
});

export const submitBody = z.object({
  // A custom check, so a missing value also reads `attempt_id must be a UUID`, as @IsUUID does.
  attempt_id: z.custom<string>((v) => z.uuid().safeParse(v).success, 'attempt_id must be a UUID'),
  attempt_token: z.string().max(LIMITS.token).nullish(),
  answers: z
    .array(z.strictObject({ question_id: z.string().max(LIMITS.questionId), answer: z.enum(['A', 'B', 'C', 'D']) }))
    .max(LIMITS.answersMax)
    .min(1),
});

export type StartInput = z.output<typeof startBody>;
export type SubmitInput = z.output<typeof submitBody>;

export const attemptsQuery = z.object({ ...paginationShape, submitted: queryBoolean });
