import { Injectable } from '@nestjs/common';
import * as twilio from 'twilio';

const E164_REGEX = /^\+[1-9]\d{1,14}$/;

@Injectable()
export class WhatsappService {
  private client: twilio.Twilio | null = null;
  private configured = false;

  constructor() {
    const sid = process.env.TWILIO_ACCOUNT_SID;
    const token = process.env.TWILIO_AUTH_TOKEN;
    const from = process.env.TWILIO_WHATSAPP_FROM;
    const templateSid = process.env.TWILIO_TEMPLATE_SID;

    if (!sid || !token || !from || !templateSid) {
      console.warn('[WhatsappService] Twilio not fully configured — WhatsApp sending disabled');
      return;
    }

    this.client = twilio(sid, token);
    this.configured = true;
  }

  async sendProxyVisitCompletion(visitorPhone: string, visitorName: string): Promise<boolean> {
    if (!this.configured || !this.client) {
      console.warn('[WhatsappService] Not configured, skipping WhatsApp notification');
      return false;
    }

    if (!E164_REGEX.test(visitorPhone)) {
      console.warn('[WhatsappService] Invalid phone number format:', visitorPhone);
      return false;
    }

    try {
      const message = await this.client.messages.create({
        from: process.env.TWILIO_WHATSAPP_FROM,
        to: `whatsapp:${visitorPhone}`,
        contentSid: process.env.TWILIO_TEMPLATE_SID,
        contentVariables: JSON.stringify({ '1': visitorName }),
      });
      console.info('[WhatsappService] Sent, SID:', message.sid);
      return true;
    } catch (err) {
      console.error('[WhatsappService] Send error:', err);
      return false;
    }
  }
}
