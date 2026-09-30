import { createHmac } from 'node:crypto';
import { deriveKey, hmacHex, KEY_INFO, resolveHmacKeyring, verifyHmacHex } from './derive-key.util';

const JWT_SECRET = 'jwt-secret-for-tests-0123456789abcdef';
const legacyMac = (message: string) => createHmac('sha256', JWT_SECRET).update(message).digest('hex');

const keyring = (info: string, dedicatedSecret?: string) =>
  resolveHmacKeyring({ dedicatedSecret, dedicatedName: 'SOME_SECRET', jwtSecret: JWT_SECRET, info });

describe('deriveKey', () => {
  it('is deterministic for the same secret and purpose', () => {
    expect(deriveKey(JWT_SECRET, KEY_INFO.contestAttempt).equals(deriveKey(JWT_SECRET, KEY_INFO.contestAttempt))).toBe(true);
  });

  it('yields a 32-byte key that is not the secret itself', () => {
    const key = deriveKey(JWT_SECRET, KEY_INFO.contestAttempt);

    expect(key).toHaveLength(32);
    expect(key.toString('utf8')).not.toContain(JWT_SECRET);
  });

  it('gives every purpose its own key', () => {
    const keys = Object.values(KEY_INFO).map((info) => deriveKey(JWT_SECRET, info).toString('hex'));

    expect(new Set(keys).size).toBe(keys.length);
  });

  it('gives a different secret a different key', () => {
    expect(deriveKey('another-secret-0123456789abcdef0123', KEY_INFO.contestAttempt).equals(
      deriveKey(JWT_SECRET, KEY_INFO.contestAttempt),
    )).toBe(false);
  });
});

describe('resolveHmacKeyring', () => {
  describe('without a dedicated secret', () => {
    it('mints with the HKDF-derived key, never the raw JWT_SECRET', () => {
      const ring = keyring(KEY_INFO.contestAttempt);
      const token = hmacHex(ring.signingKey, 'attempt-1');

      expect(token).not.toBe(legacyMac('attempt-1'));
      expect(token).toBe(hmacHex(deriveKey(JWT_SECRET, KEY_INFO.contestAttempt), 'attempt-1'));
    });

    it('round-trips a derived token', () => {
      const ring = keyring(KEY_INFO.contestAttempt);

      expect(verifyHmacHex(ring, 'attempt-1', hmacHex(ring.signingKey, 'attempt-1'))).toBe(true);
    });

    it('still verifies a token minted with the raw JWT_SECRET before the change (verify-only fallback)', () => {
      const ring = keyring(KEY_INFO.newsletterUnsubscribe);

      expect(verifyHmacHex(ring, 'subscriber-1', legacyMac('subscriber-1'))).toBe(true);
    });

    it('never mints a legacy-format token', () => {
      const ring = keyring(KEY_INFO.newsletterUnsubscribe);

      expect(hmacHex(ring.signingKey, 'subscriber-1')).not.toBe(legacyMac('subscriber-1'));
    });

    it('rejects a token minted for a different purpose', () => {
      const contest = keyring(KEY_INFO.contestAttempt);
      const unsubscribe = keyring(KEY_INFO.newsletterUnsubscribe);
      const confirm = keyring(KEY_INFO.newsletterConfirm);
      const contestToken = hmacHex(contest.signingKey, 'same-id');

      expect(verifyHmacHex(unsubscribe, 'same-id', contestToken)).toBe(false);
      expect(verifyHmacHex(confirm, 'same-id', contestToken)).toBe(false);
      expect(verifyHmacHex(contest, 'same-id', hmacHex(unsubscribe.signingKey, 'same-id'))).toBe(false);
    });

    it('rejects a token for a different message', () => {
      const ring = keyring(KEY_INFO.contestAttempt);

      expect(verifyHmacHex(ring, 'attempt-2', hmacHex(ring.signingKey, 'attempt-1'))).toBe(false);
    });

    it.each([
      ['a flipped character', (t: string) => `${t.slice(0, -1)}${t.endsWith('0') ? '1' : '0'}`],
      ['a truncated token', (t: string) => t.slice(0, -2)],
      ['an extended token', (t: string) => `${t}00`],
      ['an empty token', () => ''],
      ['an upper-cased token', (t: string) => t.toUpperCase()],
    ])('rejects %s', (_label, tamper) => {
      const ring = keyring(KEY_INFO.contestAttempt);

      expect(verifyHmacHex(ring, 'attempt-1', tamper(hmacHex(ring.signingKey, 'attempt-1')))).toBe(false);
    });

    it('rejects a token signed by an unrelated secret', () => {
      const ring = keyring(KEY_INFO.contestAttempt);
      const forged = createHmac('sha256', 'attacker-guess').update('attempt-1').digest('hex');

      expect(verifyHmacHex(ring, 'attempt-1', forged)).toBe(false);
    });
  });

  describe('with a dedicated secret', () => {
    it('uses it as-is for minting — unchanged from before', () => {
      const ring = keyring(KEY_INFO.contestAttempt, 'dedicated-secret');

      expect(hmacHex(ring.signingKey, 'attempt-1')).toBe(
        createHmac('sha256', 'dedicated-secret').update('attempt-1').digest('hex'),
      );
    });

    it('verifies its own tokens', () => {
      const ring = keyring(KEY_INFO.contestAttempt, 'dedicated-secret');

      expect(verifyHmacHex(ring, 'attempt-1', hmacHex(ring.signingKey, 'attempt-1'))).toBe(true);
    });

    it('does NOT accept JWT_SECRET-based tokens, legacy or derived (no fallback once a dedicated secret is set)', () => {
      const ring = keyring(KEY_INFO.contestAttempt, 'dedicated-secret');

      expect(verifyHmacHex(ring, 'attempt-1', legacyMac('attempt-1'))).toBe(false);
      expect(verifyHmacHex(ring, 'attempt-1', hmacHex(deriveKey(JWT_SECRET, KEY_INFO.contestAttempt), 'attempt-1'))).toBe(false);
    });
  });

  describe('misconfiguration', () => {
    it('refuses to build a keyring with no secret at all', () => {
      expect(() =>
        resolveHmacKeyring({ dedicatedSecret: undefined, dedicatedName: 'CONTEST_ATTEMPT_SECRET', jwtSecret: undefined, info: KEY_INFO.contestAttempt }),
      ).toThrow('CONTEST_ATTEMPT_SECRET (or JWT_SECRET) is required');
    });

    it('treats a blank dedicated secret as unset', () => {
      const ring = keyring(KEY_INFO.contestAttempt, '');

      expect(hmacHex(ring.signingKey, 'x')).toBe(hmacHex(deriveKey(JWT_SECRET, KEY_INFO.contestAttempt), 'x'));
    });

    it('treats a blank JWT_SECRET as missing', () => {
      expect(() =>
        resolveHmacKeyring({ dedicatedSecret: '', dedicatedName: 'X', jwtSecret: '', info: KEY_INFO.contestAttempt }),
      ).toThrow(/required/);
    });
  });
});
