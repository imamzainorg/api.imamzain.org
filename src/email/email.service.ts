import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

/**
 * Two independent sending lanes:
 *
 * - `transactional` — mail somebody is waiting for: admin notifications about
 *   form submissions, newsletter double-opt-in confirmations. `SMTP_*`.
 * - `campaign` — bulk newsletter delivery. `CAMPAIGN_SMTP_*`, each value
 *   falling back to its `SMTP_*` counterpart.
 *
 * With only `SMTP_*` set both lanes share one transporter (the old behaviour).
 * Giving the campaign lane its own mailbox is what stops a burst on one lane
 * from exhausting the provider's quota for the other — Hostinger's published
 * limit for the shared mailbox is 500 messages/hour per mailbox and domain
 * (see delivery.util.ts's DEFAULT_SEND_PER_HOUR for the source and the
 * reasoning behind the campaign lane's actual pacing).
 */
export type EmailLane = 'transactional' | 'campaign';

export type EmailFailureKind =
  /** No SMTP settings for this lane — nothing was attempted. */
  | 'unconfigured'
  /** Worth retrying later: connection trouble, 4xx, quota / rate-limit replies, our own auth failing. */
  | 'transient'
  /** Retrying will not help: the address or the message itself was refused. */
  | 'permanent';

export type EmailSendResult =
  | { ok: true; messageId: string | null }
  | {
      ok: false;
      kind: EmailFailureKind;
      /**
       * True when the failure says something about OUR side — the server is
       * unreachable, our login is refused, the account is over quota — rather
       * than about this recipient. A bulk sender should stop and wait instead
       * of working through the list and charging every recipient an attempt.
       */
      systemic: boolean;
      error: string;
    };

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  /** Plain-text alternative; derived from `html` when omitted. */
  text?: string;
  replyTo?: string;
  headers?: Record<string, string>;
  /** Defaults to `transactional`. */
  lane?: EmailLane;
}

export function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function sanitizeHeaderValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  // Strip CR/LF to prevent header injection in mail subjects (and any other
  // header) even though nodemailer normally guards against this.
  return String(value).replace(/[\r\n]/g, ' ').trim();
}

/** Crude HTML → plain text for the text/plain alternative; links are dropped, so callers append any URL that must survive. */
export function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

const CONNECTION_ERROR_CODES = new Set([
  'ECONNECTION',
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'ESOCKET',
  'EDNS',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ETLS',
  'EPROTOCOL',
  'ESTREAM',
]);

// Replies that mean 'you, the SENDER, are sending too much' — whatever the code.
// Deliberately narrower than /quota|limit/: '552 mailbox full, quota exceeded'
// is about one recipient's inbox and must not pause the whole campaign.
const SENDER_LIMIT_REPLY =
  /rate.?limit|too many|throttl|sending (?:quota|limit|rate)|(?:daily|hourly|per[ -]?(?:hour|day|minute))[^.]{0,40}(?:quota|limit)|(?:quota|limit)[^.]{0,40}(?:daily|hourly|per[ -]?(?:hour|day|minute)|sending|messages|e-?mails)/i;
const RECIPIENT_MAILBOX_REPLY = /mailbox|inbox|storage/i;

export interface SmtpFailureClass {
  kind: Exclude<EmailFailureKind, 'unconfigured'>;
  systemic: boolean;
}

/**
 * Decide whether a failed SMTP send is worth retrying, and whether it is about
 * us or about the recipient. The campaign sender used to treat every failure as
 * final, so a provider hiccup — a timeout, greylisting, 'hourly quota exceeded'
 * — permanently failed whoever happened to be in that batch.
 *
 *   connection trouble, our login refused, quota replies → transient + systemic
 *   any other 4xx (greylisting, mailbox busy)             → transient, recipient
 *   any other 5xx, malformed address / message            → permanent, recipient
 */
export function classifySmtpError(err: unknown): SmtpFailureClass {
  const e = (err ?? {}) as { code?: unknown; responseCode?: unknown; response?: unknown; message?: unknown };
  const responseCode = typeof e.responseCode === 'number' ? e.responseCode : null;
  const text = `${typeof e.response === 'string' ? e.response : ''} ${typeof e.message === 'string' ? e.message : ''}`;
  const code = typeof e.code === 'string' ? e.code : '';

  // A 535 is a 5xx, but it is OUR login being refused — nothing about the
  // recipient. Must be decided before the reply-code rules below.
  if (code === 'EAUTH') return { kind: 'transient', systemic: true };

  if (responseCode !== null && responseCode >= 400) {
    // Some providers answer a quota / rate limit with a 5xx.
    if (SENDER_LIMIT_REPLY.test(text) && !RECIPIENT_MAILBOX_REPLY.test(text)) return { kind: 'transient', systemic: true };
    if (responseCode < 500) return { kind: 'transient', systemic: false };
    return { kind: 'permanent', systemic: false };
  }

  if (CONNECTION_ERROR_CODES.has(code)) return { kind: 'transient', systemic: true };
  // Rejected before / without an SMTP reply: a malformed address or message.
  if (code === 'EENVELOPE' || code === 'EMESSAGE') return { kind: 'permanent', systemic: false };

  // Unknown shape: retry, and assume it is not the recipient's doing. The
  // sender caps attempts and pauses on systemic failures, so this cannot loop.
  return { kind: 'transient', systemic: true };
}

interface LaneTransport {
  transporter: nodemailer.Transporter;
  from: string;
}

function smtpTransport(prefix: '' | 'CAMPAIGN_'): nodemailer.Transporter | null {
  // A campaign value falls back to the shared SMTP_* one, so an operator can
  // override just the mailbox (CAMPAIGN_SMTP_USER / CAMPAIGN_SMTP_PASS). A BLANK
  // value counts as unset (`||`, not `??`): a blank CAMPAIGN_SMTP_PORT copied
  // from a template would otherwise become port 0 instead of inheriting SMTP_PORT.
  const read = (name: string) => process.env[`${prefix}${name}`] || process.env[name];
  const host = read('SMTP_HOST');
  const user = read('SMTP_USER');
  const pass = read('SMTP_PASS');
  if (!host || !user || !pass) return null;

  const port = Number(read('SMTP_PORT') ?? 465);
  const secureRaw = read('SMTP_SECURE');
  return nodemailer.createTransport({
    host,
    port,
    // When SMTP_SECURE is set, honour it. Otherwise infer from the port:
    // 465 is implicit TLS (secure: true), everything else (587/STARTTLS,
    // 25) is secure: false. The previous unconditional `=== 'true'` paired
    // a default port of 465 with secure: false, so an operator who set only
    // host/user/pass got a plaintext greeting on an implicit-TLS port —
    // every send hung until socketTimeout (20s) and returned false.
    secure: secureRaw !== undefined ? secureRaw === 'true' : port === 465,
    auth: { user, pass },
    // Bound network waits so a hung SMTP server can't stall request handlers.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
}

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly lanes: Record<EmailLane, LaneTransport | null>;

  constructor() {
    // `||`: a blank EMAIL_FROM / CAMPAIGN_EMAIL_FROM must not become an empty From address.
    const defaultFrom = process.env.EMAIL_FROM || 'ImamZain.org <info@imamzain.org>';
    const shared = smtpTransport('');
    const hasOwnCampaignMailbox = Boolean(process.env.CAMPAIGN_SMTP_USER || process.env.CAMPAIGN_SMTP_HOST);
    const campaign = hasOwnCampaignMailbox ? smtpTransport('CAMPAIGN_') : shared;

    this.lanes = {
      transactional: shared ? { transporter: shared, from: defaultFrom } : null,
      campaign: campaign ? { transporter: campaign, from: process.env.CAMPAIGN_EMAIL_FROM || defaultFrom } : null,
    };

    if (!shared) this.logger.warn('SMTP not configured — email sending disabled');
    else if (hasOwnCampaignMailbox && campaign) this.logger.log('Newsletter campaigns use a dedicated SMTP mailbox');
  }

  isConfigured(lane: EmailLane = 'transactional'): boolean {
    return this.lanes[lane] !== null;
  }

  /** Send one message and say HOW it failed, so callers can retry sensibly. */
  async deliver(message: EmailMessage): Promise<EmailSendResult> {
    const lane = this.lanes[message.lane ?? 'transactional'];
    if (!lane) return { ok: false, kind: 'unconfigured', systemic: true, error: 'SMTP is not configured' };

    try {
      const info = await lane.transporter.sendMail({
        from: lane.from,
        to: message.to,
        subject: sanitizeHeaderValue(message.subject),
        html: message.html,
        text: message.text ?? stripHtml(message.html),
        replyTo: message.replyTo ? sanitizeHeaderValue(message.replyTo) : undefined,
        headers: message.headers,
      });
      this.logger.log(`Email sent: ${info.messageId}`);
      return { ok: true, messageId: info.messageId ?? null };
    } catch (err) {
      const { kind, systemic } = classifySmtpError(err);
      const error = err instanceof Error ? err.message : String(err);
      // The recipient is deliberately not logged: campaign sends would put the
      // whole subscriber list into the log stream.
      this.logger.error(`Email send failed (${kind}): ${error}`);
      return { ok: false, kind, systemic, error };
    }
  }

  /** Boolean convenience over `deliver()` on the transactional lane. */
  async send(to: string, subject: string, html: string, replyTo?: string): Promise<boolean> {
    return (await this.deliver({ to, subject, html, replyTo })).ok;
  }
}
