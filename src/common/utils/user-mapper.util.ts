import { users } from '@prisma/client';

export type PublicUser = Omit<users, 'password_hash'>;

/**
 * Strip the password hash from a users row before sending it across the API.
 * Replaces the scattered `const { password_hash, ...rest } = user as any`
 * pattern with a single, typed mapper. `token_version` stays in the payload
 * to preserve the existing response shape — flipping that would be a CMS-
 * visible change.
 */
export function toPublicUser(user: users): PublicUser {
  const { password_hash: _pw, ...rest } = user;
  return rest;
}
