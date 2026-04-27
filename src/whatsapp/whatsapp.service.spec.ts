import { WhatsappService } from './whatsapp.service';

const mockMessagesCreate = jest.fn().mockResolvedValue({ sid: 'SM-test-sid' });

jest.mock('twilio', () =>
  jest.fn().mockImplementation(() => ({
    messages: { create: mockMessagesCreate },
  })),
);

describe('WhatsappService', () => {
  afterEach(() => jest.clearAllMocks());

  describe('when Twilio is configured', () => {
    let service: WhatsappService;

    beforeEach(() => {
      process.env.TWILIO_ACCOUNT_SID = 'AC-test';
      process.env.TWILIO_AUTH_TOKEN = 'token';
      process.env.TWILIO_WHATSAPP_FROM = 'whatsapp:+14155238886';
      process.env.TWILIO_TEMPLATE_SID = 'HXtest';
      service = new WhatsappService();
    });

    it('returns true when message is sent successfully', async () => {
      const result = await service.sendProxyVisitCompletion('+9647001234567', 'Ali Hassan');

      expect(result).toBe(true);
      expect(mockMessagesCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'whatsapp:+9647001234567',
          contentVariables: JSON.stringify({ '1': 'Ali Hassan' }),
        }),
      );
    });

    it('returns false for invalid phone number format', async () => {
      const result = await service.sendProxyVisitCompletion('009647001234567', 'Ali');

      expect(result).toBe(false);
      expect(mockMessagesCreate).not.toHaveBeenCalled();
    });

    it('returns false for phone without + prefix', async () => {
      const result = await service.sendProxyVisitCompletion('9647001234567', 'Ali');

      expect(result).toBe(false);
    });

    it('returns false when Twilio throws an error', async () => {
      mockMessagesCreate.mockRejectedValueOnce(new Error('Twilio error'));

      const result = await service.sendProxyVisitCompletion('+9647001234567', 'Ali');

      expect(result).toBe(false);
    });
  });

  describe('when Twilio is NOT configured', () => {
    it('returns false without attempting to send', async () => {
      delete process.env.TWILIO_ACCOUNT_SID;
      delete process.env.TWILIO_AUTH_TOKEN;
      delete process.env.TWILIO_WHATSAPP_FROM;
      delete process.env.TWILIO_TEMPLATE_SID;
      const service = new WhatsappService();

      const result = await service.sendProxyVisitCompletion('+9647001234567', 'Ali');

      expect(result).toBe(false);
      expect(mockMessagesCreate).not.toHaveBeenCalled();
    });
  });
});
