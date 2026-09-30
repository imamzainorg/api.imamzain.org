/**
 * Small pure rules for the Qutuf contest, kept apart from the service so they
 * can be unit-tested without a database.
 */

export type ContactType = 'phone' | 'email';

/**
 * The stored / compared form of a participant's contact. Both the "have they
 * already taken part?" check and the value written to the partial unique index
 * use it, so variants of one person collapse to one identity:
 *
 *   e-mail  trimmed and lower-cased
 *   phone   spaces and dashes removed, and the international call prefix "00"
 *           folded into "+" — 00964 780 123 4567 and +9647801234567 are the same
 *           number, and the difference used to let one person take part twice.
 *
 * A leading national "0" is deliberately NOT rewritten to a country code: the
 * contest is open worldwide, so there is no default country to assume, and a
 * wrong guess would corrupt the number the committee later calls.
 */
export function canonicalContact(contactType: ContactType, raw: string): string {
  if (contactType === 'email') return raw.trim().toLowerCase();
  const compact = raw.replace(/[\s-]/g, '');
  return compact.startsWith('00') ? `+${compact.slice(2)}` : compact;
}

/**
 * Every stored form the same identity might already be in. Rows written before
 * "00" was folded into "+" still carry the "00" form, so the duplicate check has
 * to look for both — the unique index only ever sees the exact value.
 */
export function identityVariants(contactType: ContactType, canonical: string): string[] {
  if (contactType === 'phone' && canonical.startsWith('+')) return [canonical, `00${canonical.slice(1)}`];
  return [canonical];
}

const OFF_VALUES = new Set(['false', '0', 'no', 'off']);

/**
 * Whether POST /submit tells the participant their score. Default: yes (the
 * historical behaviour). With CONTEST_REVEAL_SCORE=false the response carries
 * `final_score: null` and the committee announces results itself.
 *
 * Why it exists: an instant score for an unverified identity is an oracle. Anyone
 * can open as many identities as they like (an e-mail address costs nothing), try
 * different answers on each, read the score back, and so work out the answer key
 * and file a perfect score. A contest with a prize should switch the reveal off.
 */
export function scoreIsRevealed(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.CONTEST_REVEAL_SCORE?.trim().toLowerCase();
  return raw === undefined || raw === '' || !OFF_VALUES.has(raw);
}

/**
 * Per-IP ceiling on /start and /submit per 15 minutes. Classrooms and events put
 * many genuine participants behind ONE NAT'd address, so it has to be generous;
 * what it must still stop is row-spam and answer-key probing from a single client.
 */
export const DEFAULT_CONTEST_THROTTLE_PER_IP = 60;

export function resolveContestThrottleLimit(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.CONTEST_THROTTLE_PER_IP;
  if (raw === undefined || raw.trim() === '') return DEFAULT_CONTEST_THROTTLE_PER_IP;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 10_000 ? parsed : DEFAULT_CONTEST_THROTTLE_PER_IP;
}
