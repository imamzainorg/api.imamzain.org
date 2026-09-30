import {
  canonicalContact,
  DEFAULT_CONTEST_THROTTLE_PER_IP,
  identityVariants,
  resolveContestThrottleLimit,
  scoreIsRevealed,
} from './contest.util';

describe('canonicalContact', () => {
  it('trims and lower-cases e-mail addresses', () => {
    expect(canonicalContact('email', '  Test@Example.COM ')).toBe('test@example.com');
  });

  it('removes spaces and dashes from phone numbers', () => {
    expect(canonicalContact('phone', '+964 780-123 4567')).toBe('+9647801234567');
  });

  it('folds the 00 international prefix into +, so both spellings are one identity', () => {
    expect(canonicalContact('phone', '00964 780 123 4567')).toBe('+9647801234567');
    expect(canonicalContact('phone', '00964 780 123 4567')).toBe(canonicalContact('phone', '+9647801234567'));
  });

  it('leaves a national-format number alone — there is no default country to assume', () => {
    expect(canonicalContact('phone', '0780 123 4567')).toBe('07801234567');
  });

  it('does not touch a 00 that is not at the start', () => {
    expect(canonicalContact('phone', '+96400123456')).toBe('+96400123456');
  });
});

describe('identityVariants', () => {
  it('looks for the legacy 00 form of a + number, which older rows still carry', () => {
    expect(identityVariants('phone', '+9647801234567')).toEqual(['+9647801234567', '009647801234567']);
  });

  it('has just the one form for a national-format number and for e-mail', () => {
    expect(identityVariants('phone', '07801234567')).toEqual(['07801234567']);
    expect(identityVariants('email', 'a@b.co')).toEqual(['a@b.co']);
  });
});

describe('scoreIsRevealed', () => {
  it('reveals by default, as it always has', () => {
    expect(scoreIsRevealed({})).toBe(true);
    expect(scoreIsRevealed({ CONTEST_REVEAL_SCORE: '' })).toBe(true);
    expect(scoreIsRevealed({ CONTEST_REVEAL_SCORE: 'true' })).toBe(true);
  });

  it.each(['false', 'FALSE', ' 0 ', 'no', 'Off'])('hides the score for %p', (raw) => {
    expect(scoreIsRevealed({ CONTEST_REVEAL_SCORE: raw })).toBe(false);
  });

  it('treats an unrecognised value as the default rather than silently hiding results', () => {
    expect(scoreIsRevealed({ CONTEST_REVEAL_SCORE: 'maybe' })).toBe(true);
  });
});

describe('resolveContestThrottleLimit', () => {
  it('defaults to a classroom-sized ceiling', () => {
    expect(resolveContestThrottleLimit({})).toBe(DEFAULT_CONTEST_THROTTLE_PER_IP);
    expect(DEFAULT_CONTEST_THROTTLE_PER_IP).toBeGreaterThan(20);
  });

  it('honours an explicit number', () => {
    expect(resolveContestThrottleLimit({ CONTEST_THROTTLE_PER_IP: '200' })).toBe(200);
  });

  it.each(['', 'lots', '0', '-5', '2.5', '99999'])('falls back to the default for %p', (raw) => {
    expect(resolveContestThrottleLimit({ CONTEST_THROTTLE_PER_IP: raw })).toBe(DEFAULT_CONTEST_THROTTLE_PER_IP);
  });
});
