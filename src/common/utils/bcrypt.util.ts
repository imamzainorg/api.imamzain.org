const DEFAULT_BCRYPT_ROUNDS = 12;
const MIN_ROUNDS = 4;
const MAX_ROUNDS = 15;

/**
 * Resolve bcrypt cost factor from the `BCRYPT_ROUNDS` env var. Clamps to a
 * safe range [4, 15] and falls back to 12 when the env var is unset or
 * invalid. Bcrypt itself accepts 4–31 but anything > 15 is impractical for
 * an interactive API and < 4 is insecure.
 */
export function resolveBcryptRounds(): number {
  const raw = process.env.BCRYPT_ROUNDS;
  if (!raw) return DEFAULT_BCRYPT_ROUNDS;
  const parsed = parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < MIN_ROUNDS || parsed > MAX_ROUNDS) {
    return DEFAULT_BCRYPT_ROUNDS;
  }
  return parsed;
}
