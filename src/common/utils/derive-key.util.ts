import { createHmac, hkdfSync, timingSafeEqual } from 'node:crypto';

/**
 * Per-purpose HMAC keys derived from JWT_SECRET.
 *
 * The contest attempt token and the newsletter unsubscribe / confirmation
 * tokens used to be HMAC-SHA256(JWT_SECRET, <public value>) whenever their
 * dedicated secret was unset — and their inputs are public (an attempt id, a
 * subscriber id), so an anonymous caller could collect known-plaintext MAC pairs
 * made with the very key that signs staff sessions. HKDF gives each purpose its
 * own key: a MAC pair for one of them says nothing about the JWT key or about
 * another purpose's key.
 */

// Fixed, public, versioned. HKDF does not need a secret salt; it only has to be
// constant so the same JWT_SECRET always derives the same keys across restarts.
const HKDF_SALT = Buffer.from('imamzain.org/api/hmac-key-derivation/v1', 'utf8');
const DERIVED_KEY_BYTES = 32;

/** One `info` string per purpose. Never reuse one, never edit one in place — bump the /vN. */
export const KEY_INFO = {
  contestAttempt: 'imamzain/contest-attempt/v1',
  newsletterUnsubscribe: 'imamzain/newsletter-unsubscribe/v1',
  newsletterConfirm: 'imamzain/newsletter-confirm/v1',
} as const;

export function deriveKey(secret: string, info: string): Buffer {
  return Buffer.from(hkdfSync('sha256', secret, HKDF_SALT, info, DERIVED_KEY_BYTES));
}

type HmacKey = string | Buffer;

export interface HmacKeyring {
  /** The one key new tokens are minted with. */
  signingKey: HmacKey;
  /** Every key a presented token may have been minted with, newest first. */
  verifyKeys: HmacKey[];
}

interface KeyringOptions {
  /** The purpose's own secret env var (CONTEST_ATTEMPT_SECRET, …); blank counts as unset. */
  dedicatedSecret: string | undefined;
  dedicatedName: string;
  jwtSecret: string | undefined;
  info: string;
}

/**
 * - Dedicated secret set: it is used as-is for minting and verifying, exactly
 *   as before — operators who configured one see no change.
 * - Otherwise: mint with HKDF(JWT_SECRET, info) and verify with that key first,
 *   then with the raw JWT_SECRET so tokens minted before this change (unsubscribe
 *   links already sitting in past campaign e-mails, in-flight contest attempts,
 *   confirmation links valid for 72 h) keep working.
 *
 * The raw-JWT_SECRET fallback is verify-only and only serves tokens minted before
 * this shipped. Contest attempts and confirmation links age out within days; the
 * long pole is the unsubscribe link inside campaign e-mails already sent. Delete
 * the second `verifyKeys` entry once you no longer promise those old links work
 * (30 days after the deploy is the legal floor; a year is generous) — nothing
 * else depends on it.
 */
export function resolveHmacKeyring({ dedicatedSecret, dedicatedName, jwtSecret, info }: KeyringOptions): HmacKeyring {
  if (dedicatedSecret) return { signingKey: dedicatedSecret, verifyKeys: [dedicatedSecret] };

  if (!jwtSecret) {
    // An empty key would produce MAC tokens anyone can forge. Refuse to boot so
    // the misconfiguration is caught immediately.
    throw new Error(`${dedicatedName} (or JWT_SECRET) is required`);
  }
  const derived = deriveKey(jwtSecret, info);
  return { signingKey: derived, verifyKeys: [derived, jwtSecret] };
}

export function hmacHex(key: HmacKey, message: string): string {
  return createHmac('sha256', key).update(message).digest('hex');
}

function safeEqual(expected: string, actual: string): boolean {
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(actual, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Constant-time check of `token` against every key in the ring (no early exit on the first match). */
export function verifyHmacHex(keyring: HmacKeyring, message: string, token: string): boolean {
  let ok = false;
  for (const key of keyring.verifyKeys) ok = safeEqual(hmacHex(key, message), token) || ok;
  return ok;
}
