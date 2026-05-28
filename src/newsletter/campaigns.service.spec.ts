import { Test, TestingModule } from '@nestjs/testing';
import { CampaignsService } from './campaigns.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import { EmailService } from '../email/email.service';
import { NewsletterService } from './newsletter.service';
import { AUDIT_ACTIONS } from '../common/audit/audit.actions';

describe('CampaignsService — sender behaviour', () => {
  let service: CampaignsService;
  let prisma: any;
  let audit: any;
  let email: any;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CampaignsService,
        {
          provide: PrismaService,
          useValue: {
            newsletter_campaigns: {
              findMany: jest.fn().mockResolvedValue([]),
              updateMany: jest.fn(),
              update: jest.fn(),
            },
            newsletter_campaign_recipients: {
              findMany: jest.fn(),
              update: jest.fn().mockResolvedValue({}),
              updateMany: jest.fn().mockResolvedValue({ count: 1 }),
            },
            newsletter_subscribers: { findMany: jest.fn().mockResolvedValue([]) },
            $transaction: jest.fn((ops: any) => Promise.all(ops)),
          },
        },
        { provide: AuditService, useValue: { write: jest.fn().mockResolvedValue(true) } },
        {
          provide: NewsletterService,
          useValue: { signUnsubscribeToken: jest.fn().mockReturnValue('tok') },
        },
        { provide: EmailService, useValue: { send: jest.fn().mockResolvedValue(true) } },
      ],
    }).compile();

    service = module.get(CampaignsService);
    prisma = module.get(PrismaService);
    audit = module.get(AuditService);
    email = module.get(EmailService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('runSendingTick re-entrancy guard', () => {
    it('skips a concurrent invocation without touching the database', async () => {
      (service as any).isRunning = true;

      await service.runSendingTick();

      expect(prisma.newsletter_campaigns.findMany).not.toHaveBeenCalled();
    });

    it('runs and resets the flag on completion', async () => {
      await service.runSendingTick();

      expect(prisma.newsletter_campaigns.findMany).toHaveBeenCalled();
      expect((service as any).isRunning).toBe(false);
    });

    it('resets the flag even if the run throws', async () => {
      prisma.newsletter_campaigns.findMany.mockRejectedValueOnce(new Error('boom'));

      await expect(service.runSendingTick()).rejects.toThrow('boom');
      expect((service as any).isRunning).toBe(false);
    });
  });

  describe('processCampaignBatch — completion audit', () => {
    it('writes NEWSLETTER_CAMPAIGN_COMPLETED when transitioning to sent', async () => {
      prisma.newsletter_campaign_recipients.findMany.mockResolvedValue([]);
      prisma.newsletter_campaigns.update.mockResolvedValue({
        delivered_count: 42,
        failed_count: 1,
        recipient_count: 43,
      });

      await (service as any).processCampaignBatch({
        id: 'c-1',
        subject: 'Hello',
        body_html: '<p>Hi</p>',
      });

      expect(audit.write).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AUDIT_ACTIONS.NEWSLETTER_CAMPAIGN_COMPLETED,
          resourceId: 'c-1',
        }),
      );
    });
  });

  describe('processCampaignBatch — mid-batch unsubscribe', () => {
    it('skips inactive subscribers and marks the recipient row failed', async () => {
      prisma.newsletter_campaign_recipients.findMany.mockResolvedValue([
        {
          campaign_id: 'c-1',
          subscriber_id: 's-1',
          newsletter_subscribers: { id: 's-1', email: 'x@y.z', is_active: false },
        },
      ]);
      prisma.newsletter_campaigns.update.mockResolvedValue({});

      await (service as any).processCampaignBatch({
        id: 'c-1',
        subject: 'Hello',
        body_html: '<p>Hi</p>',
      });

      expect(email.send).not.toHaveBeenCalled();
      // Bulk update marks the inactive recipient failed with the
      // "Subscriber unsubscribed before send" message; per-row updates
      // were replaced by updateMany batches.
      expect(prisma.newsletter_campaign_recipients.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            campaign_id: 'c-1',
            subscriber_id: { in: ['s-1'] },
          }),
          data: expect.objectContaining({
            error_message: 'Subscriber unsubscribed before send',
          }),
        }),
      );
    });
  });
});
