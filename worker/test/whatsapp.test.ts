import { afterEach, describe, expect, it, vi } from 'vitest';
import { sendProxyVisitCompletion } from '../src/lib/whatsapp';

const env = { TWILIO_ACCOUNT_SID: 'AC123', TWILIO_AUTH_TOKEN: 'tok', TWILIO_WHATSAPP_FROM: 'whatsapp:+15550001111', TWILIO_TEMPLATE_SID: 'HX999' };

afterEach(() => vi.unstubAllGlobals());

describe('sendProxyVisitCompletion', () => {
  it('posts the template to Twilio’s Messages API as the SDK did', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => Response.json({ sid: 'SM1' }, { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);

    expect(await sendProxyVisitCompletion(env, '+9647801234567', 'علي')).toBe(true);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.twilio.com/2010-04-01/Accounts/AC123/Messages.json');
    expect((init.headers as Record<string, string>).authorization).toBe(`Basic ${btoa('AC123:tok')}`);
    expect(Object.fromEntries(init.body as URLSearchParams)).toEqual({
      From: 'whatsapp:+15550001111',
      To: 'whatsapp:+9647801234567',
      ContentSid: 'HX999',
      ContentVariables: '{"1":"علي"}',
    });
  });

  it('sends nothing without full config or to a non-E.164 number, and reports a Twilio error as false', async () => {
    const fetchMock = vi.fn(async () => Response.json({ message: 'bad' }, { status: 400 }));
    vi.stubGlobal('fetch', fetchMock);

    expect(await sendProxyVisitCompletion({ ...env, TWILIO_TEMPLATE_SID: undefined }, '+9647801234567', 'x')).toBe(false);
    expect(await sendProxyVisitCompletion(env, '07801234567', 'x')).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await sendProxyVisitCompletion(env, '+9647801234567', 'x')).toBe(false);
  });
});
