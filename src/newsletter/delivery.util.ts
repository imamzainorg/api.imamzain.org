import { BadRequestException } from '@nestjs/common';

/**
 * Tunables and pure rules for newsletter delivery. Kept out of the service so
 * the numbers that decide "how fast" and "how often" are unit-testable and
 * every one of them is documented in one place.
 */

export interface SenderConfig {
  /** Rolling-hour ceiling for delivered campaign mail across ALL campaigns. */
  perHour: number;
  /** Most recipients one cron tick may attempt (the tick still respects the hourly budget). */
  batchSize: number;
  /** Sends tried per recipient before a transient failure becomes final. */
  maxAttempts: number;
  /** How long a campaign stays paused after a systemic SMTP failure. */
  pauseMs: number;
}

/**
 * Hostinger's own published limit for the shared mailbox is 500 messages an
 * hour via SMTP, per mailbox and domain (see
 * https://www.hostinger.com/support/6550582-parameters-and-limits-of-hostinger-cpanel-email/
 * and https://www.hostinger.com/support/4625828-parameters-and-limits-of-hostinger-email/
 * — an earlier version of this code assumed ~100/hour, which was never
 * Hostinger's actual number, just an unverified guess). The default here stays
 * well under that ceiling for two reasons: Hostinger's own docs warn that its
 * anti-abuse system "may slow or temporarily block aggressive sending bursts"
 * even under the numeric cap, and the admin form digests and sign-up
 * confirmations share the same mailbox and must never be crowded out by a
 * campaign. 300/h leaves 200/h of headroom under the published limit — far
 * more than digests + confirmations use even on a busy day — while cutting a
 * 1,300-subscriber campaign from the old ~16h estimate to a bit over 4h. An
 * operator with a dedicated campaign mailbox (CAMPAIGN_SMTP_*) can raise
 * NEWSLETTER_SEND_PER_HOUR further; one sharing the transactional mailbox
 * should stay under 500 minus whatever headroom that mailbox's other traffic
 * needs.
 */
export const DEFAULT_SEND_PER_HOUR = 300;
export const DEFAULT_BATCH_SIZE = 10;
export const DEFAULT_MAX_ATTEMPTS = 5;
export const DEFAULT_PAUSE_MINUTES = 15;

function intFromEnv(raw: string | undefined, fallback: number, min: number, max: number): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) return fallback;
  return n;
}

export function resolveSenderConfig(env: NodeJS.ProcessEnv = process.env): SenderConfig {
  return {
    perHour: intFromEnv(env.NEWSLETTER_SEND_PER_HOUR, DEFAULT_SEND_PER_HOUR, 1, 100_000),
    batchSize: intFromEnv(env.NEWSLETTER_BATCH_SIZE, DEFAULT_BATCH_SIZE, 1, 500),
    maxAttempts: DEFAULT_MAX_ATTEMPTS,
    pauseMs: DEFAULT_PAUSE_MINUTES * 60_000,
  };
}

const RETRY_BASE_MS = 5 * 60_000;
const RETRY_CAP_MS = 2 * 3_600_000;

/**
 * Back-off before a transiently failed recipient may be tried again:
 * 5 min, 10, 20, 40 … capped at 2 h. `attempts` is the number of sends made so far.
 */
export function retryDelayMs(attempts: number): number {
  const exponent = Math.max(0, Math.min(attempts, 30) - 1);
  return Math.min(RETRY_BASE_MS * 2 ** exponent, RETRY_CAP_MS);
}

const ERROR_TEXT_MAX = 500;

/** Bound what is written to `error_message` / `last_error`; SMTP replies can be long. */
export function truncateError(text: string, max = ERROR_TEXT_MAX): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length <= max ? oneLine : `${oneLine.slice(0, max - 1)}…`;
}

// An ISO-8601 instant that says which time zone it is in. Without this a value
// such as "2026-06-01T09:00:00" is read in the SERVER's zone, so the same
// request schedules a different moment depending on where the API runs.
export const ISO_INSTANT_WITH_OFFSET =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(?:Z|[+-](\d{2}):(\d{2}))$/;

export const SCHEDULE_OFFSET_MESSAGE =
  'scheduled_at must be an ISO-8601 timestamp with an explicit UTC offset, e.g. 2026-06-01T09:00:00Z or 2026-06-01T12:00:00+03:00';

/**
 * `new Date()` silently rolls an impossible day over ("2026-02-31" becomes
 * 3 March, "T24:00" becomes the next midnight), so the components are checked
 * here rather than trusting the parse.
 */
function hasRealComponents(value: string): boolean {
  const m = ISO_INSTANT_WITH_OFFSET.exec(value);
  if (!m) return false;
  const [year, month, day, hour, minute] = [m[1], m[2], m[3], m[4], m[5]].map(Number);
  const second = m[6] === undefined ? 0 : Number(m[6]);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth) return false;
  if (hour > 23 || minute > 59 || second > 59) return false;
  if (m[7] !== undefined && (Number(m[7]) > 23 || Number(m[8]) > 59)) return false;
  return true;
}

/**
 * Validate a `scheduled_at` request value: explicit offset, real instant, in
 * the future. A value equal to the one already stored is accepted even when it
 * has since passed — the CMS re-sends the stored schedule on every save, and a
 * campaign that is merely overdue must stay editable.
 */
export function parseScheduledAt(
  value: string,
  options: { now?: Date; unchangedFrom?: Date | null } = {},
): Date {
  const now = options.now ?? new Date();
  if (!hasRealComponents(value)) throw new BadRequestException(SCHEDULE_OFFSET_MESSAGE);

  const at = new Date(value);
  if (Number.isNaN(at.getTime())) throw new BadRequestException(SCHEDULE_OFFSET_MESSAGE);

  if (options.unchangedFrom && options.unchangedFrom.getTime() === at.getTime()) return at;
  if (at.getTime() <= now.getTime()) {
    throw new BadRequestException('scheduled_at must be in the future');
  }
  return at;
}
