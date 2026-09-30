// class-transformer's implicit conversion reads design:type metadata; Nest loads this polyfill at boot, an isolated spec must too.
import 'reflect-metadata';
import { validateEnv } from './env.validation';

const BASE = {
  DATABASE_URL: 'postgresql://u:p@localhost:6543/db',
  DIRECT_URL: 'postgresql://u:p@localhost:5432/db',
  JWT_SECRET: 'x'.repeat(40),
};

const valid = (extra: Record<string, unknown> = {}) => validateEnv({ ...BASE, ...extra });
const invalid = (extra: Record<string, unknown>) => () => validateEnv({ ...BASE, ...extra });

describe('validateEnv', () => {
  it('accepts the minimum configuration', () => {
    expect(valid().JWT_SECRET).toHaveLength(40);
  });

  describe('JWT_SECRET', () => {
    it('must be at least 32 characters', () => {
      expect(invalid({ JWT_SECRET: 'too-short' })).toThrow(/JWT_SECRET/);
      expect(() => valid({ JWT_SECRET: 'y'.repeat(32) })).not.toThrow();
    });

    it('may be the .env.example placeholder outside production, so a copied template still boots', () => {
      expect(() => valid({ JWT_SECRET: 'change-this-to-a-long-random-secret' })).not.toThrow();
    });

    it('may NOT be the placeholder in production', () => {
      expect(
        invalid({
          NODE_ENV: 'production',
          JWT_SECRET: 'change-this-to-a-long-random-secret',
          R2_ACCOUNT_ID: 'a',
          R2_ACCESS_KEY_ID: 'a',
          R2_SECRET_ACCESS_KEY: 'a',
          R2_BUCKET: 'a',
          R2_PUBLIC_BASE_URL: 'https://cdn.example.com',
          ALLOWED_ORIGINS: 'https://example.com',
        }),
      ).toThrow(/placeholder/);
    });
  });

  describe('newsletter delivery and double opt-in settings', () => {
    it('accepts sensible values', () => {
      expect(() =>
        valid({
          NEWSLETTER_SEND_PER_HOUR: '80',
          NEWSLETTER_BATCH_SIZE: '10',
          NEWSLETTER_CONFIRM_MAX_PER_HOUR: '30',
          NEWSLETTER_CONFIRM_URL_BASE: 'https://imamzain.org/newsletter/confirm',
        }),
      ).not.toThrow();
    });

    it.each([
      ['NEWSLETTER_SEND_PER_HOUR', '0'],
      ['NEWSLETTER_SEND_PER_HOUR', 'eighty'],
      ['NEWSLETTER_SEND_PER_HOUR', '1.5'],
      ['NEWSLETTER_BATCH_SIZE', '0'],
      ['NEWSLETTER_BATCH_SIZE', '501'],
      ['NEWSLETTER_CONFIRM_MAX_PER_HOUR', '0'],
    ])('rejects %s=%s at boot rather than silently falling back', (name, value) => {
      expect(invalid({ [name]: value })).toThrow(new RegExp(name));
    });

    it('requires the confirm URL to be an http(s) URL, but lets it be blank (the default)', () => {
      expect(invalid({ NEWSLETTER_CONFIRM_URL_BASE: 'not a url' })).toThrow(/NEWSLETTER_CONFIRM_URL_BASE/);
      expect(invalid({ NEWSLETTER_CONFIRM_URL_BASE: 'ftp://imamzain.org/confirm' })).toThrow(/NEWSLETTER_CONFIRM_URL_BASE/);
      expect(() => valid({ NEWSLETTER_CONFIRM_URL_BASE: '' })).not.toThrow();
      expect(() => valid({ NEWSLETTER_CONFIRM_URL_BASE: 'http://localhost:3001/newsletter/confirm' })).not.toThrow();
    });
  });

  describe('campaign mailbox', () => {
    it('accepts a dedicated mailbox, and blank values (a template with empty lines)', () => {
      expect(() =>
        valid({
          CAMPAIGN_SMTP_HOST: 'smtp.example.com',
          CAMPAIGN_SMTP_PORT: '465',
          CAMPAIGN_SMTP_USER: 'newsletter@example.com',
          CAMPAIGN_SMTP_PASS: 'secret',
          CAMPAIGN_SMTP_SECURE: 'true',
          CAMPAIGN_EMAIL_FROM: 'Newsletter <newsletter@example.com>',
        }),
      ).not.toThrow();
      expect(() => valid({ CAMPAIGN_SMTP_HOST: '', CAMPAIGN_SMTP_SECURE: '', CAMPAIGN_EMAIL_FROM: '' })).not.toThrow();
    });

    it('CAMPAIGN_SMTP_SECURE must be the word the mailer actually understands', () => {
      expect(invalid({ CAMPAIGN_SMTP_SECURE: 'yes' })).toThrow(/CAMPAIGN_SMTP_SECURE/);
      expect(invalid({ CAMPAIGN_SMTP_SECURE: '1' })).toThrow(/CAMPAIGN_SMTP_SECURE/);
    });
  });

  describe('blank values', () => {
    it.each([
      'NEWSLETTER_SEND_PER_HOUR',
      'NEWSLETTER_BATCH_SIZE',
      'NEWSLETTER_CONFIRM_MAX_PER_HOUR',
      'CONTEST_THROTTLE_PER_IP',
      'CAMPAIGN_SMTP_PORT',
      'FORM_NOTIFY_MIN_INTERVAL_SECONDS',
    ])('%s="" means "not set" (a template line or an empty dashboard field), not 0', (name) => {
      const config = valid({ [name]: '' }) as unknown as Record<string, unknown>;

      expect(config[name]).toBeUndefined();
    });
  });

  describe('FORM_NOTIFY_MIN_INTERVAL_SECONDS', () => {
    it('allows 0 (no cool-down) up to a day', () => {
      expect(() => valid({ FORM_NOTIFY_MIN_INTERVAL_SECONDS: '0' })).not.toThrow();
      expect(() => valid({ FORM_NOTIFY_MIN_INTERVAL_SECONDS: '300' })).not.toThrow();
    });

    it.each(['-1', '86401', 'soon'])('rejects %p', (value) => {
      expect(invalid({ FORM_NOTIFY_MIN_INTERVAL_SECONDS: value })).toThrow(/FORM_NOTIFY_MIN_INTERVAL_SECONDS/);
    });
  });

  describe('contest', () => {
    it.each(['true', 'false', 'FALSE', '1', '0', 'yes', 'no', 'on', 'off', ''])('accepts CONTEST_REVEAL_SCORE=%p', (value) => {
      expect(() => valid({ CONTEST_REVEAL_SCORE: value })).not.toThrow();
    });

    it('rejects a typo in CONTEST_REVEAL_SCORE, which would otherwise quietly leave the score visible', () => {
      expect(invalid({ CONTEST_REVEAL_SCORE: 'flase' })).toThrow(/CONTEST_REVEAL_SCORE/);
    });

    it('bounds CONTEST_THROTTLE_PER_IP', () => {
      expect(() => valid({ CONTEST_THROTTLE_PER_IP: '60' })).not.toThrow();
      expect(invalid({ CONTEST_THROTTLE_PER_IP: '0' })).toThrow(/CONTEST_THROTTLE_PER_IP/);
      expect(invalid({ CONTEST_THROTTLE_PER_IP: '10001' })).toThrow(/CONTEST_THROTTLE_PER_IP/);
    });
  });

  describe('session and site settings', () => {
    it('bounds REFRESH_REUSE_GRACE_SECONDS to 0..60 and treats blank as unset', () => {
      expect(() => valid({ REFRESH_REUSE_GRACE_SECONDS: '0' })).not.toThrow();
      expect(() => valid({ REFRESH_REUSE_GRACE_SECONDS: '60' })).not.toThrow();
      expect(() => valid({ REFRESH_REUSE_GRACE_SECONDS: '' })).not.toThrow();
      expect(invalid({ REFRESH_REUSE_GRACE_SECONDS: '61' })).toThrow(/REFRESH_REUSE_GRACE_SECONDS/);
      expect(invalid({ REFRESH_REUSE_GRACE_SECONDS: '-1' })).toThrow(/REFRESH_REUSE_GRACE_SECONDS/);
      expect(invalid({ REFRESH_REUSE_GRACE_SECONDS: 'soon' })).toThrow(/REFRESH_REUSE_GRACE_SECONDS/);
    });

    it.each(['true', 'TRUE', 'false', ''])('accepts ENFORCE_PASSWORD_CHANGE_AFTER_RESET=%p', (value) => {
      expect(() => valid({ ENFORCE_PASSWORD_CHANGE_AFTER_RESET: value })).not.toThrow();
    });

    it('rejects a typo in ENFORCE_PASSWORD_CHANGE_AFTER_RESET instead of silently leaving enforcement off', () => {
      expect(invalid({ ENFORCE_PASSWORD_CHANGE_AFTER_RESET: 'ture' })).toThrow(/ENFORCE_PASSWORD_CHANGE_AFTER_RESET/);
      expect(invalid({ ENFORCE_PASSWORD_CHANGE_AFTER_RESET: '1' })).toThrow(/ENFORCE_PASSWORD_CHANGE_AFTER_RESET/);
    });

    it('accepts any SITE_TIMEZONE string (an unknown zone falls back at runtime, it never blocks boot)', () => {
      expect(() => valid({ SITE_TIMEZONE: 'Asia/Baghdad' })).not.toThrow();
      expect(() => valid({ SITE_TIMEZONE: 'Not/AZone' })).not.toThrow();
      expect(() => valid({ SITE_TIMEZONE: '' })).not.toThrow();
    });
  });
});
