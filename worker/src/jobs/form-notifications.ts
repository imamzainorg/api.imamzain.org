// Nest source: FormNotificationsService (src/forms/form-notifications.service.ts).
import type { PrismaClient } from '../generated/prisma/client';
import { escapeHtml, isMailConfigured, sanitizeHeaderValue, sendMail, type MailEnv } from '../lib/mail';

const DEFAULT_MIN_INTERVAL_SECONDS = 300;
/** Rows listed per form type in one digest; the rest are summarised as a count. */
const MAX_ROWS_LISTED = 25;
const MAX_ROWS_PER_TICK = 200;
/** A submission older than this is no longer announced, so an outage never ends in one giant stale digest. */
const PENDING_MAX_AGE_MS = 48 * 60 * 60 * 1000;
const NOTIFICATIONS_SETTING_KEY = 'notifications_email_to';
const SIMPLE_EMAIL = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;

export interface FormNotificationEnv extends MailEnv {
  EMAIL_TO?: string;
  FORM_NOTIFY_MIN_INTERVAL_SECONDS?: string;
}

export type OutboxResult = 'idle' | 'cooling-down' | 'unconfigured' | 'sent' | 'failed';

/**
 * Minimum gap between two notification e-mails (default 300 s). This, not a per-IP limit, is what bounds
 * the mail the public forms can cause: however many rows arrive, at most one message per window leaves.
 */
export function resolveNotifyIntervalMs(raw: string | undefined): number {
  const parsed = raw === undefined || raw === '' ? NaN : Number(raw);
  const seconds = Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_MIN_INTERVAL_SECONDS;
  return Math.floor(seconds * 1000);
}

interface ContactRow {
  name: string;
  email: string;
  country: string | null;
  message: string;
  submitted_at: Date;
}
interface VisitRow {
  name: string;
  phone: string | null;
  country: string | null;
  status: string;
  submitted_at: Date;
}

const CELL = 'style="border:1px solid #ccc;padding:6px;vertical-align:top"';

// Every cell is escaped: the form fields are attacker-controlled and would otherwise allow stored XSS or
// phishing injection in the admin's mail client.
function table(headers: string[], rows: string[][]): string {
  const head = headers.map((h) => `<th ${CELL}>${escapeHtml(h)}</th>`).join('');
  const body = rows.map((r) => `<tr>${r.map((c) => `<td ${CELL}>${escapeHtml(c)}</td>`).join('')}</tr>`).join('');
  return `<table cellspacing="0" style="border-collapse:collapse"><tr>${head}</tr>${body}</table>`;
}

const overflowNote = (total: number) => (total > MAX_ROWS_LISTED ? `<p>…and ${total - MAX_ROWS_LISTED} more — open the CMS to see them all.</p>` : '');

export function buildDigest(contacts: ContactRow[], visits: VisitRow[]): { subject: string; html: string; replyTo?: string } {
  const total = contacts.length + visits.length;
  const sections: string[] = [];

  if (contacts.length > 0) {
    sections.push(
      `<h2>Contact submissions (${contacts.length})</h2>` +
        table(
          ['Name', 'Email', 'Country', 'Submitted at', 'Message'],
          contacts.slice(0, MAX_ROWS_LISTED).map((c) => [c.name, c.email, c.country ?? '—', c.submitted_at.toISOString(), c.message]),
        ) +
        overflowNote(contacts.length),
    );
  }
  if (visits.length > 0) {
    sections.push(
      `<h2>Proxy visit requests (${visits.length})</h2>` +
        table(
          ['Name', 'Phone', 'Country', 'Status', 'Submitted at'],
          visits.slice(0, MAX_ROWS_LISTED).map((v) => [v.name, v.phone ?? '—', v.country ?? '—', v.status, v.submitted_at.toISOString()]),
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
 * Tells the admin team about new contact / proxy-visit submissions. Submissions wait with `notified_at IS NULL`
 * and this job drains them: one digest for everything pending, never more often than the cool-down. State
 * lives in the rows, so a failed send is simply retried on a later tick.
 */
export async function drainOutbox(db: PrismaClient, env: FormNotificationEnv, now = new Date()): Promise<OutboxResult> {
  const pendingWhere = {
    notified_at: null,
    deleted_at: null,
    submitted_at: { gte: new Date(now.getTime() - PENDING_MAX_AGE_MS) },
  };
  const [contacts, visits] = await Promise.all([
    db.contact_submissions.findMany({
      where: pendingWhere,
      orderBy: [{ submitted_at: 'asc' }, { id: 'asc' }],
      take: MAX_ROWS_PER_TICK,
      select: { id: true, name: true, email: true, country: true, message: true, submitted_at: true },
    }),
    db.proxy_visit_requests.findMany({
      where: pendingWhere,
      orderBy: [{ submitted_at: 'asc' }, { id: 'asc' }],
      take: MAX_ROWS_PER_TICK,
      select: { id: true, name: true, phone: true, country: true, status: true, submitted_at: true },
    }),
  ]);
  if (contacts.length === 0 && visits.length === 0) return 'idle';

  const contactIds = contacts.map((c) => c.id);
  const visitIds = visits.map((v) => v.id);

  const flagFailed = () =>
    db.$transaction([
      db.contact_submissions.updateMany({ where: { id: { in: contactIds }, notification_failed_at: null }, data: { notification_failed_at: now } }),
      db.proxy_visit_requests.updateMany({ where: { id: { in: visitIds }, notification_failed_at: null }, data: { notification_failed_at: now } }),
    ]);

  if (!isMailConfigured(env)) {
    // Keeps the dashboard's "unsent notifications" counter honest.
    await flagFailed();
    return 'unconfigured';
  }

  if (await isCoolingDown(db, env, now)) return 'cooling-down';

  const result = await sendMail(env, { to: await resolveRecipient(db, env), ...buildDigest(contacts, visits) });
  if (!result.ok) {
    console.warn(`Form notification digest not delivered (${result.error}), ${contactIds.length + visitIds.length} row(s) stay pending`);
    await flagFailed();
    return 'failed';
  }

  const delivered = { notified_at: now, notification_failed_at: null };
  await db.$transaction([
    db.contact_submissions.updateMany({ where: { id: { in: contactIds } }, data: delivered }),
    db.proxy_visit_requests.updateMany({ where: { id: { in: visitIds } }, data: delivered }),
  ]);
  console.log(`Form notification digest sent: ${contactIds.length} contact, ${visitIds.length} proxy visit`);
  return 'sent';
}

/** True while the last digest is more recent than the cool-down. */
async function isCoolingDown(db: PrismaClient, env: FormNotificationEnv, now: Date): Promise<boolean> {
  const intervalMs = resolveNotifyIntervalMs(env.FORM_NOTIFY_MIN_INTERVAL_SECONDS);
  if (intervalMs === 0) return false;
  const [c, v] = await Promise.all([db.contact_submissions.aggregate({ _max: { notified_at: true } }), db.proxy_visit_requests.aggregate({ _max: { notified_at: true } })]);
  const last = Math.max(c._max.notified_at?.getTime() ?? 0, v._max.notified_at?.getTime() ?? 0);
  return now.getTime() - last < intervalMs;
}

/** The `notifications_email_to` site setting (editable in the CMS) wins over EMAIL_TO; an empty or malformed value falls through. */
async function resolveRecipient(db: PrismaClient, env: FormNotificationEnv): Promise<string> {
  try {
    const setting = await db.site_settings.findUnique({ where: { key: NOTIFICATIONS_SETTING_KEY }, select: { value: true } });
    const value = setting?.value?.trim();
    if (value && SIMPLE_EMAIL.test(value)) return value;
  } catch (err) {
    console.warn(`Could not read ${NOTIFICATIONS_SETTING_KEY}: ${err}`);
  }
  return env.EMAIL_TO || 'info@imamzain.org';
}
