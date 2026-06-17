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
              findUnique: jest.fn().mockResolvedValue({
                delivered_count: 1,
                failed_count: 0,
                recipient_count: 1,
              }),
              updateMany: jest.fn().mockResolvedValue({ count: 1 }),
              update: jest.fn(),
            },
            newsletter_campaign_recipients: {
              findMany: jest.fn(),
              count: jest.fn().mockResolvedValue(0),
              update: jest.fn().mockResolvedValue({}),
              updateMany: jest.fn().mockResolvedValue({ count: 1 }),
            },
            newsletter_subscribers: { findMany: jest.fn().mockResolvedValue([]) },
            $executeRaw: jest.fn().mockResolvedValue(0),
            // Handles both forms used by the service: the array form for the
            // delivery batch, and the callback form (with the advisory-lock
            // SELECT) used by withAdvisoryLock to gate the cron tick.
            $transaction: jest.fn((arg: any) => {
              if (typeof arg === 'function') {
                return arg({ $queryRaw: jest.fn().mockResolvedValue([{ locked: true }]) });
              }
              return Promise.all(arg);
            }),
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

    it('swallows a tick error (logs, does not reject) and resets the flag', async () => {
      // A lock-transaction timeout or transient DB error on the cron path must
      // not become an unhandled rejection — runSendingTick catches it, logs,
      // and the next tick retries. The re-entrancy flag must still be cleared.
      prisma.newsletter_campaigns.findMany.mockRejectedValueOnce(new Error('boom'));

      await expect(service.runSendingTick()).resolves.toBeUndefined();
      expect((service as any).isRunning).toBe(false);
    });
  });

  describe('processCampaignBatch — completion audit', () => {
    it('writes NEWSLETTER_CAMPAIGN_COMPLETED when transitioning to sent', async () => {
      prisma.newsletter_campaign_recipients.findMany.mockResolvedValue([]);
      // Counters drive both the terminal status and the audit payload.
      prisma.newsletter_campaigns.findUnique.mockResolvedValue({
        delivered_count: 42,
        failed_count: 1,
        recipient_count: 43,
      });
      // Conditional finalize transitions the row out of 'sending'.
      prisma.newsletter_campaigns.updateMany.mockResolvedValue({ count: 1 });

      await (service as any).processCampaignBatch({
        id: 'c-1',
        subject: 'Hello',
        body_html: '<p>Hi</p>',
      });

      expect(prisma.newsletter_campaigns.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'c-1', status: 'sending' },
          data: expect.objectContaining({ status: 'sent' }),
        }),
      );
      expect(audit.write).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AUDIT_ACTIONS.NEWSLETTER_CAMPAIGN_COMPLETED,
          resourceId: 'c-1',
        }),
      );
    });

    it('skips completion + audit when a concurrent cancel won the race', async () => {
      prisma.newsletter_campaign_recipients.findMany.mockResolvedValue([]);
      prisma.newsletter_campaigns.findUnique.mockResolvedValue({
        delivered_count: 5,
        failed_count: 0,
        recipient_count: 5,
      });
      // The campaign was flipped to 'cancelled' before this terminal write, so
      // the status-guarded updateMany matches no rows.
      prisma.newsletter_campaigns.updateMany.mockResolvedValue({ count: 0 });

      await (service as any).processCampaignBatch({ id: 'c-1', subject: 'Hi', body_html: '<p>x</p>' });

      expect(audit.write).not.toHaveBeenCalledWith(
        expect.objectContaining({ action: AUDIT_ACTIONS.NEWSLETTER_CAMPAIGN_COMPLETED }),
      );
    });

    it('re-populates a stranded campaign (recipient_count NULL) instead of marking it sent', async () => {
      prisma.newsletter_campaign_recipients.findMany.mockResolvedValue([]); // no pending rows
      // Stranded: status flipped to 'sending' but populateRecipients never
      // wrote recipient_count, so it is NULL (Int?, no default) — not 0.
      prisma.newsletter_campaigns.findUnique.mockResolvedValue({
        delivered_count: 0,
        failed_count: 0,
        recipient_count: null,
      });
      // populateRecipients() internals: raw INSERT...SELECT + count + update.
      prisma.$executeRaw.mockResolvedValue(3);
      prisma.newsletter_campaign_recipients.count.mockResolvedValue(3);

      await (service as any).processCampaignBatch({ id: 'c-1', subject: 'Hi', body_html: '<p>x</p>' });

      // It re-populated and bailed for the next tick — must NOT be marked
      // terminal ('sent') nor emit a completion audit row.
      expect(prisma.newsletter_campaign_recipients.count).toHaveBeenCalled();
      expect(prisma.newsletter_campaigns.update).not.toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'sent' }) }),
      );
      expect(audit.write).not.toHaveBeenCalledWith(
        expect.objectContaining({ action: AUDIT_ACTIONS.NEWSLETTER_CAMPAIGN_COMPLETED }),
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
