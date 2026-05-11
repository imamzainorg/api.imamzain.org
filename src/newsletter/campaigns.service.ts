import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { newsletter_campaign_status } from '@prisma/client';
import { EmailService } from '../email/email.service';
import { PrismaService } from '../prisma/prisma.service';
import { sanitizeEditorHtml } from '../common/utils/html-sanitize.util';
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

  constructor(
    private readonly prisma: PrismaService,
    private readonly newsletter: NewsletterService,
    private readonly email: EmailService,
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

    try {
      await this.prisma.audit_logs.create({
        data: {
          user_id: userId,
          action: 'NEWSLETTER_CAMPAIGN_CREATED',
          resource_type: 'newsletter_campaign',
          resource_id: campaign.id,
          changes: { method: 'POST', path: '/api/v1/newsletter/campaigns', status },
        },
      });
    } catch (err) {
      this.logger.warn(`Failed to write NEWSLETTER_CAMPAIGN_CREATED audit: ${err}`);
    }

    return { message: 'Campaign created', data: campaign };
  }

  async findAll(query: CampaignQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const where = query.status ? { status: query.status } : {};

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
      data: { items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } },
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

    const data: Record<string, unknown> = { updated_at: new Date() };
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

    try {
      await this.prisma.audit_logs.create({
        data: {
          user_id: userId,
          action: 'NEWSLETTER_CAMPAIGN_UPDATED',
          resource_type: 'newsletter_campaign',
          resource_id: id,
          changes: { method: 'PATCH', path: `/api/v1/newsletter/campaigns/${id}` },
        },
      });
    } catch (err) {
      this.logger.warn(`Failed to write NEWSLETTER_CAMPAIGN_UPDATED audit: ${err}`);
    }

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

    try {
      await this.prisma.audit_logs.create({
        data: {
          user_id: userId,
          action: 'NEWSLETTER_CAMPAIGN_DELETED',
          resource_type: 'newsletter_campaign',
          resource_id: id,
          changes: { method: 'DELETE', path: `/api/v1/newsletter/campaigns/${id}` },
        },
      });
    } catch (err) {
      this.logger.warn(`Failed to write NEWSLETTER_CAMPAIGN_DELETED audit: ${err}`);
    }

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

    try {
      await this.prisma.audit_logs.create({
        data: {
          user_id: userId,
          action: 'NEWSLETTER_CAMPAIGN_SEND_QUEUED',
          resource_type: 'newsletter_campaign',
          resource_id: id,
          changes: {
            method: 'POST',
            path: `/api/v1/newsletter/campaigns/${id}/send`,
            recipient_count: recipientCount,
          },
        },
      });
    } catch (err) {
      this.logger.warn(`Failed to write SEND_QUEUED audit: ${err}`);
    }

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

    try {
      await this.prisma.audit_logs.create({
        data: {
          user_id: userId,
          action: 'NEWSLETTER_CAMPAIGN_CANCELLED',
          resource_type: 'newsletter_campaign',
          resource_id: id,
          changes: { method: 'POST', path: `/api/v1/newsletter/campaigns/${id}/cancel` },
        },
      });
    } catch (err) {
      this.logger.warn(`Failed to write CANCELLED audit: ${err}`);
    }

    return { message: 'Campaign cancelled', data: null };
  }

  // ── Internal: recipient setup + send tick ─────────────────────────────

  /**
   * Insert one recipient row per currently-active subscriber. `skipDuplicates`
   * keeps the call idempotent — if send() is called twice (or the cron picks
   * up a partially-populated campaign), the second pass is a no-op.
   */
  private async populateRecipients(campaignId: string): Promise<number> {
    const subscribers = await this.prisma.newsletter_subscribers.findMany({
      where: { is_active: true, deleted_at: null },
      select: { id: true },
    });

    if (subscribers.length > 0) {
      await this.prisma.newsletter_campaign_recipients.createMany({
        data: subscribers.map((s) => ({ campaign_id: campaignId, subscriber_id: s.id })),
        skipDuplicates: true,
      });
    }

    await this.prisma.newsletter_campaigns.update({
      where: { id: campaignId },
      data: { recipient_count: subscribers.length },
    });

    return subscribers.length;
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
    return rendered
      .replaceAll('{{unsubscribe_url}}', unsubscribeUrlValue)
      .replaceAll('{{email}}', email);
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
      return;
    }

    let delivered = 0;
    let failed = 0;
    for (const r of pending) {
      const subscriber = r.newsletter_subscribers;
      const token = this.newsletter.signUnsubscribeToken(subscriber.id);
      const html = this.renderBody(
        campaign.body_html,
        subscriber.email,
        unsubscribeUrl(subscriber.email, token),
      );

      const ok = await this.email.send(subscriber.email, campaign.subject, html);

      if (ok) {
        delivered++;
        await this.prisma.newsletter_campaign_recipients.update({
          where: {
            campaign_id_subscriber_id: { campaign_id: campaign.id, subscriber_id: subscriber.id },
          },
          data: { sent_at: new Date() },
        });
      } else {
        failed++;
        await this.prisma.newsletter_campaign_recipients.update({
          where: {
            campaign_id_subscriber_id: { campaign_id: campaign.id, subscriber_id: subscriber.id },
          },
          data: {
            failed_at: new Date(),
            error_message: 'EmailService.send returned false',
          },
        });
      }
    }

    if (delivered > 0 || failed > 0) {
      await this.prisma.newsletter_campaigns.update({
        where: { id: campaign.id },
        data: {
          delivered_count: { increment: delivered },
          failed_count: { increment: failed },
        },
      });
    }
  }
}
