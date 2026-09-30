import { BadRequestException } from '@nestjs/common';
import {
  DEFAULT_BATCH_SIZE,
  DEFAULT_SEND_PER_HOUR,
  parseScheduledAt,
  resolveSenderConfig,
  retryDelayMs,
  truncateError,
} from './delivery.util';

const NOW = new Date('2026-09-17T12:00:00.000Z');

describe('resolveSenderConfig', () => {
  it('defaults to a budget that leaves headroom under the shared mailbox quota', () => {
    const config = resolveSenderConfig({});

    expect(config).toEqual({
      perHour: DEFAULT_SEND_PER_HOUR,
      batchSize: DEFAULT_BATCH_SIZE,
      maxAttempts: 5,
      pauseMs: 15 * 60_000,
    });
    // Under Hostinger's published 500/h-per-mailbox limit, with headroom left
    // for the admin digests and confirmation mails that share the mailbox.
    expect(config.perHour).toBeLessThan(500);
    expect(config.perHour).toBeGreaterThan(100);
  });

  it('honours explicit numbers', () => {
    const config = resolveSenderConfig({ NEWSLETTER_SEND_PER_HOUR: '400', NEWSLETTER_BATCH_SIZE: '25' });

    expect(config.perHour).toBe(400);
    expect(config.batchSize).toBe(25);
  });

  it.each(['', '  ', 'lots', '0', '-3', '1.5', '999999'])('falls back to the default for %p', (raw) => {
    const config = resolveSenderConfig({ NEWSLETTER_SEND_PER_HOUR: raw, NEWSLETTER_BATCH_SIZE: raw });

    expect(config.perHour).toBe(DEFAULT_SEND_PER_HOUR);
    expect(config.batchSize).toBe(DEFAULT_BATCH_SIZE);
  });
});

describe('retryDelayMs', () => {
  it('doubles from five minutes', () => {
    expect([1, 2, 3, 4].map(retryDelayMs)).toEqual([5, 10, 20, 40].map((m) => m * 60_000));
  });

  it('never exceeds two hours, however many attempts', () => {
    expect(retryDelayMs(6)).toBe(2 * 3_600_000);
    expect(retryDelayMs(500)).toBe(2 * 3_600_000);
  });

  it('treats a zero or negative attempt count as the first', () => {
    expect(retryDelayMs(0)).toBe(5 * 60_000);
    expect(retryDelayMs(-4)).toBe(5 * 60_000);
  });
});

describe('truncateError', () => {
  it('collapses whitespace so a multi-line SMTP reply is one log-friendly line', () => {
    expect(truncateError('550 5.1.1\r\n  user unknown')).toBe('550 5.1.1 user unknown');
  });

  it('bounds the length with an ellipsis', () => {
    const out = truncateError('x'.repeat(2_000), 100);

    expect(out).toHaveLength(100);
    expect(out.endsWith('…')).toBe(true);
  });
});

describe('parseScheduledAt', () => {
  it('accepts a future instant with a Z or a numeric offset and returns the same moment', () => {
    expect(parseScheduledAt('2026-09-18T09:00:00Z', { now: NOW }).toISOString()).toBe('2026-09-18T09:00:00.000Z');
    expect(parseScheduledAt('2026-09-18T12:00:00+03:00', { now: NOW }).toISOString()).toBe('2026-09-18T09:00:00.000Z');
    expect(parseScheduledAt('2026-09-18T09:00:00.250Z', { now: NOW }).getUTCMilliseconds()).toBe(250);
  });

  it.each([
    ['no offset (would be read in the server zone)', '2026-09-18T09:00:00'],
    ['date only', '2026-09-18'],
    ['a space instead of T', '2026-09-18 09:00:00Z'],
    ['free text', 'tomorrow morning'],
    ['an impossible calendar day', '2026-02-31T09:00:00Z'],
    ['hour 24 (rolls over to the next day)', '2026-09-18T24:00:00Z'],
    ['an impossible offset', '2026-09-18T09:00:00+25:00'],
  ])('rejects %s', (_label, value) => {
    expect(() => parseScheduledAt(value, { now: NOW })).toThrow(BadRequestException);
  });

  it('rejects a moment that has already passed, and "right now"', () => {
    expect(() => parseScheduledAt('2026-09-17T11:59:59Z', { now: NOW })).toThrow('in the future');
    expect(() => parseScheduledAt(NOW.toISOString(), { now: NOW })).toThrow('in the future');
  });

  it('accepts a value identical to the stored schedule even after it has passed', () => {
    const stored = new Date('2026-09-17T08:00:00.000Z');

    expect(parseScheduledAt('2026-09-17T08:00:00Z', { now: NOW, unchangedFrom: stored })).toEqual(stored);
    // ... but only the SAME instant: moving it to another past time is still refused.
    expect(() => parseScheduledAt('2026-09-17T09:00:00Z', { now: NOW, unchangedFrom: stored })).toThrow(
      'in the future',
    );
  });
});
