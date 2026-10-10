import { z } from '@hono/zod-openapi';
import { paginationShape } from '../../lib/pagination';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '../../lib/password';

const LIMITS = { usernameMin: 3, usernameMax: 50 } as const;

// Usernames are stored byte-exact, so they are trimmed before the length checks; passwords never are.
const username = z.string().trim().max(LIMITS.usernameMax).min(LIMITS.usernameMin);
const password = z.string().max(PASSWORD_MAX_LENGTH).min(PASSWORD_MIN_LENGTH);

export const createUserBody = z.object({ username, password });

export const updateUserBody = z.object({ username: username.nullish() });

// A custom check, so a missing value also reads `role_id must be a UUID`, as @IsUUID does.
export const assignRoleBody = z.object({
  role_id: z.custom<string>((v) => z.uuid().safeParse(v).success, 'role_id must be a UUID'),
});

export const resetPasswordBody = z.object({ new_password: password });

export const listQuery = z.object(paginationShape);

/** No uuid check: a malformed id reaches Postgres and comes back as 400 INVALID_IDENTIFIER, as in Nest. */
export const idParams = z.object({ id: z.string() });

export const roleParams = z.object({ id: z.string(), roleId: z.string() });
