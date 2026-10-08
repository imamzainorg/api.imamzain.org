// WhatsApp through the Twilio REST API (src/whatsapp/whatsapp.service.ts used the Twilio SDK).

const E164 = /^\+[1-9]\d{1,14}$/;

export interface TwilioEnv {
  TWILIO_ACCOUNT_SID?: string;
  TWILIO_AUTH_TOKEN?: string;
  TWILIO_WHATSAPP_FROM?: string;
  TWILIO_TEMPLATE_SID?: string;
}

/** The proxy-visit completion template to `visitorPhone`. False (logged, never thrown) when not sent. */
export async function sendProxyVisitCompletion(env: TwilioEnv, visitorPhone: string, visitorName: string): Promise<boolean> {
  const { TWILIO_ACCOUNT_SID: sid, TWILIO_AUTH_TOKEN: token, TWILIO_WHATSAPP_FROM: from, TWILIO_TEMPLATE_SID: templateSid } = env;
  if (!sid || !token || !from || !templateSid) {
    console.warn('Twilio not fully configured, skipping WhatsApp notification');
    return false;
  }
  if (!E164.test(visitorPhone)) {
    console.warn(`Invalid phone number format: ${visitorPhone}`);
    return false;
  }

  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: { authorization: `Basic ${btoa(`${sid}:${token}`)}`, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ From: from, To: `whatsapp:${visitorPhone}`, ContentSid: templateSid, ContentVariables: JSON.stringify({ '1': visitorName }) }),
    });
    const body = (await res.json().catch(() => ({}))) as { sid?: string; message?: string };
    if (!res.ok) {
      console.error(`WhatsApp send error: ${res.status} ${body.message ?? ''}`);
      return false;
    }
    console.log(`WhatsApp sent, SID: ${body.sid}`);
    return true;
  } catch (err) {
    console.error(`WhatsApp send error: ${err instanceof Error ? err.message : err}`);
    return false;
  }
}
