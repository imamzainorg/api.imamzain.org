import { Injectable } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

@Injectable()
export class EmailService {
  private transporter: nodemailer.Transporter | null = null;
  private configured = false;

  constructor() {
    const host = process.env.SMTP_HOST;
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;

    if (!host || !user || !pass) {
      console.warn('[EmailService] SMTP not configured — email sending disabled');
      return;
    }

    this.transporter = nodemailer.createTransport({
      host,
      port: Number(process.env.SMTP_PORT ?? 465),
      secure: process.env.SMTP_SECURE === 'true',
      auth: { user, pass },
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
      console.info('[EmailService] Sent:', info.messageId);
      return true;
    } catch (err) {
      console.error('[EmailService] Send error:', err);
      return false;
    }
  }

  notifyContactSubmission(record: any): Promise<boolean> {
    const html = `
      <h2>New Contact Submission</h2>
      <table border="1" cellpadding="6" cellspacing="0">
        <tr><th>ID</th><td>${record.id}</td></tr>
        <tr><th>Name</th><td>${record.name}</td></tr>
        <tr><th>Email</th><td>${record.email}</td></tr>
        <tr><th>Country</th><td>${record.country ?? '—'}</td></tr>
        <tr><th>Submitted At</th><td>${record.submitted_at}</td></tr>
        <tr><th>Message</th><td><blockquote>${record.message}</blockquote></td></tr>
      </table>
    `;
    return this.send(
      process.env.EMAIL_TO ?? 'info@imamzain.org',
      `New contact submission — ${record.name}`,
      html,
    );
  }

  notifyProxyVisit(record: any): Promise<boolean> {
    const html = `
      <h2>New Proxy Visit Request</h2>
      <table border="1" cellpadding="6" cellspacing="0">
        <tr><th>Name</th><td>${record.name}</td></tr>
        <tr><th>Phone</th><td>${record.phone ?? '—'}</td></tr>
        <tr><th>Country</th><td>${record.country ?? '—'}</td></tr>
        <tr><th>Status</th><td>${record.status}</td></tr>
        <tr><th>Submitted At</th><td>${record.submitted_at}</td></tr>
      </table>
    `;
    return this.send(
      process.env.EMAIL_TO ?? 'info@imamzain.org',
      `New proxy visit request — ${record.name}`,
      html,
    );
  }
}
