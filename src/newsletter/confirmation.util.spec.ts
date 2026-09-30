import {
  buildConfirmationEmail,
  CONFIRM_TTL_HOURS,
  confirmationUrl,
  DEFAULT_CONFIRM_MAX_PER_HOUR,
  DEFAULT_CONFIRM_URL_BASE,
  resolveConfirmConfig,
} from './confirmation.util';

describe('resolveConfirmConfig', () => {
  it('defaults to a cap that leaves room in the shared mailbox and the public confirm page', () => {
    expect(resolveConfirmConfig({})).toEqual({
      maxPerHour: DEFAULT_CONFIRM_MAX_PER_HOUR,
      urlBase: DEFAULT_CONFIRM_URL_BASE,
    });
  });

  it('honours explicit values', () => {
    expect(
      resolveConfirmConfig({
        NEWSLETTER_CONFIRM_MAX_PER_HOUR: '12',
        NEWSLETTER_CONFIRM_URL_BASE: ' https://staging.imamzain.org/newsletter/confirm ',
      }),
    ).toEqual({ maxPerHour: 12, urlBase: 'https://staging.imamzain.org/newsletter/confirm' });
  });

  it.each(['', 'many', '0', '-1', '2.5', '99999'])('falls back to the default cap for %p', (raw) => {
    expect(resolveConfirmConfig({ NEWSLETTER_CONFIRM_MAX_PER_HOUR: raw }).maxPerHour).toBe(
      DEFAULT_CONFIRM_MAX_PER_HOUR,
    );
  });
});

describe('confirmationUrl', () => {
  it('appends the address and token as query parameters, encoded', () => {
    const url = new URL(confirmationUrl('https://imamzain.org/newsletter/confirm', 'a+b@example.com', 'ab12'));

    expect(url.origin + url.pathname).toBe('https://imamzain.org/newsletter/confirm');
    expect(url.searchParams.get('email')).toBe('a+b@example.com');
    expect(url.searchParams.get('token')).toBe('ab12');
  });

  it('keeps existing query parameters of the base', () => {
    const url = new URL(confirmationUrl('https://imamzain.org/ar/confirm?lang=ar', 'x@y.z', 't'));

    expect(url.searchParams.get('lang')).toBe('ar');
    expect(url.searchParams.get('token')).toBe('t');
  });

  it('throws on a malformed base, which the caller must handle', () => {
    expect(() => confirmationUrl('not a url', 'x@y.z', 't')).toThrow();
  });
});

describe('buildConfirmationEmail', () => {
  const link = 'https://imamzain.org/newsletter/confirm?email=x%40y.z&token=abc&x=1';

  it('has a bilingual subject with no line breaks', () => {
    const { subject } = buildConfirmationEmail(link);

    expect(subject).toContain('تأكيد');
    expect(subject).toContain('Confirm');
    expect(subject).not.toMatch(/[\r\n]/);
  });

  it('carries the link in both the HTML (escaped) and the plain-text part', () => {
    const { html, text } = buildConfirmationEmail(link);

    expect(html).toContain('href="https://imamzain.org/newsletter/confirm?email=x%40y.z&amp;token=abc&amp;x=1"');
    expect(text).toContain(link);
  });

  it('cannot be turned into markup by a hostile link', () => {
    const { html } = buildConfirmationEmail('https://x.test/"><script>steal()</script>');

    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('tells the reader that ignoring it changes nothing, and how long the link lasts', () => {
    const { html, text } = buildConfirmationEmail(link);

    expect(html).toMatch(/ignore this e-mail/i);
    expect(html).toContain(`${CONFIRM_TTL_HOURS} hours`);
    expect(text).toContain(`${CONFIRM_TTL_HOURS} hours`);
    expect(html).toContain('dir="rtl"');
  });
});
