import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { CampaignsService } from './campaigns.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import { EmailService } from '../email/email.service';
import { NewsletterService } from './newsletter.service';
import { AUDIT_ACTIONS } from '../common/audit/audit.actions';

const NOW = new Date('2026-09-17T12:00:00.000Z');
const CAMPAIGN = { id: 'c-1', subject: 'Hello', body_html: '<p>Hi {{email}}</p>' };
const CONFIG = { perHour: 80, batchSize: 10, maxAttempts: 5, pauseMs: 15 * 60_000 };

const subscriber = (n: number, overrides: Record<string, unknown> = {}) => ({
  id: `s-${n}`,
  email: `s${n}@example.com`,
  is_active: true,
  deleted_at: null,
  ...overrides,
});

const row = (n: number, opts: { attempts?: number; sub?: Record<string, unknown> } = {}) => ({
  subscriber_id: `s-${n}`,
  attempts: opts.attempts ?? 0,
  newsletter_subscribers: subscriber(n, opts.sub),
});

const flushPromises = () => new Promise<void>((resolve) => setImmediate(resolve));

describe('CampaignsService', () => {
  let service: CampaignsService;
  let prisma: any;
  let audit: any;
  let email: any;

  // What each COUNT on the recipients table answers. One mock serves several
  // queries, so it dispatches on the shape of `where`.
  let counts: { unfinished: number; delivered: number; failed: number; sentLastHour: number; rows: number };

  beforeEach(async () => {
    counts = { unfinished: 3, delivered: 0, failed: 0, sentLastHour: 0, rows: 0 };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CampaignsService,
        {
          provide: PrismaService,
          useValue: {
            newsletter_campaigns: {
              findMany: jest.fn().mockResolvedValue([]),
              findUnique: jest.fn().mockResolvedValue({ recipient_count: 5, status: 'draft', sent_at: null }),
              create: jest.fn((args: any) => ({ id: 'c-new', ...args.data })),
              update: jest.fn().mockResolvedValue({}),
              updateMany: jest.fn().mockResolvedValue({ count: 1 }),
              delete: jest.fn().mockResolvedValue({}),
            },
            newsletter_campaign_recipients: {
              findMany: jest.fn().mockResolvedValue([]),
              count: jest.fn(async ({ where }: any) => {
                if (where.sent_at === null && where.failed_at === null) return counts.unfinished;
                if (where.sent_at?.not === null) return counts.delivered;
                if (where.failed_at?.not === null) return counts.failed;
                if (where.sent_at?.gte) return counts.sentLastHour;
                return counts.rows;
              }),
              updateMany: jest.fn().mockResolvedValue({ count: 1 }),
            },
            newsletter_subscribers: { count: jest.fn().mockResolvedValue(3) },
            $executeRaw: jest.fn().mockResolvedValue(0),
            // Callback form = withAdvisoryLock's transaction (lock is free).
            $transaction: jest.fn((arg: any) => {
              if (typeof arg === 'function') {
                return arg({ $queryRaw: jest.fn().mockResolvedValue([{ locked: true }]) });
              }
              return Promise.all(arg);
            }),
          },
        },
        { provide: AuditService, useValue: { write: jest.fn().mockResolvedValue(true) } },
        { provide: NewsletterService, useValue: { signUnsubscribeToken: jest.fn().mockReturnValue('tok') } },
        {
          provide: EmailService,
          useValue: {
            isConfigured: jest.fn().mockReturnValue(true),
            deliver: jest.fn().mockResolvedValue({ ok: true, messageId: 'm-1' }),
          },
        },
      ],
    }).compile();

    service = module.get(CampaignsService);
    prisma = module.get(PrismaService);
    audit = module.get(AuditService);
    email = module.get(EmailService);
  });

  afterEach(() => jest.clearAllMocks());

  const recipientWrites = () =>
    prisma.newsletter_campaign_recipients.updateMany.mock.calls.map(([args]: any[]) => args);
  const claims = () => recipientWrites().filter((a: any) => a.data.attempts?.increment === 1);
  const sentWrites = () => recipientWrites().filter((a: any) => a.data.sent_at instanceof Date);
  // Outcomes of one recipient's send (where.subscriber_id is one id), as opposed
  // to the bulk sweeps (exhausted rows, unsubscribed-since-snapshot).
  const oneRecipient = (a: any) => typeof a.where.subscriber_id === 'string';
  const failedWrites = () => recipientWrites().filter((a: any) => oneRecipient(a) && a.data.failed_at instanceof Date);
  const retryWrites = () => recipientWrites().filter((a: any) => oneRecipient(a) && a.data.next_retry_at instanceof Date);
  const releases = () => recipientWrites().filter((a: any) => a.data.attempts?.decrement === 1);

  const runBatch = (rows: unknown[], budget = 80) => {
    prisma.newsletter_campaign_recipients.findMany.mockResolvedValue(rows);
    return (service as any).processCampaignBatch(CAMPAIGN, budget, CONFIG, NOW);
  };

  // ── tick ────────────────────────────────────────────────────────────────

  describe('runSendingTick', () => {
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
      prisma.newsletter_campaigns.findMany.mockRejectedValueOnce(new Error('boom'));

      await expect(service.runSendingTick()).resolves.toBeUndefined();
      expect((service as any).isRunning).toBe(false);
    });

    it('leaves the queue untouched when SMTP is not configured', async () => {
      email.isConfigured.mockReturnValue(false);

      await service.runSendingTick();

      expect(email.isConfigured).toHaveBeenCalledWith('campaign');
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.newsletter_campaigns.updateMany).not.toHaveBeenCalled();
    });

    it('only picks up sending campaigns that are not paused, oldest first', async () => {
      await service.runSendingTick();

      const inFlightQuery = prisma.newsletter_campaigns.findMany.mock.calls
        .map(([args]: any[]) => args)
        .find((args: any) => args.where.status === 'sending');
      expect(inFlightQuery.where.OR).toEqual([{ paused_until: null }, { paused_until: { lte: expect.any(Date) } }]);
      expect(inFlightQuery.orderBy).toEqual([{ created_at: 'asc' }, { id: 'asc' }]);
    });

    it('shares one hourly budget across campaigns', async () => {
      counts.sentLastHour = 297; // 300/h − 297 sent in the last hour = 3 left
      prisma.newsletter_campaigns.findMany.mockImplementation(async ({ where }: any) =>
        where.status === 'sending' ? [CAMPAIGN, { ...CAMPAIGN, id: 'c-2' }] : [],
      );
      const batch = jest
        .spyOn(service as any, 'processCampaignBatch')
        .mockResolvedValueOnce(2)
        .mockResolvedValueOnce(0);

      await service.runSendingTick();

      expect(batch.mock.calls.map((c) => [(c[0] as any).id, c[1]])).toEqual([
        ['c-1', 3],
        ['c-2', 1],
      ]);
    });

    it('never lets the budget go negative when the hour is already over quota', async () => {
      counts.sentLastHour = 500;
      prisma.newsletter_campaigns.findMany.mockImplementation(async ({ where }: any) =>
        where.status === 'sending' ? [CAMPAIGN] : [],
      );
      const batch = jest.spyOn(service as any, 'processCampaignBatch').mockResolvedValue(0);

      await service.runSendingTick();

      expect(batch.mock.calls[0][1]).toBe(0);
    });

    it('promotes a due scheduled campaign and marks it failed when nobody is subscribed', async () => {
      prisma.newsletter_campaigns.findMany.mockImplementation(async ({ where }: any) =>
        where.status === 'scheduled' ? [{ id: 'c-9' }] : [],
      );
      prisma.newsletter_campaign_recipients.count.mockResolvedValue(0); // populate finds no one

      await service.runSendingTick();

      expect(prisma.newsletter_campaigns.updateMany).toHaveBeenCalledWith({
        where: { id: 'c-9', status: 'sending' },
        data: expect.objectContaining({ status: 'failed', last_error: 'No active subscribers to send to' }),
      });
    });
  });

  // ── send / retry / cancel / delete ─────────────────────────────────────

  describe('send', () => {
    beforeEach(() => {
      prisma.newsletter_campaigns.findUnique.mockResolvedValue({ status: 'draft' });
      counts.rows = 3; // populateRecipients re-counts the rows
    });

    it('refuses with 503 SMTP_NOT_CONFIGURED and leaves the campaign untouched', async () => {
      email.isConfigured.mockReturnValue(false);

      const err = await service.send('c-1', 'u-1').catch((e) => e);

      expect(err).toBeInstanceOf(ServiceUnavailableException);
      expect(err.getResponse()).toMatchObject({ code: 'SMTP_NOT_CONFIGURED' });
      expect(prisma.newsletter_campaigns.updateMany).not.toHaveBeenCalled();
    });

    it('is 404 for an unknown campaign', async () => {
      prisma.newsletter_campaigns.findUnique.mockResolvedValue(null);

      await expect(service.send('nope', 'u-1')).rejects.toThrow(NotFoundException);
    });

    it.each(['sending', 'sent', 'failed', 'cancelled'])('is 409 for a campaign that is %s', async (status) => {
      prisma.newsletter_campaigns.findUnique.mockResolvedValue({ status });

      await expect(service.send('c-1', 'u-1')).rejects.toThrow(ConflictException);
      expect(prisma.newsletter_campaigns.updateMany).not.toHaveBeenCalled();
    });

    it('does not consume the campaign when there is nobody to send to', async () => {
      prisma.newsletter_subscribers.count.mockResolvedValue(0);

      await expect(service.send('c-1', 'u-1')).rejects.toThrow(BadRequestException);

      // Neither flipped to sending nor marked sent: the campaign is exactly as it was.
      expect(prisma.newsletter_campaigns.updateMany).not.toHaveBeenCalled();
      expect(prisma.newsletter_campaigns.update).not.toHaveBeenCalled();
    });

    it('hands the campaign back when everyone left between the check and the snapshot', async () => {
      counts.rows = 0;

      await expect(service.send('c-1', 'u-1')).rejects.toThrow(BadRequestException);

      expect(prisma.newsletter_campaigns.updateMany).toHaveBeenLastCalledWith({
        where: { id: 'c-1', status: 'sending' },
        data: expect.objectContaining({ status: 'draft' }),
      });
    });

    it('a scheduled campaign goes back to scheduled, not draft, when it cannot be sent', async () => {
      prisma.newsletter_campaigns.findUnique.mockResolvedValue({ status: 'scheduled' });
      counts.rows = 0;

      await expect(service.send('c-1', 'u-1')).rejects.toThrow(BadRequestException);

      expect(prisma.newsletter_campaigns.updateMany).toHaveBeenLastCalledWith({
        where: { id: 'c-1', status: 'sending' },
        data: expect.objectContaining({ status: 'scheduled' }),
      });
    });

    it('is 409 when another request flipped the campaign first', async () => {
      prisma.newsletter_campaigns.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.send('c-1', 'u-1')).rejects.toThrow(ConflictException);
    });

    it('queues the campaign, clears any old pause, and audits it', async () => {
      const result = await service.send('c-1', 'u-1');

      expect(prisma.newsletter_campaigns.updateMany).toHaveBeenCalledWith({
        where: { id: 'c-1', status: 'draft' },
        data: expect.objectContaining({ status: 'sending', paused_until: null, last_error: null }),
      });
      expect(result.data).toEqual({ id: 'c-1', recipient_count: 3 });
      expect(audit.write).toHaveBeenCalledWith(
        expect.objectContaining({ action: AUDIT_ACTIONS.NEWSLETTER_CAMPAIGN_SEND_QUEUED, resourceId: 'c-1' }),
      );
    });
  });

  describe('retry', () => {
    const failedCampaign = { status: 'failed', sent_at: new Date('2026-09-16T10:00:00.000Z') };

    beforeEach(() => {
      prisma.newsletter_campaigns.findUnique.mockResolvedValue(failedCampaign);
      prisma.$executeRaw.mockResolvedValue(4); // rows re-queued by the UPDATE ... FROM
    });

    it('refuses with 503 when SMTP is not configured', async () => {
      email.isConfigured.mockReturnValue(false);

      await expect(service.retry('c-1', 'u-1')).rejects.toThrow(ServiceUnavailableException);
    });

    it('is 404 for an unknown campaign', async () => {
      prisma.newsletter_campaigns.findUnique.mockResolvedValue(null);

      await expect(service.retry('nope', 'u-1')).rejects.toThrow(NotFoundException);
    });

    it.each(['draft', 'scheduled', 'sending', 'sent', 'cancelled'])('is 409 for a campaign that is %s', async (status) => {
      prisma.newsletter_campaigns.findUnique.mockResolvedValue({ status, sent_at: null });

      await expect(service.retry('c-1', 'u-1')).rejects.toThrow(ConflictException);
      expect(prisma.newsletter_campaigns.updateMany).not.toHaveBeenCalled();
    });

    it('re-queues the failed recipients and puts the campaign back to sending', async () => {
      const result = await service.retry('c-1', 'u-1');

      expect(prisma.newsletter_campaigns.updateMany).toHaveBeenCalledWith({
        where: { id: 'c-1', status: 'failed' },
        data: expect.objectContaining({ status: 'sending', sent_at: null, paused_until: null, last_error: null }),
      });
      expect(result.data).toEqual({ id: 'c-1', recipient_count: 4 });
      expect(audit.write).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AUDIT_ACTIONS.NEWSLETTER_CAMPAIGN_RETRIED,
          changes: expect.objectContaining({ requeued: 4 }),
        }),
      );
    });

    it('is 409 when another request already moved the campaign on', async () => {
      prisma.newsletter_campaigns.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.retry('c-1', 'u-1')).rejects.toThrow(ConflictException);
      expect(prisma.$executeRaw).not.toHaveBeenCalled();
    });

    it('reverts to failed, with the original finish time, when every failed recipient has left', async () => {
      prisma.$executeRaw.mockResolvedValue(0);
      counts.rows = 12; // it does have rows — they are just no longer retryable

      await expect(service.retry('c-1', 'u-1')).rejects.toThrow('Nothing to retry');

      expect(prisma.newsletter_campaigns.updateMany).toHaveBeenLastCalledWith({
        where: { id: 'c-1', status: 'sending' },
        data: expect.objectContaining({ status: 'failed', sent_at: failedCampaign.sent_at }),
      });
    });

    it('takes a fresh snapshot for a campaign that failed for want of an audience', async () => {
      prisma.$executeRaw.mockResolvedValueOnce(0).mockResolvedValueOnce(0); // requeue → 0, then the INSERT
      counts.rows = 0;

      // Still nobody: reverts. (With subscribers it would queue them — covered by populate below.)
      await expect(service.retry('c-1', 'u-1')).rejects.toThrow('Nothing to retry');
      expect(prisma.$executeRaw).toHaveBeenCalledTimes(2);
    });

    it('does not add later subscribers to a campaign that already has recipient rows', async () => {
      prisma.$executeRaw.mockResolvedValue(0);
      counts.rows = 5;

      await expect(service.retry('c-1', 'u-1')).rejects.toThrow('Nothing to retry');

      expect(prisma.$executeRaw).toHaveBeenCalledTimes(1); // only the re-queue, never the snapshot INSERT
    });
  });

  describe('delete', () => {
    it.each(['draft', 'cancelled', 'failed'])('allows deleting a %s campaign', async (status) => {
      prisma.newsletter_campaigns.findUnique.mockResolvedValue({ id: 'c-1', status });

      await service.delete('c-1', 'u-1');

      expect(prisma.newsletter_campaigns.delete).toHaveBeenCalledWith({ where: { id: 'c-1' } });
    });

    it.each(['scheduled', 'sending', 'sent'])('refuses to delete a %s campaign', async (status) => {
      prisma.newsletter_campaigns.findUnique.mockResolvedValue({ id: 'c-1', status });

      await expect(service.delete('c-1', 'u-1')).rejects.toThrow(ConflictException);
      expect(prisma.newsletter_campaigns.delete).not.toHaveBeenCalled();
    });
  });

  // ── scheduled_at ───────────────────────────────────────────────────────

  describe('scheduled_at', () => {
    const inAnHour = () => new Date(Date.now() + 3_600_000).toISOString();
    const anHourAgo = () => new Date(Date.now() - 3_600_000).toISOString();

    it('create: a future instant with an offset makes a scheduled campaign', async () => {
      const at = inAnHour();

      await service.create({ subject: 'S', body_html: '<p>x</p>', scheduled_at: at }, 'u-1');

      expect(prisma.newsletter_campaigns.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ status: 'scheduled', scheduled_at: new Date(at) }),
      });
    });

    it('create: without a schedule it is a draft', async () => {
      await service.create({ subject: 'S', body_html: '<p>x</p>' }, 'u-1');

      expect(prisma.newsletter_campaigns.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ status: 'draft', scheduled_at: null }),
      });
    });

    it('create: rejects a time in the past instead of sending within the minute', async () => {
      await expect(
        service.create({ subject: 'S', body_html: '<p>x</p>', scheduled_at: anHourAgo() }, 'u-1'),
      ).rejects.toThrow('in the future');
      expect(prisma.newsletter_campaigns.create).not.toHaveBeenCalled();
    });

    it('create: rejects a timestamp without an offset (it would be read in the server zone)', async () => {
      await expect(
        service.create({ subject: 'S', body_html: '<p>x</p>', scheduled_at: '2099-01-01T09:00:00' }, 'u-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('update: accepts the stored schedule unchanged even after it has passed', async () => {
      const stored = anHourAgo();
      prisma.newsletter_campaigns.findUnique.mockResolvedValue({
        id: 'c-1',
        status: 'scheduled',
        scheduled_at: new Date(stored),
      });

      await service.update('c-1', { scheduled_at: stored, subject: 'New subject' }, 'u-1');

      expect(prisma.newsletter_campaigns.update).toHaveBeenCalledWith({
        where: { id: 'c-1' },
        data: expect.objectContaining({ scheduled_at: new Date(stored), status: 'scheduled', subject: 'New subject' }),
      });
    });

    it('update: rejects moving the schedule to another time in the past', async () => {
      prisma.newsletter_campaigns.findUnique.mockResolvedValue({
        id: 'c-1',
        status: 'scheduled',
        scheduled_at: new Date(Date.now() + 86_400_000),
      });

      await expect(service.update('c-1', { scheduled_at: anHourAgo() }, 'u-1')).rejects.toThrow('in the future');
    });

    it('update: null clears the schedule and returns the campaign to draft', async () => {
      prisma.newsletter_campaigns.findUnique.mockResolvedValue({
        id: 'c-1',
        status: 'scheduled',
        scheduled_at: new Date(Date.now() + 86_400_000),
      });

      await service.update('c-1', { scheduled_at: null }, 'u-1');

      expect(prisma.newsletter_campaigns.update).toHaveBeenCalledWith({
        where: { id: 'c-1' },
        data: expect.objectContaining({ scheduled_at: null, status: 'draft' }),
      });
    });
  });

  // ── one batch ──────────────────────────────────────────────────────────

  describe('processCampaignBatch — sending', () => {
    it('claims a recipient BEFORE the SMTP call, so a second worker cannot mail the same row', async () => {
      await runBatch([row(1)]);

      const claimOrder = prisma.newsletter_campaign_recipients.updateMany.mock.invocationCallOrder[
        recipientWrites().indexOf(claims()[0])
      ];
      expect(claims()).toHaveLength(1);
      expect(claimOrder).toBeLessThan(email.deliver.mock.invocationCallOrder[0]);
    });

    it('claims only while the campaign is still sending and the row is unclaimed, so a cancel takes effect at once', async () => {
      await runBatch([row(1)]);

      expect(claims()[0].where).toEqual(
        expect.objectContaining({
          campaign_id: 'c-1',
          subscriber_id: 's-1',
          sent_at: null,
          failed_at: null,
          newsletter_campaigns: { status: 'sending' },
          OR: [{ claimed_until: null }, { claimed_until: { lt: expect.any(Date) } }],
        }),
      );
      expect(claims()[0].data.claimed_until.getTime()).toBeGreaterThan(Date.now());
    });

    it('skips a recipient whose claim was lost (another worker, or the campaign was cancelled)', async () => {
      prisma.newsletter_campaign_recipients.updateMany.mockResolvedValue({ count: 0 });

      const delivered = await runBatch([row(1)]);

      expect(email.deliver).not.toHaveBeenCalled();
      expect(delivered).toBe(0);
    });

    it('writes sent_at for each recipient as soon as ITS send returns, not after the whole batch', async () => {
      let finishSecond!: () => void;
      email.deliver
        .mockResolvedValueOnce({ ok: true, messageId: 'a' })
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              finishSecond = () => resolve({ ok: true, messageId: 'b' });
            }),
        );

      const batch = runBatch([row(1), row(2)]);
      await flushPromises();

      // The second message is still on the wire; the first is already durable.
      expect(sentWrites().map((w: any) => w.where.subscriber_id)).toEqual(['s-1']);

      finishSecond();
      await batch;
      expect(sentWrites().map((w: any) => w.where.subscriber_id).sort()).toEqual(['s-1', 's-2']);
    });

    it('sends through the campaign lane with a List-Unsubscribe header and the link in the text part', async () => {
      await runBatch([row(1)]);

      const message = email.deliver.mock.calls[0][0];
      expect(message.lane).toBe('campaign');
      expect(message.to).toBe('s1@example.com');
      expect(message.subject).toBe('Hello');
      expect(message.html).toContain('Hi s1@example.com');
      expect(message.headers['List-Unsubscribe']).toMatch(/^<https:\/\/.+token=tok.*>$/);
      expect(message.text).toContain('Unsubscribe: https://');
      expect(message.text).toContain('token=tok');
    });

    it('returns how many were delivered so the caller can spend the hourly budget', async () => {
      email.deliver
        .mockResolvedValueOnce({ ok: true, messageId: 'a' })
        .mockResolvedValueOnce({ ok: false, kind: 'permanent', systemic: false, error: '550 no such user' })
        .mockResolvedValueOnce({ ok: true, messageId: 'c' });

      expect(await runBatch([row(1), row(2), row(3)])).toBe(2);
    });

    it('attempts nothing when the hourly budget is used up, but still checks for completion', async () => {
      counts.unfinished = 4;

      const delivered = await runBatch([row(1)], 0);

      expect(delivered).toBe(0);
      expect(prisma.newsletter_campaign_recipients.findMany).not.toHaveBeenCalled();
      expect(email.deliver).not.toHaveBeenCalled();
      expect(audit.write).not.toHaveBeenCalled();
    });

    it('never asks for more rows than the batch size or the remaining budget', async () => {
      await runBatch([], 3);
      await runBatch([], 500);

      const takes = prisma.newsletter_campaign_recipients.findMany.mock.calls.map(([args]: any[]) => args.take);
      expect(takes).toEqual([3, CONFIG.batchSize]);
    });

    it('selects only rows that are due: unfinished, out of back-off, not leased, attempts left', async () => {
      await runBatch([]);

      const query = prisma.newsletter_campaign_recipients.findMany.mock.calls[0][0];
      expect(query.where).toEqual({
        campaign_id: 'c-1',
        sent_at: null,
        failed_at: null,
        attempts: { lt: CONFIG.maxAttempts },
        AND: [
          { OR: [{ next_retry_at: null }, { next_retry_at: { lte: NOW } }] },
          { OR: [{ claimed_until: null }, { claimed_until: { lt: NOW } }] },
        ],
      });
    });

    it('marks recipients who unsubscribed since the snapshot as failed without an SMTP send', async () => {
      await runBatch([row(1, { sub: { is_active: false } }), row(2, { sub: { is_active: true, deleted_at: new Date() } })]);

      expect(email.deliver).not.toHaveBeenCalled();
      expect(recipientWrites()).toContainEqual(
        expect.objectContaining({
          where: expect.objectContaining({ subscriber_id: { in: ['s-1', 's-2'] } }),
          data: expect.objectContaining({ error_message: 'Subscriber unsubscribed before send' }),
        }),
      );
    });
  });

  describe('processCampaignBatch — failures', () => {
    it('a permanent failure (address refused) is final at once', async () => {
      email.deliver.mockResolvedValue({ ok: false, kind: 'permanent', systemic: false, error: '550 no such user' });

      await runBatch([row(1)]);

      expect(failedWrites()).toHaveLength(1);
      expect(failedWrites()[0].data.error_message).toBe('permanent: 550 no such user');
      expect(retryWrites()).toHaveLength(0);
    });

    it('a transient failure keeps the recipient in the queue with a back-off, not a failed mark', async () => {
      email.deliver.mockResolvedValue({ ok: false, kind: 'transient', systemic: false, error: '451 try later' });

      await runBatch([row(1, { attempts: 0 })]);

      expect(failedWrites()).toHaveLength(0);
      expect(retryWrites()).toHaveLength(1);
      const { next_retry_at, claimed_until, error_message } = retryWrites()[0].data;
      expect(claimed_until).toBeNull();
      expect(error_message).toBe('451 try later');
      // First failure → about five minutes.
      const delay = next_retry_at.getTime() - Date.now();
      expect(delay).toBeGreaterThan(4.9 * 60_000);
      expect(delay).toBeLessThan(5.1 * 60_000);
    });

    it('backs off longer after each further failure', async () => {
      email.deliver.mockResolvedValue({ ok: false, kind: 'transient', systemic: false, error: '451' });

      await runBatch([row(1, { attempts: 2 })]); // this send is the 3rd attempt

      const delay = retryWrites()[0].data.next_retry_at.getTime() - Date.now();
      expect(delay).toBeGreaterThan(19.9 * 60_000);
      expect(delay).toBeLessThan(20.1 * 60_000);
    });

    it('gives up once the attempts are used up', async () => {
      email.deliver.mockResolvedValue({ ok: false, kind: 'transient', systemic: false, error: '451 try later' });

      await runBatch([row(1, { attempts: CONFIG.maxAttempts - 1 })]); // 5th attempt

      expect(retryWrites()).toHaveLength(0);
      expect(failedWrites()).toHaveLength(1);
      expect(failedWrites()[0].data.error_message).toBe('gave up after 5 attempts: 451 try later');
    });

    it('an unexpected exception counts as that recipient\'s transient failure and does not abort the batch', async () => {
      email.deliver
        .mockRejectedValueOnce(new Error('renderer exploded'))
        .mockResolvedValueOnce({ ok: true, messageId: 'b' });

      const delivered = await runBatch([row(1), row(2)]);

      expect(delivered).toBe(1);
      expect(retryWrites()).toHaveLength(1);
      expect(retryWrites()[0].data.error_message).toBe('renderer exploded');
    });
  });

  describe('processCampaignBatch — circuit breaker', () => {
    const smtpDown = { ok: false, kind: 'transient', systemic: true, error: 'Connection timeout' };

    it('a systemic failure pauses the campaign instead of failing recipients', async () => {
      email.deliver.mockResolvedValue(smtpDown);

      await runBatch([row(1)]);

      expect(failedWrites()).toHaveLength(0);
      expect(retryWrites()).toHaveLength(0);
      const pause = prisma.newsletter_campaigns.updateMany.mock.calls
        .map(([args]: any[]) => args)
        .find((a: any) => a.data.paused_until instanceof Date);
      expect(pause.where).toEqual({ id: 'c-1', status: 'sending' });
      expect(pause.data.last_error).toBe('Connection timeout');
      expect(pause.data.paused_until.getTime() - Date.now()).toBeGreaterThan(14 * 60_000);
    });

    it('gives the attempt back: a server-side outage is not the recipient\'s fault', async () => {
      email.deliver.mockResolvedValue(smtpDown);

      await runBatch([row(1)]);

      expect(claims()).toHaveLength(1);
      expect(releases()).toHaveLength(1);
      expect(releases()[0].data.claimed_until).toBeNull();
    });

    it('stops starting new sends once one has failed systemically', async () => {
      email.deliver.mockResolvedValue(smtpDown);
      // 12 recipients but only 5 run at once; after the first failure lands the rest must not start.
      const rows = Array.from({ length: 12 }, (_, i) => row(i + 1));

      await runBatch(rows);

      expect(email.deliver.mock.calls.length).toBeLessThan(12);
      expect(claims().length).toBe(email.deliver.mock.calls.length);
    });

    it('does not complete a paused campaign', async () => {
      email.deliver.mockResolvedValue(smtpDown);
      counts.unfinished = 0;

      await runBatch([row(1)]);

      expect(audit.write).not.toHaveBeenCalled();
    });

    it('clears a stale pause once mail flows again', async () => {
      await runBatch([row(1)]);

      expect(prisma.newsletter_campaigns.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'c-1',
          status: 'sending',
          OR: [{ paused_until: { not: null } }, { last_error: { not: null } }],
        },
        data: { paused_until: null, last_error: null },
      });
    });
  });

  describe('processCampaignBatch — counters and completion', () => {
    it('recomputes delivered/failed from the recipient rows after a batch', async () => {
      counts.delivered = 7;
      counts.failed = 2;

      await runBatch([row(1)]);

      expect(prisma.newsletter_campaigns.update).toHaveBeenCalledWith({
        where: { id: 'c-1' },
        data: { delivered_count: 7, failed_count: 2 },
      });
    });

    it('does not finish while rows are still waiting out a back-off or a lease', async () => {
      counts.unfinished = 2;

      await runBatch([]);

      expect(prisma.newsletter_campaigns.updateMany).not.toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'sent' }) }),
      );
      expect(audit.write).not.toHaveBeenCalled();
    });

    it('finishes as sent, and audits it, once nothing is unfinished', async () => {
      counts.unfinished = 0;
      counts.delivered = 42;
      counts.failed = 1;
      prisma.newsletter_campaigns.findUnique.mockResolvedValue({ recipient_count: 43 });

      await runBatch([]);

      expect(prisma.newsletter_campaigns.updateMany).toHaveBeenCalledWith({
        where: { id: 'c-1', status: 'sending' },
        data: expect.objectContaining({ status: 'sent', paused_until: null }),
      });
      expect(audit.write).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AUDIT_ACTIONS.NEWSLETTER_CAMPAIGN_COMPLETED,
          resourceId: 'c-1',
          changes: { delivered_count: 42, failed_count: 1, recipient_count: 43 },
        }),
      );
    });

    it('finishes as failed when not one recipient was reached', async () => {
      counts.unfinished = 0;
      counts.delivered = 0;
      counts.failed = 5;
      prisma.newsletter_campaigns.findUnique.mockResolvedValue({ recipient_count: 5 });

      await runBatch([]);

      expect(prisma.newsletter_campaigns.updateMany).toHaveBeenCalledWith({
        where: { id: 'c-1', status: 'sending' },
        data: expect.objectContaining({ status: 'failed' }),
      });
    });

    it('skips completion + audit when a concurrent cancel won the race', async () => {
      counts.unfinished = 0;
      counts.delivered = 5;
      prisma.newsletter_campaigns.findUnique.mockResolvedValue({ recipient_count: 5 });
      prisma.newsletter_campaigns.updateMany.mockResolvedValue({ count: 0 });

      await runBatch([]);

      expect(audit.write).not.toHaveBeenCalled();
    });

    it('re-populates a stranded campaign (recipient_count NULL) instead of finishing it', async () => {
      counts.unfinished = 0;
      counts.rows = 3; // the snapshot INSERT gains rows
      prisma.newsletter_campaigns.findUnique.mockResolvedValue({ recipient_count: null });

      await runBatch([]);

      expect(prisma.$executeRaw).toHaveBeenCalled();
      expect(audit.write).not.toHaveBeenCalled();
      expect(prisma.newsletter_campaigns.updateMany).not.toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'sent' }) }),
      );
    });

    it('marks a campaign with no audience failed, with the reason, instead of "sent to nobody"', async () => {
      counts.unfinished = 0;
      counts.rows = 0;
      prisma.newsletter_campaigns.findUnique.mockResolvedValue({ recipient_count: null });

      await runBatch([]);

      expect(prisma.newsletter_campaigns.updateMany).toHaveBeenCalledWith({
        where: { id: 'c-1', status: 'sending' },
        data: expect.objectContaining({ status: 'failed', last_error: 'No active subscribers to send to' }),
      });
    });

    it('fails rows that used up every attempt without an outcome, so the campaign can finish', async () => {
      await runBatch([]);

      expect(recipientWrites()).toContainEqual({
        where: expect.objectContaining({
          campaign_id: 'c-1',
          sent_at: null,
          failed_at: null,
          attempts: { gte: CONFIG.maxAttempts },
        }),
        data: expect.objectContaining({ failed_at: NOW, error_message: expect.stringContaining('gave up after 5 attempts') }),
      });
    });
  });
});
