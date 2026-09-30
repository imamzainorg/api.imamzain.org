import {
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  UnauthorizedException,
} from '@nestjs/common';
import { newsletter_subscribers, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import { AUDIT_ACTIONS } from '../common/audit/audit.actions';
import { EmailService } from '../email/email.service';
import { hmacHex, HmacKeyring, KEY_INFO, resolveHmacKeyring, verifyHmacHex } from '../common/utils/derive-key.util';
import { buildPaginationMeta } from '../common/utils/pagination.util';
import { isUniqueViolation } from '../common/utils/prisma-error.util';
import {
  buildConfirmationEmail,
  CONFIRM_RESEND_COOLDOWN_MS,
  CONFIRM_TTL_MS,
  confirmationUrl,
  resolveConfirmConfig,
} from './confirmation.util';
import { ConfirmSubscriptionDto, SubscribeDto, UnsubscribeDto } from './dto/newsletter.dto';

// A dedicated NEWSLETTER_UNSUBSCRIBE_SECRET is used as-is for both token types.
// Unset (or BLANK, as .env.example ships it) each type gets its own HKDF-derived
// key of JWT_SECRET instead of JWT_SECRET itself — subscriber ids are guessable
// inputs, so the raw key would hand anonymous callers known-plaintext MAC pairs —
// while tokens minted before that change (unsubscribe links already in sent
// campaigns, confirmation links still inside their 72 h) keep verifying.
function resolveTokenKeys(info: string): HmacKeyring {
  return resolveHmacKeyring({
    dedicatedSecret: process.env.NEWSLETTER_UNSUBSCRIBE_SECRET,
    dedicatedName: 'NEWSLETTER_UNSUBSCRIBE_SECRET',
    jwtSecret: process.env.JWT_SECRET,
    info,
  });
}

const ONE_HOUR_MS = 3_600_000;

// One answer for every address in every state — see subscribe().
const SUBSCRIBE_ACCEPTED_MESSAGE = 'Please check your inbox to confirm your subscription';
// One answer for every way a link can be bad — see confirm().
const INVALID_LINK_MESSAGE = 'This confirmation link is invalid or has expired';

/** On the list and mailable right now. */
const isLive = (s: Pick<newsletter_subscribers, 'is_active' | 'deleted_at'>) =>
  s.is_active && s.deleted_at === null;

@Injectable()
export class NewsletterService implements OnModuleDestroy {
  private readonly logger = new Logger(NewsletterService.name);
  private readonly unsubscribeKeys = resolveTokenKeys(KEY_INFO.newsletterUnsubscribe);
  private readonly confirmKeys = resolveTokenKeys(KEY_INFO.newsletterConfirm);
  /** Confirmation mails still being sent after their request already got its answer. */
  private readonly pendingSends = new Set<Promise<void>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly email: EmailService,
  ) {}

  /** Don't cut off a confirmation mail that is on the wire when the process is asked to stop. */
  async onModuleDestroy(): Promise<void> {
    await Promise.allSettled([...this.pendingSends]);
  }

  /**
   * HMAC of the subscriber id, required at unsubscribe time and embedded in the
   * unsubscribe link of every campaign e-mail. It is no longer handed out by
   * the public subscribe endpoint (which used to return it to whoever asked).
   *
   * Exposed publicly so the campaign sender can build unsubscribe URLs
   * for each recipient at send time. The secret is server-side only —
   * the token itself is safe to embed in outbound emails.
   */
  signUnsubscribeToken(subscriberId: string): string {
    return hmacHex(this.unsubscribeKeys.signingKey, subscriberId);
  }

  private verifyUnsubscribeToken(subscriberId: string, token: string): boolean {
    return verifyHmacHex(this.unsubscribeKeys, subscriberId, token);
  }

  /**
   * Bound to (subscriber, the moment that e-mail was claimed): requesting a
   * fresh confirmation kills every older link, and the `confirm:` prefix keeps
   * it from ever being the same string as an unsubscribe token.
   */
  private confirmationMessage(subscriberId: string, issuedAt: Date): string {
    return `confirm:${subscriberId}:${issuedAt.getTime()}`;
  }

  private signConfirmationToken(subscriberId: string, issuedAt: Date): string {
    return hmacHex(this.confirmKeys.signingKey, this.confirmationMessage(subscriberId, issuedAt));
  }

  private verifyConfirmationToken(subscriberId: string, issuedAt: Date, token: string): boolean {
    return verifyHmacHex(this.confirmKeys, this.confirmationMessage(subscriberId, issuedAt), token);
  }

  // ── Public: double opt-in ──────────────────────────────────────────────

  /**
   * Ask to join the list. Nobody is subscribed by this call: the address gets a
   * confirmation e-mail and only clicking its link (POST /newsletter/confirm)
   * makes the subscription real — so a stranger typing your address into the
   * form cannot subscribe you, or re-subscribe you after you opted out.
   *
   * The reply is deliberately identical for a new address, a pending one, an
   * unsubscribed one, a deleted one and one that is already subscribed. It used
   * to answer 409 for active addresses only (a membership oracle) and to return
   * the subscriber row plus its unsubscribe token to anyone who asked. The
   * confirmation mail is sent AFTER the reply is on its way, so response time
   * does not give the state away either.
   */
  async subscribe(dto: SubscribeDto) {
    await this.requestConfirmation(dto.email);
    return { message: SUBSCRIBE_ACCEPTED_MESSAGE, data: null };
  }

  private async requestConfirmation(email: string): Promise<void> {
    let subscriber = await this.prisma.newsletter_subscribers.findUnique({ where: { email } });
    if (subscriber && isLive(subscriber)) return; // already on the list: nothing to confirm

    let created = false;
    if (!subscriber) {
      try {
        // Inactive until the link is clicked — never mailable before that.
        subscriber = await this.prisma.newsletter_subscribers.create({ data: { email, is_active: false } });
        created = true;
      } catch (err: unknown) {
        if (!isUniqueViolation(err)) throw err;
        // A concurrent request created the row first; carry on with theirs.
        subscriber = await this.prisma.newsletter_subscribers.findUnique({ where: { email } });
        if (!subscriber || isLive(subscriber)) return;
      }
    }

    if (created) {
      await this.audit.write({
        actorId: null,
        action: AUDIT_ACTIONS.NEWSLETTER_SUBSCRIBE_REQUESTED,
        resourceType: 'newsletter_subscriber',
        resourceId: subscriber.id,
        changes: { method: 'POST', path: '/api/v1/newsletter/subscribe' },
      });
    }

    // An unsubscribed or deleted row is left exactly as it is until the link is
    // clicked: asking to come back must not undo an opt-out by itself.
    await this.sendConfirmation(subscriber);
  }

  /**
   * Claim the right to send one confirmation mail, then send it in the
   * background. Claiming is a conditional UPDATE on `confirmation_sent_at`, so
   * two concurrent requests send one mail and the per-address cool-down needs no
   * lock. Both limits fail quietly — the caller must not be able to tell.
   */
  private async sendConfirmation(subscriber: newsletter_subscribers): Promise<void> {
    if (!this.email.isConfigured()) {
      this.logger.warn('Newsletter confirmation not sent — SMTP is not configured');
      return;
    }

    const config = resolveConfirmConfig();
    const now = new Date();

    const claimedLastHour = await this.prisma.newsletter_subscribers.count({
      where: { confirmation_sent_at: { gte: new Date(now.getTime() - ONE_HOUR_MS) } },
    });
    if (claimedLastHour >= config.maxPerHour) {
      this.logger.warn(`Newsletter confirmation held back — hourly cap of ${config.maxPerHour} reached`);
      return;
    }

    const claim = await this.prisma.newsletter_subscribers.updateMany({
      where: {
        id: subscriber.id,
        OR: [
          { confirmation_sent_at: null },
          { confirmation_sent_at: { lt: new Date(now.getTime() - CONFIRM_RESEND_COOLDOWN_MS) } },
        ],
      },
      data: { confirmation_sent_at: now },
    });
    if (claim.count === 0) return; // inside the cool-down, or another request claimed it first

    const send = this.deliverConfirmation(subscriber, now, subscriber.confirmation_sent_at).catch((err: unknown) => {
      this.logger.error(`Newsletter confirmation failed: ${err instanceof Error ? err.message : String(err)}`);
    });
    this.pendingSends.add(send);
    void send.finally(() => this.pendingSends.delete(send));
  }

  private async deliverConfirmation(
    subscriber: newsletter_subscribers,
    claimedAt: Date,
    previousSentAt: Date | null,
  ): Promise<void> {
    let delivered = false;
    try {
      const token = this.signConfirmationToken(subscriber.id, claimedAt);
      const message = buildConfirmationEmail(
        confirmationUrl(resolveConfirmConfig().urlBase, subscriber.email, token),
      );
      const result = await this.email.deliver({
        to: subscriber.email,
        subject: message.subject,
        html: message.html,
        text: message.text,
        lane: 'transactional',
      });
      delivered = result.ok;
      if (!result.ok) {
        this.logger.warn(`Newsletter confirmation e-mail failed (${result.kind}): ${result.error}`);
      }
    } catch (err: unknown) {
      this.logger.error(
        `Newsletter confirmation e-mail failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (!delivered) {
      // Nothing reached the inbox, so neither the cool-down nor the hourly cap
      // should stay spent on it — the visitor can simply try again.
      await this.prisma.newsletter_subscribers.updateMany({
        where: { id: subscriber.id, confirmation_sent_at: claimedAt },
        data: { confirmation_sent_at: previousSentAt },
      });
    }
  }

  /**
   * The click. Turns a pending / opted-out / deleted address into an active
   * subscriber and stamps `confirmed_at` — the moment the CURRENT consent was
   * given. Every way a link can be bad (unknown address, wrong or superseded
   * token, expired, or the person opted out after it was issued) gets the same
   * 401, so the endpoint cannot be used to probe the list.
   */
  async confirm(dto: ConfirmSubscriptionDto) {
    const subscriber = await this.prisma.newsletter_subscribers.findUnique({ where: { email: dto.email } });
    const issuedAt = subscriber?.confirmation_sent_at ?? null;
    if (!subscriber || !issuedAt || !this.verifyConfirmationToken(subscriber.id, issuedAt, dto.token)) {
      throw new UnauthorizedException(INVALID_LINK_MESSAGE);
    }

    // Idempotent: a double click, or a refresh of the confirm page.
    if (isLive(subscriber)) return { message: 'Subscription already confirmed', data: null };

    const now = new Date();
    if (now.getTime() - issuedAt.getTime() > CONFIRM_TTL_MS) throw new UnauthorizedException(INVALID_LINK_MESSAGE);
    // Opted out (or removed by an admin) AFTER this link was sent: it no longer
    // speaks for them, so an old e-mail cannot quietly undo an unsubscribe.
    if (
      (subscriber.unsubscribed_at && subscriber.unsubscribed_at > issuedAt) ||
      (subscriber.deleted_at && subscriber.deleted_at > issuedAt)
    ) {
      throw new UnauthorizedException(INVALID_LINK_MESSAGE);
    }

    const activated = await this.prisma.newsletter_subscribers.updateMany({
      // Still inactive and still THIS link: two concurrent clicks activate once.
      where: { id: subscriber.id, is_active: false, confirmation_sent_at: issuedAt },
      data: { is_active: true, confirmed_at: now, unsubscribed_at: null, deleted_at: null },
    });
    if (activated.count === 0) {
      const fresh = await this.prisma.newsletter_subscribers.findUnique({ where: { id: subscriber.id } });
      if (fresh && isLive(fresh)) return { message: 'Subscription already confirmed', data: null };
      throw new UnauthorizedException(INVALID_LINK_MESSAGE);
    }

    await this.audit.write({
      actorId: null,
      action:
        subscriber.confirmed_at === null
          ? AUDIT_ACTIONS.NEWSLETTER_SUBSCRIBED
          : AUDIT_ACTIONS.NEWSLETTER_RESUBSCRIBED,
      resourceType: 'newsletter_subscriber',
      resourceId: subscriber.id,
      changes: { method: 'POST', path: '/api/v1/newsletter/confirm' },
    });

    return { message: 'Subscription confirmed', data: null };
  }

  async unsubscribe(dto: UnsubscribeDto) {
    const subscriber = await this.prisma.newsletter_subscribers.findUnique({
      where: { email: dto.email },
    });

    // Don't differentiate "not found" from "invalid token" — both return the
    // same generic error so an attacker cannot enumerate subscribers.
    if (!subscriber || !this.verifyUnsubscribeToken(subscriber.id, dto.token)) {
      throw new UnauthorizedException('Invalid unsubscribe token');
    }

    // Idempotent: already unsubscribed → 200 with the existing record so
    // double-clicking the unsubscribe link doesn't surface a confusing 404.
    if (!subscriber.is_active) {
      return { message: 'Already unsubscribed', data: subscriber };
    }

    const updated = await this.prisma.newsletter_subscribers.update({
      where: { id: subscriber.id },
      data: { is_active: false, unsubscribed_at: new Date() },
    });

    await this.audit.write({
      actorId: null,
      action: AUDIT_ACTIONS.NEWSLETTER_UNSUBSCRIBED,
      resourceType: 'newsletter_subscriber',
      resourceId: subscriber.id,
      changes: { method: 'POST', path: '/api/v1/newsletter/unsubscribe' },
    });

    return { message: 'Successfully unsubscribed', data: updated };
  }

  // ── Admin ──────────────────────────────────────────────────────────────

  async findAll(page: number, limit: number, filters: { search?: string; is_active?: boolean }) {
    const skip = (page - 1) * limit;

    const where: Prisma.newsletter_subscribersWhereInput = { deleted_at: null };
    if (filters.is_active !== undefined) where.is_active = filters.is_active;
    else where.is_active = true;
    if (filters.search) where.email = { contains: filters.search, mode: 'insensitive' };

    const [items, total] = await Promise.all([
      this.prisma.newsletter_subscribers.findMany({
        where,
        orderBy: [{ subscribed_at: 'desc' }, { id: 'asc' }],
        skip,
        take: limit,
      }),
      this.prisma.newsletter_subscribers.count({ where }),
    ]);

    return { message: 'Subscribers fetched', data: { items, pagination: buildPaginationMeta(page, limit, total) } };
  }

  /**
   * Admin-side unsubscribe. Bypasses the HMAC token check (which exists only
   * to prove ownership of the inbox in the public flow) and authorizes via
   * the caller's `newsletter:update` permission instead. Idempotent: a
   * second call on an already-inactive subscriber returns the existing row.
   */
  async unsubscribeAsAdmin(id: string, actorId: string) {
    const subscriber = await this.prisma.newsletter_subscribers.findFirst({
      where: { id, deleted_at: null },
    });
    if (!subscriber) throw new NotFoundException('Subscriber not found');

    if (!subscriber.is_active) {
      return { message: 'Already unsubscribed', data: subscriber };
    }

    const updated = await this.prisma.newsletter_subscribers.update({
      where: { id },
      data: { is_active: false, unsubscribed_at: new Date() },
    });

    await this.audit.write({
      actorId,
      action: AUDIT_ACTIONS.NEWSLETTER_UNSUBSCRIBED_BY_ADMIN,
      resourceType: 'newsletter_subscriber',
      resourceId: id,
      changes: { method: 'POST', path: `/api/v1/newsletter/subscribers/${id}/unsubscribe` },
    });

    return { message: 'Successfully unsubscribed', data: updated };
  }

  /**
   * Admin-side resubscribe — flips an inactive subscriber back to active
   * without going through the confirmation e-mail, for when a person asks
   * support to put them back on the list. The admin is vouching for the
   * consent, so `confirmed_at` is re-stamped: it always says when the current
   * consent was given, however it was given.
   */
  async resubscribeAsAdmin(id: string, actorId: string) {
    const subscriber = await this.prisma.newsletter_subscribers.findFirst({
      where: { id, deleted_at: null },
    });
    if (!subscriber) throw new NotFoundException('Subscriber not found');

    if (subscriber.is_active) {
      return { message: 'Already subscribed', data: subscriber };
    }

    const updated = await this.prisma.newsletter_subscribers.update({
      where: { id },
      data: { is_active: true, unsubscribed_at: null, confirmed_at: new Date() },
    });

    await this.audit.write({
      actorId,
      action: AUDIT_ACTIONS.NEWSLETTER_RESUBSCRIBED_BY_ADMIN,
      resourceType: 'newsletter_subscriber',
      resourceId: id,
      changes: { method: 'POST', path: `/api/v1/newsletter/subscribers/${id}/resubscribe` },
    });

    return { message: 'Successfully resubscribed', data: updated };
  }

  async softDelete(id: string, actorId: string) {
    const subscriber = await this.prisma.newsletter_subscribers.findFirst({ where: { id, deleted_at: null } });
    if (!subscriber) throw new NotFoundException('Subscriber not found');

    // Clear is_active too so the deleted row's flag matches its real state,
    // consistent with the unsubscribe paths (a deleted subscriber is no longer
    // active). Otherwise the row reads is_active=true, deleted_at=<date>.
    await this.prisma.newsletter_subscribers.update({
      where: { id },
      data: { deleted_at: new Date(), is_active: false },
    });

    await this.audit.write({
      actorId,
      action: AUDIT_ACTIONS.NEWSLETTER_SUBSCRIBER_DELETED,
      resourceType: 'newsletter_subscriber',
      resourceId: id,
      changes: { method: 'DELETE', path: `/api/v1/newsletter/subscribers/${id}` },
    });

    return { message: 'Subscriber deleted', data: null };
  }

  /** List soft-deleted subscribers (admin trash view). */
  async findTrash(page: number, limit: number) {
    const skip = (page - 1) * limit;
    const where: Prisma.newsletter_subscribersWhereInput = { deleted_at: { not: null } };
    const [items, total] = await Promise.all([
      this.prisma.newsletter_subscribers.findMany({
        where,
        orderBy: [{ deleted_at: 'desc' }, { id: 'asc' }],
        skip,
        take: limit,
      }),
      this.prisma.newsletter_subscribers.count({ where }),
    ]);
    return { message: 'Trash fetched', data: { items, pagination: buildPaginationMeta(page, limit, total) } };
  }

  /**
   * Restore a soft-deleted subscriber. Undoing an accidental delete is the point
   * of the trash, so someone who was subscribed when they were deleted is active
   * again — but an explicit opt-out survives the round trip (it used to be wiped,
   * putting people who had unsubscribed back on the list), and a sign-up that
   * was never confirmed stays waiting for its confirmation.
   */
  async restore(id: string, actorId: string) {
    const subscriber = await this.prisma.newsletter_subscribers.findFirst({
      where: { id, deleted_at: { not: null } },
    });
    if (!subscriber) throw new NotFoundException('Deleted subscriber not found');

    const wasSubscribed = subscriber.unsubscribed_at === null && subscriber.confirmed_at !== null;
    const updated = await this.prisma.newsletter_subscribers.update({
      where: { id },
      data: { deleted_at: null, is_active: wasSubscribed },
    });

    await this.audit.write({
      actorId,
      action: AUDIT_ACTIONS.NEWSLETTER_SUBSCRIBER_RESTORED,
      resourceType: 'newsletter_subscriber',
      resourceId: id,
      changes: {
        method: 'POST',
        path: `/api/v1/newsletter/subscribers/${id}/restore`,
        is_active: wasSubscribed,
      },
    });

    return { message: 'Subscriber restored', data: updated };
  }
}
