import {
  isPasswordChangeEnforced,
  isPasswordChangeExemptPath,
  resolveRefreshReuseGraceMs,
} from './auth-config.util';

describe('resolveRefreshReuseGraceMs', () => {
  const graceFor = (value?: string) => resolveRefreshReuseGraceMs({ REFRESH_REUSE_GRACE_SECONDS: value });

  it('defaults to 10 seconds when unset or blank', () => {
    expect(graceFor(undefined)).toBe(10_000);
    expect(graceFor('')).toBe(10_000);
    expect(graceFor('   ')).toBe(10_000);
  });

  it('falls back to the default for a non-numeric value', () => {
    expect(graceFor('ten')).toBe(10_000);
    expect(graceFor('NaN')).toBe(10_000);
  });

  it('uses a valid value as given', () => {
    expect(graceFor('3')).toBe(3_000);
    expect(graceFor('60')).toBe(60_000);
  });

  it('clamps to 0..60', () => {
    expect(graceFor('600')).toBe(60_000);
    expect(graceFor('-5')).toBe(0);
  });

  it('0 disables the grace', () => {
    expect(graceFor('0')).toBe(0);
  });

  it('rounds a fractional value down to whole seconds', () => {
    expect(graceFor('2.9')).toBe(2_000);
  });
});

describe('isPasswordChangeEnforced', () => {
  const flag = (value?: string) => isPasswordChangeEnforced({ ENFORCE_PASSWORD_CHANGE_AFTER_RESET: value });

  it('is off by default', () => {
    expect(flag(undefined)).toBe(false);
    expect(flag('')).toBe(false);
    expect(flag('false')).toBe(false);
  });

  it('is on only for the word true (case- and space-insensitive)', () => {
    expect(flag('true')).toBe(true);
    expect(flag(' TRUE ')).toBe(true);
    expect(flag('1')).toBe(false);
    expect(flag('yes')).toBe(false);
  });
});

describe('isPasswordChangeExemptPath', () => {
  it.each([
    '/api/v1/auth/me',
    '/api/v1/auth/me/',
    '/api/v1/auth/me?x=1',
    '/api/v1/auth/me/password',
    '/api/v1/auth/logout',
    '/api/v1/auth/refresh',
    '/auth/me',
    '/API/V1/AUTH/ME',
  ])('exempts %s', (path) => {
    expect(isPasswordChangeExemptPath(path)).toBe(true);
  });

  it.each([
    '/api/v1/posts',
    '/api/v1/users',
    '/api/v1/users/abc/auth/me',
    '/api/v1/auth/me/other',
    '/api/v1/auth/login',
    '/api/v1/auth/me/password/extra',
    '/api/v1/auth',
    '',
  ])('does not exempt %s', (path) => {
    expect(isPasswordChangeExemptPath(path)).toBe(false);
  });

  it('does not exempt an undefined url', () => {
    expect(isPasswordChangeExemptPath(undefined)).toBe(false);
  });
});
