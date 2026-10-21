import { describe, expect, it, vi } from 'vitest';
import { buildConfirmationEmail } from '../src/features/newsletter/confirmation';
import { buildDigest } from '../src/jobs/form-notifications';
import { sendMail } from '../src/lib/mail';

describe('sendMail', () => {
  it('sends from the configured sender with the display name split out, and never throws', async () => {
    const send = vi.fn(async () => ({ messageId: 'm1' }));
    const ok = await sendMail({ EMAIL: { send } as unknown as SendEmail }, { to: 'a@example.com', subject: 'Hi\r\nBcc: x@example.com', html: '<p>Hello</p>', replyTo: 'b@example.com' });

    expect(ok).toEqual({ ok: true, messageId: 'm1' });
    expect(send).toHaveBeenCalledWith({
      from: { email: 'info@imamzain.org', name: 'imamzain.org' },
      to: 'a@example.com',
      subject: 'Hi  Bcc: x@example.com',
      html: '<p>Hello</p>',
      text: 'Hello',
      replyTo: 'b@example.com',
    });

    const failing = { send: vi.fn(async () => Promise.reject(Object.assign(new Error('not verified'), { code: 'E_SENDER_NOT_VERIFIED' }))) };
    expect(await sendMail({ EMAIL: failing as unknown as SendEmail }, { to: 'a@example.com', subject: 's', html: 'x' })).toEqual({
      ok: false,
      unconfigured: false,
      error: 'E_SENDER_NOT_VERIFIED: not verified',
    });
    expect(await sendMail({}, { to: 'a@example.com', subject: 's', html: 'x' })).toMatchObject({ ok: false, unconfigured: true });
  });
});

describe('buildDigest', () => {
  const now = new Date('2026-10-13T10:00:00Z');

  it('escapes every submitted field, so a form entry cannot inject markup into the admin mail', () => {
    const { html, subject, replyTo } = buildDigest(
      [{ name: '<script>alert(1)</script>\r\nBcc: evil@example.com', email: 'v@example.com', country: null, message: '<a href="https://evil.example">x</a>', submitted_at: now }],
      [],
    );
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<a href');
    expect(html).toContain('&lt;script&gt;');
    expect(subject).not.toMatch(/[\r\n]/);
    expect(replyTo).toBe('v@example.com');
  });
});

describe('buildConfirmationEmail', () => {
  it('keeps both links in the plain-text part and escapes them in the HTML part', () => {
    const confirm = 'https://imamzain.org/newsletter/confirm?email=a%40b.org&token=abc"def';
    const unsubscribe = 'https://imamzain.org/newsletter/unsubscribe?email=a%40b.org&token=xyz"123';
    const { html, text } = buildConfirmationEmail(confirm, unsubscribe);
    expect(text).toContain(confirm);
    expect(text).toContain(unsubscribe);
    expect(html).toContain('token=abc&quot;def');
    expect(html).toContain('token=xyz&quot;123');
    expect(html).not.toMatch(/abc"def|xyz"123/);
  });
});
