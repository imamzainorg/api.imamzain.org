import { Injectable, Logger } from '@nestjs/common';
import twilio = require('twilio');

const E164_REGEX = /^\+[1-9]\d{1,14}$/;

@Injectable()
export class WhatsappService {
  private readonly logger = new Logger(WhatsappService.name);
  private client: twilio.Twilio | null = null;
  private configured = false;

  constructor() {
    const sid = process.env.TWILIO_ACCOUNT_SID;
    const token = process.env.TWILIO_AUTH_TOKEN;
    const from = process.env.TWILIO_WHATSAPP_FROM;
    const templateSid = process.env.TWILIO_TEMPLATE_SID;

    if (!sid || !token || !from || !templateSid) {
      this.logger.warn('Twilio not fully configured — WhatsApp sending disabled');
      return;
    }

    this.client = twilio(sid, token);
    this.configured = true;
  }

  async sendProxyVisitCompletion(visitorPhone: string, visitorName: string): Promise<boolean> {
    if (!this.configured || !this.client) {
      this.logger.warn('Not configured, skipping WhatsApp notification');
      return false;
    }

    if (!E164_REGEX.test(visitorPhone)) {
      this.logger.warn(`Invalid phone number format: ${visitorPhone}`);
      return false;
    }

    try {
      const message = await this.client.messages.create({
        from: process.env.TWILIO_WHATSAPP_FROM,
        to: `whatsapp:${visitorPhone}`,
        contentSid: process.env.TWILIO_TEMPLATE_SID,
        contentVariables: JSON.stringify({ '1': visitorName }),
      });
      this.logger.log(`Sent, SID: ${message.sid}`);
      return true;
    } catch (err) {
      this.logger.error(`Send error: ${err instanceof Error ? err.message : err}`);
      return false;
    }
  }
}
