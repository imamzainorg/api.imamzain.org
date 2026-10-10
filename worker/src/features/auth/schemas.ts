import { z } from '@hono/zod-openapi';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '../../lib/password';

// Login does not enforce the password policy minimum: accounts made under the old floor must still sign in.
export const loginBody = z.object({
  username: z.string().max(50).min(3),
  password: z.string().max(PASSWORD_MAX_LENGTH).min(1),
});

export const refreshBody = z.object({ refresh_token: z.string().max(512) });

export const logoutBody = z.object({ refresh_token: z.string().max(512).nullish() });

export const changePasswordBody = z.object({
  currentPassword: z.string().max(PASSWORD_MAX_LENGTH),
  newPassword: z.string().max(PASSWORD_MAX_LENGTH).min(PASSWORD_MIN_LENGTH),
});

export type LoginInput = z.output<typeof loginBody>;
export type ChangePasswordInput = z.output<typeof changePasswordBody>;
