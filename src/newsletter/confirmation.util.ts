import { escapeHtml } from '../email/email.service';

/**
 * Double opt-in confirmation: tunables and the e-mail itself. Pure and free of
 * Nest/Prisma so the wording, the URL and the limits are unit-testable.
 */

/** How long a confirmation link stays valid after it was issued. */
export const CONFIRM_TTL_HOURS = 72;
export const CONFIRM_TTL_MS = CONFIRM_TTL_HOURS * 3_600_000;

/**
 * Per-address resend cool-down. A second sign-up for the same address inside
 * this window sends nothing — otherwise anyone could use the form to flood a
 * stranger's inbox with confirmation mail.
 */
export const CONFIRM_RESEND_COOLDOWN_MS = 15 * 60_000;

/**
 * Cap on confirmation mails claimed per rolling hour across ALL addresses.
 * They share the transactional mailbox with the admin form digests, whose quota
 * (~100/h on the shared Hostinger account) a burst of sign-ups must not eat.
 */
export const DEFAULT_CONFIRM_MAX_PER_HOUR = 30;

export const DEFAULT_CONFIRM_URL_BASE = 'https://imamzain.org/newsletter/confirm';

export interface ConfirmConfig {
  maxPerHour: number;
  urlBase: string;
}

export function resolveConfirmConfig(env: NodeJS.ProcessEnv = process.env): ConfirmConfig {
  const raw = env.NEWSLETTER_CONFIRM_MAX_PER_HOUR;
  const parsed = raw === undefined || raw.trim() === '' ? NaN : Number(raw);
  const maxPerHour =
    Number.isInteger(parsed) && parsed >= 1 && parsed <= 10_000 ? parsed : DEFAULT_CONFIRM_MAX_PER_HOUR;
  const urlBase = env.NEWSLETTER_CONFIRM_URL_BASE?.trim() || DEFAULT_CONFIRM_URL_BASE;
  return { maxPerHour, urlBase };
}

/** `<base>?email=…&token=…` — the page behind it POSTs both to /newsletter/confirm. */
export function confirmationUrl(base: string, email: string, token: string): string {
  const url = new URL(base);
  url.searchParams.set('email', email);
  url.searchParams.set('token', token);
  return url.toString();
}

export interface ConfirmationEmail {
  subject: string;
  html: string;
  text: string;
}

/**
 * The confirmation message, Arabic first with an English copy underneath. It
 * names no one and says nothing about the state of the address, so a stranger
 * who typed someone else's e-mail learns nothing from it and the owner is told
 * plainly that ignoring it changes nothing.
 */
export function buildConfirmationEmail(confirmUrl: string): ConfirmationEmail {
  const href = escapeHtml(confirmUrl);

  const html = `
<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif;font-size:15px;line-height:1.9;text-align:right">
  <p>السلام عليكم ورحمة الله،</p>
  <p>وصلنا طلب لاشتراك هذا البريد في النشرة البريدية لموقع ImamZain.org. لإكمال الاشتراك يُرجى تأكيده بالضغط على الرابط التالي:</p>
  <p><a href="${href}" style="font-weight:bold">تأكيد الاشتراك</a></p>
  <p style="color:#666">إن لم تكن أنت من طلب ذلك فتجاهل هذه الرسالة، ولن يُضاف بريدك إلى القائمة. الرابط صالح لمدة ${CONFIRM_TTL_HOURS} ساعة.</p>
</div>
<hr style="margin:24px 0;border:none;border-top:1px solid #ddd"/>
<div dir="ltr" style="font-family:Arial,sans-serif;font-size:14px;line-height:1.7;text-align:left">
  <p>We received a request to subscribe this address to the ImamZain.org newsletter. To finish subscribing, please confirm:</p>
  <p><a href="${href}" style="font-weight:bold">Confirm subscription</a></p>
  <p style="color:#666">If you did not ask for this, just ignore this e-mail — you will not be subscribed. The link is valid for ${CONFIRM_TTL_HOURS} hours.</p>
</div>`.trim();

  // The default text part drops every link; a confirmation without its link is useless.
  const text = [
    'السلام عليكم ورحمة الله،',
    '',
    'وصلنا طلب لاشتراك هذا البريد في النشرة البريدية لموقع ImamZain.org. لإكمال الاشتراك افتح الرابط التالي:',
    confirmUrl,
    '',
    `إن لم تكن أنت من طلب ذلك فتجاهل هذه الرسالة. الرابط صالح لمدة ${CONFIRM_TTL_HOURS} ساعة.`,
    '',
    '---',
    '',
    'We received a request to subscribe this address to the ImamZain.org newsletter. To finish subscribing, open:',
    confirmUrl,
    '',
    `If you did not ask for this, ignore this e-mail — you will not be subscribed. The link is valid for ${CONFIRM_TTL_HOURS} hours.`,
  ].join('\n');

  return {
    subject: 'تأكيد الاشتراك في النشرة البريدية | Confirm your newsletter subscription',
    html,
    text,
  };
}
