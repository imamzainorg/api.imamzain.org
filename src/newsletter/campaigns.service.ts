import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { newsletter_campaign_status, Prisma } from '@prisma/client';
import pLimit from 'p-limit';
import { EmailService } from '../email/email.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import { AUDIT_ACTIONS } from '../common/audit/audit.actions';
import { sanitizeEditorHtml } from '../common/utils/html-sanitize.util';
import { buildPaginationMeta, resolvePagination } from '../common/utils/pagination.util';
import { NewsletterService } from './newsletter.service';
import {
  CampaignQueryDto,
  CreateCampaignDto,
  UpdateCampaignDto,
} from './dto/campaign.dto';

/**
 * How many recipients to attempt per cron tick. Hostinger SMTP currently
 * has per-connection limits in the ~100/hour range, so leaving sizeable
 * headroom keeps the API friendly to the shared mail server. Bump when
 * the team moves to a transactional ESP (Resend / Brevo / Mailgun).
 */
const BATCH_SIZE_PER_TICK = 50;

/**
 * Maximum number of SMTP sends to have in flight at once. Hostinger SMTP
 * advertises 100/hour per connection, but the actual rate-limit is on
 * sustained throughput — short bursts at ~5 in parallel finish well inside
 * the limit while shrinking batch wall-time from ~minutes to ~seconds.
 */
const SMTP_CONCURRENCY = 5;

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

@Injectable()
export class CampaignsService {
  private readonly logger = new Logger(CampaignsService.name);
  private isRunning = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly newsletter: NewsletterService,
    private readonly email: EmailService,
    private readonly audit: AuditService,
  ) {}

  // ── CRUD ──────────────────────────────────────────────────────────────

  async create(dto: CreateCampaignDto, userId: string) {
    const status: newsletter_campaign_status = dto.scheduled_at ? 'scheduled' : 'draft';
    const campaign = await this.prisma.newsletter_campaigns.create({
      data: {
        subject: dto.subject,
        body_html: sanitizeEditorHtml(dto.body_html),
        status,
        scheduled_at: dto.scheduled_at ? new Date(dto.scheduled_at) : null,
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
      data.scheduled_at = dto.scheduled_at ? new Date(dto.scheduled_at) : null;
      // Flip status to match the new schedule.
      data.status = data.scheduled_at ? 'scheduled' : 'draft';
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

  /** Hard-delete; only allowed while still a draft. */
  async delete(id: string, userId: string) {
    const campaign = await this.prisma.newsletter_campaigns.findUnique({ where: { id } });
    if (!campaign) throw new NotFoundException('Campaign not found');
    if (campaign.status !== 'draft' && campaign.status !== 'cancelled') {
      throw new ConflictException(
        `Cannot delete a campaign in status "${campaign.status}" — cancel it first`,
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

  /**
   * Move a draft to sending immediately. The actual delivery happens in the
   * cron tick: we mark the campaign sending, populate the recipient table
   * with one row per active subscriber, and let `runSendingTick` work through
   * them in batches. This way the response stays fast and a crash mid-send
   * doesn't lose anything — the cron resumes from the pending recipient rows.
   */
  async send(id: string, userId: string) {
    const result = await this.prisma.newsletter_campaigns.updateMany({
      where: { id, status: { in: ['draft', 'scheduled'] } },
      data: { status: 'sending', updated_at: new Date() },
    });
    if (result.count === 0) {
      throw new ConflictException(
        'Campaign is not in a sendable state — only draft and scheduled campaigns can be sent',
      );
    }

    const recipientCount = await this.populateRecipients(id);
    if (recipientCount === 0) {
      // Nothing to do — bounce the status to a terminal "sent" with zero
      // recipients so the campaign isn't stuck in sending forever.
      await this.prisma.newsletter_campaigns.update({
        where: { id },
        data: { status: 'sent', sent_at: new Date(), recipient_count: 0 },
      });
      throw new BadRequestException('No active subscribers to send to');
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

  // ── Internal: recipient setup + send tick ─────────────────────────────

  /**
   * Insert one recipient row per currently-active subscriber. Uses a single
   * `INSERT ... SELECT` so the subscriber list never has to round-trip
   * through the node process — important at scale (50k+ subscribers).
   * Idempotent via ON CONFLICT DO NOTHING.
   */
  private async populateRecipients(campaignId: string): Promise<number> {
    const inserted = await this.prisma.$executeRaw`
      INSERT INTO newsletter_campaign_recipients (campaign_id, subscriber_id)
      SELECT ${campaignId}::uuid, id
      FROM newsletter_subscribers
      WHERE is_active = TRUE AND deleted_at IS NULL
      ON CONFLICT (campaign_id, subscriber_id) DO NOTHING
    `;

    // Re-count from the recipients table — `inserted` only reflects rows added
    // in this call, but a re-send via the cron should see the existing total.
    const recipientCount = await this.prisma.newsletter_campaign_recipients.count({
      where: { campaign_id: campaignId },
    });

    await this.prisma.newsletter_campaigns.update({
      where: { id: campaignId },
      data: { recipient_count: recipientCount },
    });

    return recipientCount;
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

  /**
   * Cron-driven sender. Every minute:
   *   1. Promote scheduled campaigns whose time has come.
   *   2. For every campaign in `sending`, attempt up to BATCH_SIZE_PER_TICK
   *      pending recipient rows (sent_at IS NULL AND failed_at IS NULL).
   *      Each successful send sets sent_at + increments delivered_count;
   *      each failure sets failed_at + increments failed_count.
   *   3. When a campaign has no remaining pending rows, transition to sent.
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async runSendingTick() {
    if (this.isRunning) {
      this.logger.log('runSendingTick skipped — previous run still in progress');
      return;
    }
    this.isRunning = true;
    try {
      // Step 1: promote any due scheduled campaigns.
      const now = new Date();
      const promoted = await this.prisma.newsletter_campaigns.findMany({
        where: { status: 'scheduled', scheduled_at: { lte: now } },
        select: { id: true },
      });
      for (const { id } of promoted) {
        try {
          await this.prisma.newsletter_campaigns.updateMany({
            where: { id, status: 'scheduled' },
            data: { status: 'sending', updated_at: now },
          });
          await this.populateRecipients(id);
        } catch (err) {
          this.logger.warn(`Failed to promote campaign ${id}: ${err}`);
        }
      }

      // Step 2: process one batch per sending campaign.
      const inFlight = await this.prisma.newsletter_campaigns.findMany({
        where: { status: 'sending' },
        select: { id: true, subject: true, body_html: true },
      });

      for (const campaign of inFlight) {
        try {
          await this.processCampaignBatch(campaign);
        } catch (err) {
          this.logger.warn(`Batch failed for campaign ${campaign.id}: ${err}`);
        }
      }
    } finally {
      this.isRunning = false;
    }
  }

  private async processCampaignBatch(campaign: {
    id: string;
    subject: string;
    body_html: string;
  }) {
    const pending = await this.prisma.newsletter_campaign_recipients.findMany({
      where: { campaign_id: campaign.id, sent_at: null, failed_at: null },
      include: { newsletter_subscribers: true },
      take: BATCH_SIZE_PER_TICK,
    });

    if (pending.length === 0) {
      // All recipients processed; transition to sent (or failed if every
      // recipient errored). The denormalised counters on the campaign row
      // already reflect the totals.
      const updated = await this.prisma.newsletter_campaigns.update({
        where: { id: campaign.id },
        data: { status: 'sent', sent_at: new Date() },
      });
      this.logger.log(
        `Campaign ${campaign.id} complete: ${updated.delivered_count} delivered, ${updated.failed_count} failed`,
      );
      await this.audit.write({
        actorId: null,
        action: AUDIT_ACTIONS.NEWSLETTER_CAMPAIGN_COMPLETED,
        resourceType: 'newsletter_campaign',
        resourceId: campaign.id,
        changes: {
          delivered_count: updated.delivered_count,
          failed_count: updated.failed_count,
          recipient_count: updated.recipient_count,
        },
      });
      return;
    }

    // Categorise unsubscribed-since-populate recipients up front — they get
    // a single bulk update marking them failed, no SMTP send needed.
    const inactiveSubscriberIds: string[] = [];
    const liveTargets: typeof pending = [];
    for (const r of pending) {
      if (!r.newsletter_subscribers.is_active) {
        inactiveSubscriberIds.push(r.subscriber_id);
      } else {
        liveTargets.push(r);
      }
    }

    const deliveredIds: string[] = [];
    const failedIds: string[] = [];

    // Fan out SMTP sends with a small concurrency cap. The previous
    // sequential loop made an entire tick wait on `BATCH_SIZE × ~1s`
    // per email — at 50 emails that ran near the 60s cron interval.
    const limit = pLimit(SMTP_CONCURRENCY);
    await Promise.all(
      liveTargets.map((r) =>
        limit(async () => {
          const subscriber = r.newsletter_subscribers;
          const token = this.newsletter.signUnsubscribeToken(subscriber.id);
          const html = this.renderBody(
            campaign.body_html,
            subscriber.email,
            unsubscribeUrl(subscriber.email, token),
          );

          const ok = await this.email.send(subscriber.email, campaign.subject, html);
          if (ok) {
            deliveredIds.push(subscriber.id);
          } else {
            failedIds.push(subscriber.id);
          }
        }),
      ),
    );

    const now = new Date();
    const failedCount = failedIds.length + inactiveSubscriberIds.length;
    const deliveredCount = deliveredIds.length;

    // Two updateMany calls + one campaign-counters update — replaces 50
    // sequential per-recipient UPDATEs.
    await this.prisma.$transaction([
      ...(deliveredIds.length > 0
        ? [
            this.prisma.newsletter_campaign_recipients.updateMany({
              where: { campaign_id: campaign.id, subscriber_id: { in: deliveredIds } },
              data: { sent_at: now },
            }),
          ]
        : []),
      ...(failedIds.length > 0
        ? [
            this.prisma.newsletter_campaign_recipients.updateMany({
              where: { campaign_id: campaign.id, subscriber_id: { in: failedIds } },
              data: { failed_at: now, error_message: 'EmailService.send returned false' },
            }),
          ]
        : []),
      ...(inactiveSubscriberIds.length > 0
        ? [
            this.prisma.newsletter_campaign_recipients.updateMany({
              where: { campaign_id: campaign.id, subscriber_id: { in: inactiveSubscriberIds } },
              data: { failed_at: now, error_message: 'Subscriber unsubscribed before send' },
            }),
          ]
        : []),
      ...(deliveredCount > 0 || failedCount > 0
        ? [
            this.prisma.newsletter_campaigns.update({
              where: { id: campaign.id },
              data: {
                delivered_count: { increment: deliveredCount },
                failed_count: { increment: failedCount },
              },
            }),
          ]
        : []),
    ]);
  }
}
