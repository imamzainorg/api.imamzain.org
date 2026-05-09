import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sanitizeHeaderValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  // Strip CR/LF to prevent header injection in mail subjects (and any other
  // header) even though nodemailer normally guards against this.
  return String(value).replace(/[\r\n]/g, ' ').trim();
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private transporter: nodemailer.Transporter | null = null;
  private configured = false;

  constructor() {
    const host = process.env.SMTP_HOST;
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;

    if (!host || !user || !pass) {
      this.logger.warn('SMTP not configured — email sending disabled');
      return;
    }

    this.transporter = nodemailer.createTransport({
      host,
      port: Number(process.env.SMTP_PORT ?? 465),
      secure: process.env.SMTP_SECURE === 'true',
      auth: { user, pass },
      // Bound network waits so a hung SMTP server can't stall request handlers.
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
    this.configured = true;
  }

  async send(to: string, subject: string, html: string, replyTo?: string): Promise<boolean> {
    if (!this.configured || !this.transporter) {
      return false;
    }

    try {
      const info = await this.transporter.sendMail({
        from: process.env.EMAIL_FROM ?? 'ImamZain.org <info@imamzain.org>',
        to,
        subject,
        html,
        text: stripHtml(html),
        replyTo,
      });
      this.logger.log(`Email sent: ${info.messageId}`);
      return true;
    } catch (err) {
      this.logger.error(`Failed to send email to ${to}: ${err}`);
      return false;
    }
  }

  notifyContactSubmission(record: any): Promise<boolean> {
    // Every interpolated field is HTML-escaped: the form fields are
    // attacker-controlled and would otherwise allow stored XSS / phishing
    // injection in the admin's mail client.
    const html = `
      <h2>New Contact Submission</h2>
      <table border="1" cellpadding="6" cellspacing="0">
        <tr><th>ID</th><td>${escapeHtml(record.id)}</td></tr>
        <tr><th>Name</th><td>${escapeHtml(record.name)}</td></tr>
        <tr><th>Email</th><td>${escapeHtml(record.email)}</td></tr>
        <tr><th>Country</th><td>${escapeHtml(record.country ?? '—')}</td></tr>
        <tr><th>Submitted At</th><td>${escapeHtml(record.submitted_at)}</td></tr>
        <tr><th>Message</th><td><blockquote>${escapeHtml(record.message)}</blockquote></td></tr>
      </table>
    `;
    return this.send(
      process.env.EMAIL_TO ?? 'info@imamzain.org',
      `New contact submission — ${sanitizeHeaderValue(record.name)}`,
      html,
    );
  }

  notifyProxyVisit(record: any): Promise<boolean> {
    const html = `
      <h2>New Proxy Visit Request</h2>
      <table border="1" cellpadding="6" cellspacing="0">
        <tr><th>Name</th><td>${escapeHtml(record.name)}</td></tr>
        <tr><th>Phone</th><td>${escapeHtml(record.phone ?? '—')}</td></tr>
        <tr><th>Country</th><td>${escapeHtml(record.country ?? '—')}</td></tr>
        <tr><th>Status</th><td>${escapeHtml(record.status)}</td></tr>
        <tr><th>Submitted At</th><td>${escapeHtml(record.submitted_at)}</td></tr>
      </table>
    `;
    return this.send(
      process.env.EMAIL_TO ?? 'info@imamzain.org',
      `New proxy visit request — ${sanitizeHeaderValue(record.name)}`,
      html,
    );
  }
}
