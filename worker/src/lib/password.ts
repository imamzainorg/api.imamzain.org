// Password policy and hashing (src/common/validators/password-policy.ts, src/common/utils/bcrypt.util.ts).
import bcrypt from 'bcryptjs';

/** Length policy for passwords being SET; login does not enforce the minimum (older accounts). */
export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;

const DEFAULT_BCRYPT_ROUNDS = 12;

/** BCRYPT_ROUNDS clamped to [4, 15], else 12. Cost 12 keeps the existing hashes' cost. */
export function bcryptRounds(env: { BCRYPT_ROUNDS?: string }): number {
  const raw = env.BCRYPT_ROUNDS;
  if (!raw) return DEFAULT_BCRYPT_ROUNDS;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 4 && parsed <= 15 ? parsed : DEFAULT_BCRYPT_ROUNDS;
}

export const hashPassword = (password: string, env: { BCRYPT_ROUNDS?: string }) => bcrypt.hash(password, bcryptRounds(env));

export const verifyPassword = (password: string, hash: string) => bcrypt.compare(password, hash);
