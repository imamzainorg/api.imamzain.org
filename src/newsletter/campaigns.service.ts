import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { cronsDisabled } from '../common/utils/cron.util';
import { newsletter_campaign_status, Prisma } from '@prisma/client';
import pLimit from 'p-limit';
import { EmailSendResult, EmailService, stripHtml } from '../email/email.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import { AUDIT_ACTIONS } from '../common/audit/audit.actions';
import { sanitizeEditorHtml } from '../common/utils/html-sanitize.util';
import { buildPaginationMeta, resolvePagination } from '../common/utils/pagination.util';
import { ADVISORY_LOCK_KEYS, withAdvisoryLock } from '../common/utils/advisory-lock.util';
import { NewsletterService } from './newsletter.service';
import {
  CampaignQueryDto,
  CreateCampaignDto,
  UpdateCampaignDto,
} from './dto/campaign.dto';
import {
  parseScheduledAt,
  resolveSenderConfig,
  retryDelayMs,
  SenderConfig,
  truncateError,
} from './delivery.util';

/**
 * Upper bound on how long the sender's advisory-lock transaction may run for a
 * single tick. Sits well above a realistic SMTP batch (10 emails at concurrency
 * 5 ≈ seconds) and above the 60s cron interval, so a slow batch can't trip the
 * util's 120s default and abort the tick mid-send.
 */
const SENDER_LOCK_TIMEOUT_MS = 300_000;

/** Maximum number of SMTP sends in flight at once. */
const SMTP_CONCURRENCY = 5;

/**
 * Lease taken on a recipient row right before its SMTP call. It exists for the
 * cases the advisory lock cannot cover: a tick whose lock transaction timed out
 * while its sends were still running, and a process that died mid-send — in both
 * the row is simply free again once the lease lapses. Well above the transport's
 * worst-case wait (10s connect + 10s greeting + 20s socket).
 */
const CLAIM_LEASE_MS = 5 * 60_000;

const ONE_HOUR_MS = 3_600_000;

/** How often the "SMTP is not configured" warning may repeat. */
const UNCONFIGURED_WARN_EVERY_MS = ONE_HOUR_MS;

const NO_SUBSCRIBERS_MESSAGE = 'No active subscribers to send to';

/**
 * Default unsubscribe-page URL used to build the {{unsubscribe_url}}
 * substitution if NEWSLETTER_UNSUBSCRIBE_URL_BASE is unset. The CMS /
 * front-end is responsible for hosting an unsubscribe page that calls
 * POST /newsletter/unsubscribe with the { email, token } payload.
 */
function unsubscribeUrl(email: string, token: string): string {
  const base =
    process.env.NEWSLETTER_UNSUBSCRIBE_URL_BASE ??
    'https://imamzain.org/newsletter/unsubscribe';
  const u = new URL(base);
  u.searchParams.set('email', email);
  u.searchParams.set('token', token);
  return u.toString();
}

const DEFAULT_FOOTER_TEMPLATE = `
  <hr style="margin-top:32px;border:none;border-top:1px solid #ddd"/>
  <p style="font-size:12px;color:#888;text-align:center">
    You're receiving this because you subscribed at imamzain.org.<br/>
    <a href="{{unsubscribe_url}}" style="color:#888">Unsubscribe</a>
  </p>
`;

interface SendableCampaign {
  id: string;
  subject: string;
  body_html: string;
}

interface BatchSubscriber {
  id: string;
  email: string;
  is_active: boolean;
  deleted_at: Date | null;
}

interface BatchRow {
  subscriber_id: string;
  attempts: number;
  newsletter_subscribers: BatchSubscriber;
}

const isDeliverable = (s: BatchSubscriber) => s.is_active && s.deleted_at === null;

@Injectable()
export class CampaignsService {
  private readonly logger = new Logger(CampaignsService.name);
  private isRunning = false;
  private lastUnconfiguredWarnAt = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly newsletter: NewsletterService,
    private readonly email: EmailService,
    private readonly audit: AuditService,
  ) {}

  // ── CRUD ──────────────────────────────────────────────────────────────

  async create(dto: CreateCampaignDto, userId: string) {
    const scheduledAt = dto.scheduled_at ? parseScheduledAt(dto.scheduled_at) : null;
    const status: newsletter_campaign_status = scheduledAt ? 'scheduled' : 'draft';
    const campaign = await this.prisma.newsletter_campaigns.create({
      data: {
        subject: dto.subject,
        body_html: sanitizeEditorHtml(dto.body_html),
        status,
        scheduled_at: scheduledAt,
        source_resource_type: dto.source_resource_type ?? null,
        source_resource_id: dto.source_resource_id ?? null,
        created_by: userId,
      },
    });

    await this.audit.write({
      actorId: userId,
      action: AUDIT_ACTIONS.NEWSLETTER_CAMPAIGN_CREATED,
      resourceType: 'newsletter_campaign',
      resourceId: campaign.id,
      changes: { method: 'POST', path: '/api/v1/newsletter/campaigns', status },
    });

    return { message: 'Campaign created', data: campaign };
  }

  async findAll(query: CampaignQueryDto) {
    const { page, limit, skip } = resolvePagination(query);

    const where: Prisma.newsletter_campaignsWhereInput = query.status ? { status: query.status } : {};

    const [items, total] = await Promise.all([
      this.prisma.newsletter_campaigns.findMany({
        where,
        orderBy: [{ created_at: 'desc' }, { id: 'asc' }],
        skip,
        take: limit,
      }),
      this.prisma.newsletter_campaigns.count({ where }),
    ]);

    return {
      message: 'Campaigns fetched',
      data: { items, pagination: buildPaginationMeta(page, limit, total) },
    };
  }

  async findOne(id: string) {
    const campaign = await this.prisma.newsletter_campaigns.findUnique({ where: { id } });
    if (!campaign) throw new NotFoundException('Campaign not found');
    return { message: 'Campaign fetched', data: campaign };
  }

  async update(id: string, dto: UpdateCampaignDto, userId: string) {
    const campaign = await this.prisma.newsletter_campaigns.findUnique({ where: { id } });
    if (!campaign) throw new NotFoundException('Campaign not found');
    if (campaign.status !== 'draft' && campaign.status !== 'scheduled') {
      throw new ConflictException(
        `Cannot update a campaign in status "${campaign.status}" — only draft and scheduled are editable`,
      );
    }

    const data: Prisma.newsletter_campaignsUpdateInput = { updated_at: new Date() };
    if (dto.subject !== undefined) data.subject = dto.subject;
    if (dto.body_html !== undefined) data.body_html = sanitizeEditorHtml(dto.body_html);
    if (dto.scheduled_at !== undefined) {
      const scheduledAt = dto.scheduled_at
        ? parseScheduledAt(dto.scheduled_at, { unchangedFrom: campaign.scheduled_at })
        : null;
      data.scheduled_at = scheduledAt;
      // Flip status to match the new schedule.
      data.status = scheduledAt ? 'scheduled' : 'draft';
    }
    if (dto.source_resource_type !== undefined) data.source_resource_type = dto.source_resource_type;
    if (dto.source_resource_id !== undefined) data.source_resource_id = dto.source_resource_id;

    const updated = await this.prisma.newsletter_campaigns.update({ where: { id }, data });

    await this.audit.write({
      actorId: userId,
      action: AUDIT_ACTIONS.NEWSLETTER_CAMPAIGN_UPDATED,
      resourceType: 'newsletter_campaign',
      resourceId: id,
      changes: { method: 'PATCH', path: `/api/v1/newsletter/campaigns/${id}` },
    });

    return { message: 'Campaign updated', data: updated };
  }

  /**
   * Hard-delete; only allowed while nothing has reached subscribers: a draft, a
   * cancelled campaign, or a failed one (which by definition delivered nothing).
   */
  async delete(id: string, userId: string) {
    const campaign = await this.prisma.newsletter_campaigns.findUnique({ where: { id } });
    if (!campaign) throw new NotFoundException('Campaign not found');
    if (campaign.status !== 'draft' && campaign.status !== 'cancelled' && campaign.status !== 'failed') {
      throw new ConflictException(
        `Cannot delete a campaign in status "${campaign.status}" — only draft, cancelled and failed campaigns can be deleted`,
      );
    }

    // newsletter_campaign_recipients cascades via FK ON DELETE CASCADE.
    await this.prisma.newsletter_campaigns.delete({ where: { id } });

    await this.audit.write({
      actorId: userId,
      action: AUDIT_ACTIONS.NEWSLETTER_CAMPAIGN_DELETED,
      resourceType: 'newsletter_campaign',
      resourceId: id,
      changes: { method: 'DELETE', path: `/api/v1/newsletter/campaigns/${id}` },
    });

    return { message: 'Campaign deleted', data: null };
  }

  // ── Lifecycle transitions ─────────────────────────────────────────────

  /** Nothing can be delivered without SMTP; refuse up front instead of queueing mail that can never leave. */
  private assertCanDeliver(): void {
    if (this.email.isConfigured('campaign')) return;
    throw new ServiceUnavailableException({
      message: 'Email delivery is not configured on this server (SMTP settings are missing), so nothing can be sent',
      code: 'SMTP_NOT_CONFIGURED',
    });
  }

  /**
   * Move a draft to sending immediately. The actual delivery happens in the
   * cron tick: we mark the campaign sending, populate the recipient table
   * with one row per active subscriber, and let `runSendingTick` work through
   * them in paced batches. This way the response stays fast and a crash mid-send
   * doesn't lose anything — the cron resumes from the pending recipient rows.
   *
   * A campaign is never consumed by a send that cannot happen: SMTP not
   * configured, or nobody to send to, leaves it exactly as it was.
   */
  async send(id: string, userId: string) {
    this.assertCanDeliver();

    const campaign = await this.prisma.newsletter_campaigns.findUnique({
      where: { id },
      select: { status: true },
    });
    if (!campaign) throw new NotFoundException('Campaign not found');
    if (campaign.status !== 'draft' && campaign.status !== 'scheduled') {
      throw new ConflictException(
        'Campaign is not in a sendable state — only draft and scheduled campaigns can be sent',
      );
    }

    // Check the audience BEFORE flipping the status. Flipping first and
    // rejecting afterwards used to leave the campaign 'sent' to nobody.
    const audience = await this.prisma.newsletter_subscribers.count({
      where: { is_active: true, deleted_at: null },
    });
    if (audience === 0) throw new BadRequestException(NO_SUBSCRIBERS_MESSAGE);

    const flipped = await this.prisma.newsletter_campaigns.updateMany({
      where: { id, status: campaign.status },
      data: { status: 'sending', paused_until: null, last_error: null, updated_at: new Date() },
    });
    if (flipped.count === 0) {
      throw new ConflictException(
        'Campaign is not in a sendable state — only draft and scheduled campaigns can be sent',
      );
    }

    const recipientCount = await this.populateRecipients(id);
    if (recipientCount === 0) {
      // Every subscriber left between the count and the insert. Hand the
      // campaign back the way it was rather than leaving it stuck in 'sending'.
      await this.prisma.newsletter_campaigns.updateMany({
        where: { id, status: 'sending' },
        data: { status: campaign.status, updated_at: new Date() },
      });
      throw new BadRequestException(NO_SUBSCRIBERS_MESSAGE);
    }

    await this.audit.write({
      actorId: userId,
      action: AUDIT_ACTIONS.NEWSLETTER_CAMPAIGN_SEND_QUEUED,
      resourceType: 'newsletter_campaign',
      resourceId: id,
      changes: {
        method: 'POST',
        path: `/api/v1/newsletter/campaigns/${id}/send`,
        recipient_count: recipientCount,
      },
    });

    return { message: 'Campaign queued for sending', data: { id, recipient_count: recipientCount } };
  }

  /**
   * `failed` used to be a dead end. Retry puts the failed recipients whose
   * subscriber is still on the list back in the queue (attempts reset) and the
   * campaign back to `sending`; the tick takes it from there.
   */
  async retry(id: string, userId: string) {
    this.assertCanDeliver();

    const campaign = await this.prisma.newsletter_campaigns.findUnique({
      where: { id },
      select: { status: true, sent_at: true },
    });
    if (!campaign) throw new NotFoundException('Campaign not found');
    if (campaign.status !== 'failed') {
      throw new ConflictException(
        `Only failed campaigns can be retried — this one is "${campaign.status}"`,
      );
    }

    const flipped = await this.prisma.newsletter_campaigns.updateMany({
      where: { id, status: 'failed' },
      data: { status: 'sending', sent_at: null, paused_until: null, last_error: null, updated_at: new Date() },
    });
    if (flipped.count === 0) {
      throw new ConflictException('Campaign is no longer in the failed state');
    }

    let queued = await this.requeueFailedRecipients(id);
    if (queued === 0) {
      // A campaign that failed for want of an audience has no recipient rows at
      // all: take a fresh snapshot. One that has rows keeps its original
      // audience — subscribers who joined later are not added to a retry.
      const existingRows = await this.prisma.newsletter_campaign_recipients.count({ where: { campaign_id: id } });
      if (existingRows === 0) queued = await this.populateRecipients(id);
    }
    if (queued === 0) {
      await this.prisma.newsletter_campaigns.updateMany({
        where: { id, status: 'sending' },
        data: { status: 'failed', sent_at: campaign.sent_at, updated_at: new Date() },
      });
      throw new ConflictException('Nothing to retry — every failed recipient has since left the list');
    }

    await this.refreshCounters(id);

    await this.audit.write({
      actorId: userId,
      action: AUDIT_ACTIONS.NEWSLETTER_CAMPAIGN_RETRIED,
      resourceType: 'newsletter_campaign',
      resourceId: id,
      changes: { method: 'POST', path: `/api/v1/newsletter/campaigns/${id}/retry`, requeued: queued },
    });

    return { message: 'Campaign queued for another attempt', data: { id, recipient_count: queued } };
  }

  async cancel(id: string, userId: string) {
    const result = await this.prisma.newsletter_campaigns.updateMany({
      where: { id, status: { in: ['draft', 'scheduled', 'sending'] } },
      data: { status: 'cancelled', updated_at: new Date() },
    });
    if (result.count === 0) {
      throw new ConflictException('Campaign is not in a cancellable state');
    }

    await this.audit.write({
      actorId: userId,
      action: AUDIT_ACTIONS.NEWSLETTER_CAMPAIGN_CANCELLED,
      resourceType: 'newsletter_campaign',
      resourceId: id,
      changes: { method: 'POST', path: `/api/v1/newsletter/campaigns/${id}/cancel` },
    });

    return { message: 'Campaign cancelled', data: null };
  }

  // ── Internal: recipient setup ─────────────────────────────────────────

  /**
   * Insert one recipient row per currently-active subscriber. Uses a single
   * `INSERT ... SELECT` so the subscriber list never has to round-trip
   * through the node process — important at scale (50k+ subscribers).
   * Idempotent via ON CONFLICT DO NOTHING.
   *
   * "Active" is the whole consent check: under double opt-in a subscriber only
   * becomes is_active through the confirmation link (or an admin), and
   * subscribers who joined before double opt-in are grandfathered active.
   */
  private async populateRecipients(campaignId: string): Promise<number> {
    await this.prisma.$executeRaw`
      INSERT INTO newsletter_campaign_recipients (campaign_id, subscriber_id)
      SELECT ${campaignId}::uuid, id
      FROM newsletter_subscribers
      WHERE is_active = TRUE AND deleted_at IS NULL
      ON CONFLICT (campaign_id, subscriber_id) DO NOTHING
    `;

    // Re-count from the recipients table — a re-send via the cron should see
    // the existing total, not just the rows added by this call.
    const recipientCount = await this.prisma.newsletter_campaign_recipients.count({
      where: { campaign_id: campaignId },
    });

    await this.prisma.newsletter_campaigns.update({
      where: { id: campaignId },
      data: { recipient_count: recipientCount },
    });

    return recipientCount;
  }

  /** Put failed recipients whose subscriber is still on the list back in the queue. */
  private async requeueFailedRecipients(campaignId: string): Promise<number> {
    return this.prisma.$executeRaw`
      UPDATE newsletter_campaign_recipients r
         SET failed_at = NULL, error_message = NULL, attempts = 0,
             next_retry_at = NULL, claimed_until = NULL
        FROM newsletter_subscribers s
       WHERE r.campaign_id = ${campaignId}::uuid
         AND r.failed_at IS NOT NULL
         AND s.id = r.subscriber_id
         AND s.is_active = TRUE AND s.deleted_at IS NULL
    `;
  }

  /**
   * The per-campaign counters are derived from the recipient rows every time
   * rather than incremented: a crash between "row updated" and "counter bumped"
   * can then never leave them wrong for good.
   */
  private async refreshCounters(campaignId: string): Promise<{ delivered: number; failed: number }> {
    const [delivered, failed] = await Promise.all([
      this.prisma.newsletter_campaign_recipients.count({
        where: { campaign_id: campaignId, sent_at: { not: null } },
      }),
      this.prisma.newsletter_campaign_recipients.count({
        where: { campaign_id: campaignId, failed_at: { not: null } },
      }),
    ]);
    await this.prisma.newsletter_campaigns.update({
      where: { id: campaignId },
      data: { delivered_count: delivered, failed_count: failed },
    });
    return { delivered, failed };
  }

  /**
   * Build a single email body for one recipient: substitute placeholders,
   * append the default unsubscribe footer if the body doesn't already include
   * a {{unsubscribe_url}} token.
   */
  private renderBody(body: string, email: string, unsubscribeUrlValue: string): string {
    let rendered = body;
    if (!rendered.includes('{{unsubscribe_url}}')) {
      rendered += DEFAULT_FOOTER_TEMPLATE;
    }
    // String.prototype.replaceAll would be cleaner but tsconfig.base targets
    // ES2020, which ts-node enforces strictly when running the seed / backfill
    // scripts. Regex/g works on every target.
    return rendered
      .replace(/\{\{unsubscribe_url\}\}/g, unsubscribeUrlValue)
      .replace(/\{\{email\}\}/g, email);
  }

  // ── Internal: the sending tick ────────────────────────────────────────

  /**
   * Cron-driven sender. Every minute:
   *   1. Promote scheduled campaigns whose time has come.
   *   2. Work out how much of the rolling-hour budget is left, then give each
   *      `sending` campaign (oldest first, skipping paused ones) a batch of due
   *      recipient rows, at most `batchSize`, at most what the budget allows.
   *   3. Finish campaigns that have no unfinished rows left.
   *
   * Every send is claim → SMTP → record, one recipient at a time, so a restart
   * can never re-send more than the few rows that were in flight.
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async runSendingTick() {
    if (cronsDisabled()) return;
    if (this.isRunning) {
      this.logger.log('runSendingTick skipped — previous run still in progress');
      return;
    }
    this.isRunning = true;
    try {
      // Without SMTP nothing can leave, and attempting anyway would burn every
      // recipient's attempts. Leave the queue exactly as it is.
      if (!this.email.isConfigured('campaign')) {
        const nowMs = Date.now();
        if (nowMs - this.lastUnconfiguredWarnAt >= UNCONFIGURED_WARN_EVERY_MS) {
          this.lastUnconfiguredWarnAt = nowMs;
          this.logger.warn('runSendingTick skipped — SMTP is not configured; campaigns stay queued');
        }
        return;
      }

      const config = resolveSenderConfig();

      // ScheduleModule runs this cron on every replica. Gate the whole tick
      // behind a Postgres advisory lock so only ONE instance sends a given
      // minute's batch. (isRunning still guards same-process overlap as a cheap
      // fast-path.) The per-recipient lease in processCampaignBatch covers the
      // case the lock cannot: a tick whose lock transaction timed out while its
      // sends were still running.
      const ran = await withAdvisoryLock(
        this.prisma,
        ADVISORY_LOCK_KEYS.NEWSLETTER_SENDER,
        async () => {
          const now = new Date();
          await this.promoteDueCampaigns(now);

          const inFlight = await this.prisma.newsletter_campaigns.findMany({
            where: {
              status: 'sending',
              OR: [{ paused_until: null }, { paused_until: { lte: now } }],
            },
            orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
            select: { id: true, subject: true, body_html: true },
          });
          if (inFlight.length === 0) return;

          let budget = await this.remainingBudget(config, now);
          for (const campaign of inFlight) {
            try {
              budget -= await this.processCampaignBatch(campaign, budget, config, now);
            } catch (err) {
              this.logger.warn(`Batch failed for campaign ${campaign.id}: ${err}`);
            }
          }
        },
        SENDER_LOCK_TIMEOUT_MS,
      );
      if (!ran) {
        this.logger.log('runSendingTick skipped — another instance holds the sender lock');
      }
    } catch (err) {
      // A lock-transaction timeout or transient DB error must not surface as an
      // unhandled promise rejection on the cron path — log it and let the next
      // tick retry. Per-recipient writes already committed, so no progress is
      // lost.
      this.logger.error(
        `runSendingTick failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      this.isRunning = false;
    }
  }

  private async promoteDueCampaigns(now: Date): Promise<void> {
    const due = await this.prisma.newsletter_campaigns.findMany({
      where: { status: 'scheduled', scheduled_at: { lte: now } },
      select: { id: true },
    });
    for (const { id } of due) {
      try {
        const flipped = await this.prisma.newsletter_campaigns.updateMany({
          where: { id, status: 'scheduled' },
          data: { status: 'sending', updated_at: now },
        });
        if (flipped.count === 0) continue;

        const recipients = await this.populateRecipients(id);
        if (recipients === 0) {
          // Nobody was on the list at the scheduled moment. Say so, rather than
          // finishing as a 'sent' campaign that reached no one.
          await this.prisma.newsletter_campaigns.updateMany({
            where: { id, status: 'sending' },
            data: { status: 'failed', sent_at: now, last_error: NO_SUBSCRIBERS_MESSAGE, updated_at: now },
          });
        }
      } catch (err) {
        this.logger.warn(`Failed to promote campaign ${id}: ${err}`);
      }
    }
  }

  /** What is left of the rolling-hour budget, counted from what actually went out. */
  private async remainingBudget(config: SenderConfig, now: Date): Promise<number> {
    const sentLastHour = await this.prisma.newsletter_campaign_recipients.count({
      where: { sent_at: { gte: new Date(now.getTime() - ONE_HOUR_MS) } },
    });
    return Math.max(0, config.perHour - sentLastHour);
  }

  /** @returns how many messages were delivered, so the caller can spend the budget. */
  private async processCampaignBatch(
    campaign: SendableCampaign,
    budget: number,
    config: SenderConfig = resolveSenderConfig(),
    now: Date = new Date(),
  ): Promise<number> {
    await this.failExhaustedRecipients(campaign.id, config, now);

    const take = Math.min(config.batchSize, budget);
    const due: BatchRow[] =
      take > 0
        ? await this.prisma.newsletter_campaign_recipients.findMany({
            where: {
              campaign_id: campaign.id,
              sent_at: null,
              failed_at: null,
              attempts: { lt: config.maxAttempts },
              AND: [
                { OR: [{ next_retry_at: null }, { next_retry_at: { lte: now } }] },
                { OR: [{ claimed_until: null }, { claimed_until: { lt: now } }] },
              ],
            },
            select: {
              subscriber_id: true,
              attempts: true,
              newsletter_subscribers: {
                select: { id: true, email: true, is_active: true, deleted_at: true },
              },
            },
            orderBy: [{ attempts: 'asc' }, { subscriber_id: 'asc' }],
            take,
          })
        : [];

    if (due.length === 0) {
      // Nothing is sendable right now — everything is done, waiting out a
      // back-off, leased, or held back by the hourly budget. Only the first
      // finishes the campaign.
      await this.completeIfFinished(campaign.id);
      return 0;
    }

    // Unsubscribed-since-populate recipients get one bulk update, no SMTP send.
    const gone = due.filter((r) => !isDeliverable(r.newsletter_subscribers));
    const live = due.filter((r) => isDeliverable(r.newsletter_subscribers));

    const state = { delivered: 0, changed: false, haltedBy: null as string | null };

    if (gone.length > 0) {
      await this.prisma.newsletter_campaign_recipients.updateMany({
        where: {
          campaign_id: campaign.id,
          subscriber_id: { in: gone.map((r) => r.subscriber_id) },
          sent_at: null,
          failed_at: null,
        },
        data: {
          failed_at: now,
          claimed_until: null,
          next_retry_at: null,
          error_message: 'Subscriber unsubscribed before send',
        },
      });
      state.changed = true;
    }

    const limit = pLimit(SMTP_CONCURRENCY);
    await Promise.all(
      live.map((row) =>
        limit(async () => {
          // A systemic failure elsewhere in this batch: stop starting new sends.
          if (state.haltedBy !== null) return;
          if (!(await this.claim(campaign.id, row.subscriber_id))) return;

          let result: EmailSendResult;
          try {
            result = await this.deliverTo(campaign, row.newsletter_subscribers);
          } catch (err) {
            // Unexpected (a bug, not an SMTP outcome): treat as this recipient's
            // transient failure so the attempt cap ends any loop.
            result = {
              ok: false,
              kind: 'transient',
              systemic: false,
              error: err instanceof Error ? err.message : String(err),
            };
          }

          if (result.ok) {
            await this.recordSent(campaign.id, row.subscriber_id);
            state.delivered += 1;
          } else if (result.systemic) {
            // About OUR side (server down, login refused, over quota) — not this
            // recipient's fault. Give the attempt back and stop the batch.
            await this.releaseClaim(campaign.id, row.subscriber_id);
            state.haltedBy = result.error;
          } else {
            const attempts = row.attempts + 1;
            if (result.kind === 'permanent') {
              await this.recordFailed(campaign.id, row.subscriber_id, `permanent: ${result.error}`);
            } else if (attempts >= config.maxAttempts) {
              await this.recordFailed(
                campaign.id,
                row.subscriber_id,
                `gave up after ${attempts} attempts: ${result.error}`,
              );
            } else {
              await this.scheduleRetry(campaign.id, row.subscriber_id, result.error, attempts);
            }
          }
          state.changed = true;
        }),
      ),
    );

    if (state.haltedBy !== null) {
      const pausedUntil = new Date(Date.now() + config.pauseMs);
      await this.prisma.newsletter_campaigns.updateMany({
        where: { id: campaign.id, status: 'sending' },
        data: { paused_until: pausedUntil, last_error: truncateError(state.haltedBy) },
      });
      this.logger.warn(
        `Campaign ${campaign.id} paused until ${pausedUntil.toISOString()}: ${truncateError(state.haltedBy, 200)}`,
      );
    } else if (state.delivered > 0) {
      // Mail is flowing again — drop the stale pause banner.
      await this.prisma.newsletter_campaigns.updateMany({
        where: {
          id: campaign.id,
          status: 'sending',
          OR: [{ paused_until: { not: null } }, { last_error: { not: null } }],
        },
        data: { paused_until: null, last_error: null },
      });
    }

    if (state.changed) await this.refreshCounters(campaign.id);
    if (state.haltedBy === null) await this.completeIfFinished(campaign.id);

    return state.delivered;
  }

  private async deliverTo(campaign: SendableCampaign, subscriber: BatchSubscriber): Promise<EmailSendResult> {
    const url = unsubscribeUrl(subscriber.email, this.newsletter.signUnsubscribeToken(subscriber.id));
    const html = this.renderBody(campaign.body_html, subscriber.email, url);
    return this.email.deliver({
      to: subscriber.email,
      subject: campaign.subject,
      html,
      // The default plain-text part drops every link, which would leave a
      // text-only client with the word "Unsubscribe" and no address.
      text: `${stripHtml(html)}\n\nUnsubscribe: ${url}`,
      headers: { 'List-Unsubscribe': `<${url}>` },
      lane: 'campaign',
    });
  }

  // ── Internal: one recipient row's life ────────────────────────────────

  /**
   * Take the row (short lease + count the attempt) before touching SMTP.
   * Conditional on the campaign still being `sending`, so a cancel takes effect
   * on the very next recipient rather than the next tick.
   */
  private async claim(campaignId: string, subscriberId: string): Promise<boolean> {
    const at = new Date();
    const claimed = await this.prisma.newsletter_campaign_recipients.updateMany({
      where: {
        campaign_id: campaignId,
        subscriber_id: subscriberId,
        sent_at: null,
        failed_at: null,
        newsletter_campaigns: { status: 'sending' },
        OR: [{ claimed_until: null }, { claimed_until: { lt: at } }],
      },
      data: { claimed_until: new Date(at.getTime() + CLAIM_LEASE_MS), attempts: { increment: 1 } },
    });
    return claimed.count === 1;
  }

  private async recordSent(campaignId: string, subscriberId: string): Promise<void> {
    await this.prisma.newsletter_campaign_recipients.updateMany({
      where: { campaign_id: campaignId, subscriber_id: subscriberId, sent_at: null },
      data: { sent_at: new Date(), claimed_until: null, next_retry_at: null, error_message: null },
    });
  }

  private async recordFailed(campaignId: string, subscriberId: string, reason: string): Promise<void> {
    await this.prisma.newsletter_campaign_recipients.updateMany({
      where: { campaign_id: campaignId, subscriber_id: subscriberId, sent_at: null },
      data: {
        failed_at: new Date(),
        claimed_until: null,
        next_retry_at: null,
        error_message: truncateError(reason),
      },
    });
  }

  private async scheduleRetry(
    campaignId: string,
    subscriberId: string,
    reason: string,
    attempts: number,
  ): Promise<void> {
    await this.prisma.newsletter_campaign_recipients.updateMany({
      where: { campaign_id: campaignId, subscriber_id: subscriberId, sent_at: null },
      data: {
        claimed_until: null,
        next_retry_at: new Date(Date.now() + retryDelayMs(attempts)),
        error_message: truncateError(reason),
      },
    });
  }

  /** Undo the claim without charging the attempt (a systemic failure is not the recipient's). */
  private async releaseClaim(campaignId: string, subscriberId: string): Promise<void> {
    await this.prisma.newsletter_campaign_recipients.updateMany({
      where: { campaign_id: campaignId, subscriber_id: subscriberId, sent_at: null, failed_at: null },
      data: { claimed_until: null, attempts: { decrement: 1 } },
    });
  }

  /**
   * Rows that used up every attempt without an outcome ever being written —
   * the process died mid-send more often than the cap. Without this they would
   * never be picked again and would keep the campaign from finishing.
   */
  private async failExhaustedRecipients(campaignId: string, config: SenderConfig, now: Date): Promise<void> {
    await this.prisma.newsletter_campaign_recipients.updateMany({
      where: {
        campaign_id: campaignId,
        sent_at: null,
        failed_at: null,
        attempts: { gte: config.maxAttempts },
        OR: [{ claimed_until: null }, { claimed_until: { lt: now } }],
      },
      data: {
        failed_at: now,
        claimed_until: null,
        next_retry_at: null,
        error_message: `gave up after ${config.maxAttempts} attempts (delivery kept being interrupted)`,
      },
    });
  }

  /**
   * Finish a campaign only when NO row is unfinished — rows waiting out a
   * back-off or leased to a slow send still count. The terminal status comes
   * from counters recomputed off the rows.
   */
  private async completeIfFinished(campaignId: string): Promise<void> {
    const unfinished = await this.prisma.newsletter_campaign_recipients.count({
      where: { campaign_id: campaignId, sent_at: null, failed_at: null },
    });
    if (unfinished > 0) return;

    const { delivered, failed } = await this.refreshCounters(campaignId);
    const campaign = await this.prisma.newsletter_campaigns.findUnique({
      where: { id: campaignId },
      select: { recipient_count: true },
    });
    // recipient_count is nullable (Int?, no default), so a campaign stranded in
    // 'sending' with no recipient rows has it NULL — coerce NULL -> 0.
    const recipientTotal = campaign?.recipient_count ?? 0;

    // Stranded-campaign guard: a campaign can reach 'sending' with zero
    // recipient rows if populateRecipients failed after the status flip. Try to
    // populate now; if it gains recipients the next tick sends them.
    let noAudience = false;
    if (recipientTotal === 0) {
      const populated = await this.populateRecipients(campaignId);
      if (populated > 0) return;
      noAudience = true;
    }

    // A campaign where every recipient failed (or nobody was on the list) must
    // surface as 'failed', not a misleading 'sent'.
    const terminalStatus: newsletter_campaign_status = noAudience || delivered === 0 ? 'failed' : 'sent';

    // Conditionally finalize: only transition out of 'sending'. cancel()
    // legitimately flips a 'sending' campaign to 'cancelled', and that can race
    // this write. updateMany with a status guard makes the cancel win.
    const finalized = await this.prisma.newsletter_campaigns.updateMany({
      where: { id: campaignId, status: 'sending' },
      data: {
        status: terminalStatus,
        sent_at: new Date(),
        paused_until: null,
        ...(noAudience ? { last_error: NO_SUBSCRIBERS_MESSAGE } : {}),
      },
    });
    if (finalized.count === 0) {
      this.logger.log(
        `Campaign ${campaignId} no longer 'sending' (likely cancelled) — skipping completion`,
      );
      return;
    }
    this.logger.log(`Campaign ${campaignId} ${terminalStatus}: ${delivered} delivered, ${failed} failed`);
    await this.audit.write({
      actorId: null,
      action: AUDIT_ACTIONS.NEWSLETTER_CAMPAIGN_COMPLETED,
      resourceType: 'newsletter_campaign',
      resourceId: campaignId,
      changes: {
        delivered_count: delivered,
        failed_count: failed,
        recipient_count: recipientTotal,
      },
    });
  }
}
