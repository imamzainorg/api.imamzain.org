import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { contact_submissions, proxy_visit_requests } from '@prisma/client';
import { EmailService, escapeHtml, sanitizeHeaderValue } from '../email/email.service';
import { PrismaService } from '../prisma/prisma.service';
import { ADVISORY_LOCK_KEYS, withAdvisoryLock } from '../common/utils/advisory-lock.util';
import { cronsDisabled } from '../common/utils/cron.util';

const DEFAULT_MIN_INTERVAL_SECONDS = 300;
/** Rows listed per form type in one digest; the rest are summarised as a count. */
const MAX_ROWS_LISTED = 25;
/** Rows fetched per form type per tick. */
const MAX_ROWS_PER_TICK = 200;
/**
 * A submission older than this is no longer announced. Stops a long SMTP
 * outage (or a host that never had SMTP configured) from ending in one giant
 * digest of stale rows the day mail starts working.
 */
const PENDING_MAX_AGE_MS = 48 * 60 * 60 * 1000;
const NOTIFICATIONS_SETTING_KEY = 'notifications_email_to';
const SIMPLE_EMAIL = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;

/**
 * Minimum gap between two notification e-mails (`FORM_NOTIFY_MIN_INTERVAL_SECONDS`,
 * default 300). This — not a per-IP limit — is what bounds the mail the public
 * forms can cause: however many rows arrive, at most one message per window
 * leaves the shared mailbox (12 an hour by default).
 */
export function resolveNotifyIntervalMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.FORM_NOTIFY_MIN_INTERVAL_SECONDS;
  const parsed = raw === undefined || raw === '' ? NaN : Number(raw);
  const seconds = Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_MIN_INTERVAL_SECONDS;
  return Math.floor(seconds * 1000);
}

type ContactRow = Pick<contact_submissions, 'id' | 'name' | 'email' | 'country' | 'message' | 'submitted_at'>;
type VisitRow = Pick<proxy_visit_requests, 'id' | 'name' | 'phone' | 'country' | 'status' | 'submitted_at'>;

export type OutboxResult = 'idle' | 'cooling-down' | 'unconfigured' | 'sent' | 'failed';

const CELL = 'style="border:1px solid #ccc;padding:6px;vertical-align:top"';

function table(headers: string[], rows: string[][]): string {
  const head = headers.map((h) => `<th ${CELL}>${escapeHtml(h)}</th>`).join('');
  // Every cell is HTML-escaped: the form fields are attacker-controlled and
  // would otherwise allow stored XSS / phishing injection in the admin's
  // mail client.
  const body = rows.map((r) => `<tr>${r.map((c) => `<td ${CELL}>${escapeHtml(c)}</td>`).join('')}</tr>`).join('');
  return `<table cellspacing="0" style="border-collapse:collapse"><tr>${head}</tr>${body}</table>`;
}

function overflowNote(total: number): string {
  return total > MAX_ROWS_LISTED
    ? `<p>…and ${total - MAX_ROWS_LISTED} more — open the CMS to see them all.</p>`
    : '';
}

export function buildDigest(contacts: ContactRow[], visits: VisitRow[]): { subject: string; html: string; replyTo?: string } {
  const total = contacts.length + visits.length;
  const sections: string[] = [];

  if (contacts.length > 0) {
    sections.push(
      `<h2>Contact submissions (${contacts.length})</h2>` +
        table(
          ['Name', 'Email', 'Country', 'Submitted at', 'Message'],
          contacts
            .slice(0, MAX_ROWS_LISTED)
            .map((c) => [c.name, c.email, c.country ?? '—', c.submitted_at.toISOString(), c.message]),
        ) +
        overflowNote(contacts.length),
    );
  }
  if (visits.length > 0) {
    sections.push(
      `<h2>Proxy visit requests (${visits.length})</h2>` +
        table(
          ['Name', 'Phone', 'Country', 'Status', 'Submitted at'],
          visits
            .slice(0, MAX_ROWS_LISTED)
            .map((v) => [v.name, v.phone ?? '—', v.country ?? '—', v.status, v.submitted_at.toISOString()]),
        ) +
        overflowNote(visits.length),
    );
  }

  let subject: string;
  if (total === 1 && contacts.length === 1) subject = `New contact submission — ${sanitizeHeaderValue(contacts[0].name)}`;
  else if (total === 1) subject = `New proxy visit request — ${sanitizeHeaderValue(visits[0].name)}`;
  else subject = `${total} new form submissions (${contacts.length} contact, ${visits.length} proxy visit)`;

  return {
    subject,
    html: sections.join(''),
    // Replying to a lone contact message should reach the visitor, not info@.
    replyTo: total === 1 && contacts.length === 1 ? contacts[0].email : undefined,
  };
}

/**
 * Tells the admin team about new contact / proxy-visit submissions.
 *
 * Submissions are NOT mailed inline any more. They wait with
 * `notified_at IS NULL` and this cron drains them: one digest for everything
 * pending, never more often than the cool-down. A lone submission still goes
 * out within a minute; a flood becomes one message per window instead of one
 * per row. State lives in the rows, so a restart loses nothing and a failed
 * send is simply retried on a later tick.
 */
@Injectable()
export class FormNotificationsService {
  private readonly logger = new Logger(FormNotificationsService.name);
  private isRunning = false;
  // A failed send leaves notified_at untouched, so the DB-derived cool-down
  // alone would retry every minute for as long as SMTP is down.
  private lastFailureAt = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async runNotificationTick(): Promise<void> {
    if (cronsDisabled() || this.isRunning) return;
    this.isRunning = true;
    try {
      // Every replica runs this cron; only one may send a given digest.
      await withAdvisoryLock(this.prisma, ADVISORY_LOCK_KEYS.FORM_NOTIFICATIONS, async () => {
        await this.drainOutbox();
      });
    } catch (err) {
      this.logger.error(`Form notification tick failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      this.isRunning = false;
    }
  }

  async drainOutbox(now: Date = new Date()): Promise<OutboxResult> {
    const pendingWhere = {
      notified_at: null,
      deleted_at: null,
      submitted_at: { gte: new Date(now.getTime() - PENDING_MAX_AGE_MS) },
    };

    const [contacts, visits] = await Promise.all([
      this.prisma.contact_submissions.findMany({
        where: pendingWhere,
        orderBy: [{ submitted_at: 'asc' }, { id: 'asc' }],
        take: MAX_ROWS_PER_TICK,
        select: { id: true, name: true, email: true, country: true, message: true, submitted_at: true },
      }),
      this.prisma.proxy_visit_requests.findMany({
        where: pendingWhere,
        orderBy: [{ submitted_at: 'asc' }, { id: 'asc' }],
        take: MAX_ROWS_PER_TICK,
        select: { id: true, name: true, phone: true, country: true, status: true, submitted_at: true },
      }),
    ]);
    if (contacts.length === 0 && visits.length === 0) return 'idle';

    const contactIds = contacts.map((c) => c.id);
    const visitIds = visits.map((v) => v.id);

    if (!this.email.isConfigured()) {
      // Keep the dashboard's "unsent notifications" counter honest.
      await this.flagFailed(contactIds, visitIds, now);
      return 'unconfigured';
    }

    if (await this.isCoolingDown(now)) return 'cooling-down';

    const digest = buildDigest(contacts, visits);
    const result = await this.email.deliver({ to: await this.resolveRecipient(), ...digest });

    if (!result.ok) {
      this.logger.warn(`Form notification digest not delivered (${result.kind}) — ${contactIds.length + visitIds.length} row(s) stay pending`);
      this.lastFailureAt = now.getTime();
      await this.flagFailed(contactIds, visitIds, now);
      return 'failed';
    }

    const delivered = { notified_at: now, notification_failed_at: null };
    await this.prisma.$transaction([
      this.prisma.contact_submissions.updateMany({ where: { id: { in: contactIds } }, data: delivered }),
      this.prisma.proxy_visit_requests.updateMany({ where: { id: { in: visitIds } }, data: delivered }),
    ]);
    this.logger.log(`Form notification digest sent: ${contactIds.length} contact, ${visitIds.length} proxy visit`);
    return 'sent';
  }

  /** True while the last digest is more recent than the cool-down. */
  private async isCoolingDown(now: Date): Promise<boolean> {
    const intervalMs = resolveNotifyIntervalMs();
    if (intervalMs === 0) return false;
    if (now.getTime() - this.lastFailureAt < intervalMs) return true;

    const [c, v] = await Promise.all([
      this.prisma.contact_submissions.aggregate({ _max: { notified_at: true } }),
      this.prisma.proxy_visit_requests.aggregate({ _max: { notified_at: true } }),
    ]);
    const last = Math.max(c._max.notified_at?.getTime() ?? 0, v._max.notified_at?.getTime() ?? 0);
    return now.getTime() - last < intervalMs;
  }

  private async flagFailed(contactIds: string[], visitIds: string[], now: Date): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.contact_submissions.updateMany({
        where: { id: { in: contactIds }, notification_failed_at: null },
        data: { notification_failed_at: now },
      }),
      this.prisma.proxy_visit_requests.updateMany({
        where: { id: { in: visitIds }, notification_failed_at: null },
        data: { notification_failed_at: now },
      }),
    ]);
  }

  /**
   * The `notifications_email_to` site setting (editable in the CMS) wins over
   * the EMAIL_TO env var, as the setting's own description has always said.
   * An empty or malformed value falls through to the env / default.
   */
  private async resolveRecipient(): Promise<string> {
    try {
      const setting = await this.prisma.site_settings.findUnique({
        where: { key: NOTIFICATIONS_SETTING_KEY },
        select: { value: true },
      });
      const value = setting?.value?.trim();
      if (value && SIMPLE_EMAIL.test(value)) return value;
    } catch (err) {
      this.logger.warn(`Could not read ${NOTIFICATIONS_SETTING_KEY}: ${err}`);
    }
    return process.env.EMAIL_TO ?? 'info@imamzain.org';
  }
}
