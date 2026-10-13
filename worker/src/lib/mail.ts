// Outgoing mail through the Cloudflare Email Service binding (D1); src/email/email.service.ts used SMTP.

/** The display name is lower-case on purpose: that is how the sender should read in an inbox. */
export const DEFAULT_EMAIL_FROM = 'imamzain.org <info@imamzain.org>';

export interface MailEnv {
  /** Absent only where a test env or a Worker without the binding runs the code. */
  EMAIL?: SendEmail;
  EMAIL_FROM?: string;
}

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  /** Plain-text alternative; derived from `html` when omitted. */
  text?: string;
  replyTo?: string;
}

export type MailResult = { ok: true; messageId: string | null } | { ok: false; unconfigured: boolean; error: string };

export function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** CR/LF would let a form field start a new header line. */
export function sanitizeHeaderValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[\r\n]/g, ' ').trim();
}

/** Crude HTML to plain text; links are dropped, so callers pass `text` whenever a URL must survive. */
export function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

/** `Name <addr>` becomes the binding's `{ email, name }`; a bare address stays a string. */
export function parseSender(from: string): string | { email: string; name: string } {
  const m = /^\s*(.*?)\s*<([^<>]+)>\s*$/.exec(from);
  if (!m) return from.trim();
  const name = m[1].replace(/^"(.*)"$/, '$1');
  return name ? { email: m[2].trim(), name } : m[2].trim();
}

export const isMailConfigured = (env: MailEnv): boolean => Boolean(env.EMAIL);

/** Never throws: a failed send is a result the caller decides about. */
export async function sendMail(env: MailEnv, message: MailMessage): Promise<MailResult> {
  if (!env.EMAIL) return { ok: false, unconfigured: true, error: 'Email binding is not configured' };
  try {
    const sent = await env.EMAIL.send({
      from: parseSender(env.EMAIL_FROM || DEFAULT_EMAIL_FROM),
      to: message.to,
      subject: sanitizeHeaderValue(message.subject),
      html: message.html,
      text: message.text ?? stripHtml(message.html),
      ...(message.replyTo ? { replyTo: sanitizeHeaderValue(message.replyTo) } : {}),
    });
    return { ok: true, messageId: sent?.messageId ?? null };
  } catch (err) {
    // The recipient stays out of the log, as in Nest.
    const e = err as { code?: unknown; message?: unknown };
    const error = `${typeof e?.code === 'string' ? `${e.code}: ` : ''}${typeof e?.message === 'string' ? e.message : String(err)}`;
    return { ok: false, unconfigured: false, error };
  }
}
