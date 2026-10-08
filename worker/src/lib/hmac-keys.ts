// Per-purpose HMAC keys derived from JWT_SECRET (src/common/utils/derive-key.util.ts). The tokens'
// inputs are public (an attempt id, a subscriber id), so each purpose gets its own HKDF key rather
// than MACs made with the key that signs staff sessions.
import { createHmac, hkdfSync, timingSafeEqual } from 'node:crypto';
import { Buffer } from 'node:buffer';

// Fixed and public; it only has to stay constant so one JWT_SECRET always derives the same keys.
const HKDF_SALT = Buffer.from('imamzain.org/api/hmac-key-derivation/v1', 'utf8');
const DERIVED_KEY_BYTES = 32;

/** One `info` per purpose. Never reuse or edit one in place: bump the /vN. */
export const KEY_INFO = {
  contestAttempt: 'imamzain/contest-attempt/v1',
  newsletterUnsubscribe: 'imamzain/newsletter-unsubscribe/v1',
  newsletterConfirm: 'imamzain/newsletter-confirm/v1',
} as const;

type HmacKey = string | Buffer;

export interface HmacKeyring {
  /** The key new tokens are minted with. */
  signingKey: HmacKey;
  /** Every key a presented token may have been minted with, newest first. */
  verifyKeys: HmacKey[];
}

/**
 * The purpose's own secret (blank = unset) is used as-is. Otherwise mint with HKDF(JWT_SECRET, info)
 * and also verify with the raw JWT_SECRET, which minted the tokens issued before the derivation.
 */
export function resolveHmacKeyring(opts: { dedicatedSecret: string | undefined; dedicatedName: string; jwtSecret: string | undefined; info: string }): HmacKeyring {
  if (opts.dedicatedSecret) return { signingKey: opts.dedicatedSecret, verifyKeys: [opts.dedicatedSecret] };
  // An empty key would make tokens anyone can forge.
  if (!opts.jwtSecret) throw new Error(`${opts.dedicatedName} (or JWT_SECRET) is required`);
  const derived = Buffer.from(hkdfSync('sha256', opts.jwtSecret, HKDF_SALT, opts.info, DERIVED_KEY_BYTES));
  return { signingKey: derived, verifyKeys: [derived, opts.jwtSecret] };
}

export const hmacHex = (key: HmacKey, message: string): string => createHmac('sha256', key).update(message).digest('hex');

function safeEqual(expected: string, actual: string): boolean {
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(actual, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Constant-time check of `token` against every key in the ring (no early exit on a match). */
export function verifyHmacHex(keyring: HmacKeyring, message: string, token: string): boolean {
  let ok = false;
  for (const key of keyring.verifyKeys) ok = safeEqual(hmacHex(key, message), token) || ok;
  return ok;
}
