// Double opt-in confirmation: tunables and the e-mail itself (src/newsletter/confirmation.util.ts).
import { escapeHtml } from '../../lib/mail';

export const CONFIRM_TTL_HOURS = 72;

/**
 * Per-address resend cool-down. A second sign-up for the same address inside this window sends nothing,
 * so the form can't be used to flood a stranger's inbox.
 */
export const CONFIRM_RESEND_COOLDOWN_MS = 15 * 60_000;

/** Cap on confirmation mails claimed per rolling hour across ALL addresses. */
export const DEFAULT_CONFIRM_MAX_PER_HOUR = 30;

export const DEFAULT_CONFIRM_URL_BASE = 'https://imamzain.org/newsletter/confirm';
export const DEFAULT_UNSUBSCRIBE_URL_BASE = 'https://imamzain.org/newsletter/unsubscribe';

export function resolveConfirmConfig(env: {
  NEWSLETTER_CONFIRM_MAX_PER_HOUR?: string;
  NEWSLETTER_CONFIRM_URL_BASE?: string;
  NEWSLETTER_UNSUBSCRIBE_URL_BASE?: string;
}) {
  const raw = env.NEWSLETTER_CONFIRM_MAX_PER_HOUR;
  const parsed = raw === undefined || raw.trim() === '' ? NaN : Number(raw);
  const maxPerHour =
    Number.isInteger(parsed) && parsed >= 1 && parsed <= 10_000
      ? parsed
      : DEFAULT_CONFIRM_MAX_PER_HOUR;
  const urlBase = env.NEWSLETTER_CONFIRM_URL_BASE?.trim() || DEFAULT_CONFIRM_URL_BASE;
  const unsubscribeUrlBase =
    env.NEWSLETTER_UNSUBSCRIBE_URL_BASE?.trim() || DEFAULT_UNSUBSCRIBE_URL_BASE;
  return { maxPerHour, urlBase, unsubscribeUrlBase };
}

/** `<base>?email=…&token=…`: the page behind it POSTs both to /newsletter/confirm (or /newsletter/unsubscribe). */
export function confirmationUrl(base: string, email: string, token: string): string {
  const url = new URL(base);
  url.searchParams.set('email', email);
  url.searchParams.set('token', token);
  return url.toString();
}

/**
 * Arabic first with an English copy underneath. It names no one and says nothing about the state of the
 * address, so a stranger who typed someone else's e-mail learns nothing from it.
 */
export function buildConfirmationEmail(
  confirmUrl: string,
  unsubscribeUrl: string,
): { subject: string; html: string; text: string } {
  const href = escapeHtml(confirmUrl);
  const unsubHref = escapeHtml(unsubscribeUrl);

  const html = `
<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif;font-size:15px;line-height:1.9;text-align:right">
  <p>السلام عليكم ورحمة الله،</p>
  <p>وصلنا طلب لاشتراك هذا البريد في النشرة البريدية لموقع ImamZain.org. لإكمال الاشتراك يُرجى تأكيده بالضغط على الرابط التالي:</p>
  <p><a href="${href}" style="font-weight:bold">تأكيد الاشتراك</a></p>
  <p style="color:#666">إن لم تكن أنت من طلب ذلك فتجاهل هذه الرسالة، ولن يُضاف بريدك إلى القائمة. الرابط صالح لمدة ${CONFIRM_TTL_HOURS} ساعة.</p>
  <p style="color:#666">لإلغاء الاشتراك في أي وقت: <a href="${unsubHref}">إلغاء الاشتراك</a></p>
</div>
<hr style="margin:24px 0;border:none;border-top:1px solid #ddd"/>
<div dir="ltr" style="font-family:Arial,sans-serif;font-size:14px;line-height:1.7;text-align:left">
  <p>We received a request to subscribe this address to the ImamZain.org newsletter. To finish subscribing, please confirm:</p>
  <p><a href="${href}" style="font-weight:bold">Confirm subscription</a></p>
  <p style="color:#666">If you did not ask for this, just ignore this e-mail — you will not be subscribed. The link is valid for ${CONFIRM_TTL_HOURS} hours.</p>
  <p style="color:#666">To unsubscribe at any time: <a href="${unsubHref}">Unsubscribe</a></p>
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
    'لإلغاء الاشتراك في أي وقت:',
    unsubscribeUrl,
    '',
    '---',
    '',
    'We received a request to subscribe this address to the ImamZain.org newsletter. To finish subscribing, open:',
    confirmUrl,
    '',
    `If you did not ask for this, ignore this e-mail — you will not be subscribed. The link is valid for ${CONFIRM_TTL_HOURS} hours.`,
    '',
    'To unsubscribe at any time:',
    unsubscribeUrl,
  ].join('\n');

  return {
    subject: 'تأكيد الاشتراك في النشرة البريدية | Confirm your newsletter subscription',
    html,
    text,
  };
}
