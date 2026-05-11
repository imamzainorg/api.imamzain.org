import { ConflictException, Injectable, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { SubscribeDto, UnsubscribeDto } from './dto/newsletter.dto';

const UNSUBSCRIBE_SECRET =
  process.env.NEWSLETTER_UNSUBSCRIBE_SECRET ?? process.env.JWT_SECRET ?? '';

@Injectable()
export class NewsletterService {
  private readonly logger = new Logger(NewsletterService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * HMAC of the subscriber id, returned to the client at subscribe time and
   * required at unsubscribe time. Replaces the previous "anyone can
   * unsubscribe anyone by guessing an email" surface.
   *
   * Exposed publicly so the campaign sender can build unsubscribe URLs
   * for each recipient at send time. The secret is server-side only —
   * the token itself is safe to embed in outbound emails.
   */
  signUnsubscribeToken(subscriberId: string): string {
    return crypto
      .createHmac('sha256', UNSUBSCRIBE_SECRET)
      .update(subscriberId)
      .digest('hex');
  }

  private verifyUnsubscribeToken(subscriberId: string, token: string): boolean {
    const expected = this.signUnsubscribeToken(subscriberId);
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(token, 'utf8');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  }

  async subscribe(dto: SubscribeDto) {
    // Look across all rows (including soft-deleted ones) so a previously
    // soft-deleted address can be re-subscribed instead of crashing into
    // the DB-level unique(email) constraint.
    const existing = await this.prisma.newsletter_subscribers.findUnique({
      where: { email: dto.email },
    });

    if (existing) {
      if (existing.is_active && existing.deleted_at === null) {
        throw new ConflictException('This email is already subscribed');
      }
      const updated = await this.prisma.newsletter_subscribers.update({
        where: { id: existing.id },
        data: { is_active: true, unsubscribed_at: null, deleted_at: null },
      });

      try {
        await this.prisma.audit_logs.create({
          data: { user_id: null, action: 'NEWSLETTER_RESUBSCRIBED', resource_type: 'newsletter_subscriber', resource_id: existing.id, changes: { method: 'POST', path: '/api/v1/newsletter/subscribe' } },
        });
      } catch (err) {
        this.logger.warn(`Failed to write NEWSLETTER_RESUBSCRIBED audit: ${err}`);
      }

      return {
        message: 'Successfully resubscribed',
        data: { ...updated, unsubscribe_token: this.signUnsubscribeToken(existing.id) },
      };
    }

    let subscriber;
    try {
      subscriber = await this.prisma.newsletter_subscribers.create({
        data: { email: dto.email, is_active: true },
      });
    } catch (err: any) {
      // Concurrent subscribe with the same email lost the race; turn the
      // P2002 unique violation into a clean 409 instead of a 500.
      if (err?.code === 'P2002') {
        throw new ConflictException('This email is already subscribed');
      }
      throw err;
    }

    try {
      await this.prisma.audit_logs.create({
        data: { user_id: null, action: 'NEWSLETTER_SUBSCRIBED', resource_type: 'newsletter_subscriber', resource_id: subscriber.id, changes: { method: 'POST', path: '/api/v1/newsletter/subscribe' } },
      });
    } catch (err) {
      this.logger.warn(`Failed to write NEWSLETTER_SUBSCRIBED audit: ${err}`);
    }

    return {
      message: 'Successfully subscribed',
      data: { ...subscriber, unsubscribe_token: this.signUnsubscribeToken(subscriber.id) },
    };
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

    try {
      await this.prisma.audit_logs.create({
        data: { user_id: null, action: 'NEWSLETTER_UNSUBSCRIBED', resource_type: 'newsletter_subscriber', resource_id: subscriber.id, changes: { method: 'POST', path: '/api/v1/newsletter/unsubscribe' } },
      });
    } catch (err) {
      this.logger.warn(`Failed to write NEWSLETTER_UNSUBSCRIBED audit: ${err}`);
    }

    return { message: 'Successfully unsubscribed', data: updated };
  }

  async findAll(page: number, limit: number, filters: { search?: string; is_active?: boolean }) {
    const skip = (page - 1) * limit;

    const where: any = { deleted_at: null };
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

    return { message: 'Subscribers fetched', data: { items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } } };
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

    try {
      await this.prisma.audit_logs.create({
        data: {
          user_id: actorId,
          action: 'NEWSLETTER_UNSUBSCRIBED_BY_ADMIN',
          resource_type: 'newsletter_subscriber',
          resource_id: id,
          changes: { method: 'POST', path: `/api/v1/newsletter/subscribers/${id}/unsubscribe` },
        },
      });
    } catch (err) {
      this.logger.warn(`Failed to write NEWSLETTER_UNSUBSCRIBED_BY_ADMIN audit: ${err}`);
    }

    return { message: 'Successfully unsubscribed', data: updated };
  }

  /**
   * Admin-side resubscribe — flips an inactive subscriber back to active
   * without going through the public subscribe endpoint, useful when a user
   * asks support to put them back on the list.
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
      data: { is_active: true, unsubscribed_at: null },
    });

    try {
      await this.prisma.audit_logs.create({
        data: {
          user_id: actorId,
          action: 'NEWSLETTER_RESUBSCRIBED_BY_ADMIN',
          resource_type: 'newsletter_subscriber',
          resource_id: id,
          changes: { method: 'POST', path: `/api/v1/newsletter/subscribers/${id}/resubscribe` },
        },
      });
    } catch (err) {
      this.logger.warn(`Failed to write NEWSLETTER_RESUBSCRIBED_BY_ADMIN audit: ${err}`);
    }

    return { message: 'Successfully resubscribed', data: updated };
  }

  async softDelete(id: string, actorId: string) {
    const subscriber = await this.prisma.newsletter_subscribers.findFirst({ where: { id, deleted_at: null } });
    if (!subscriber) throw new NotFoundException('Subscriber not found');

    await this.prisma.newsletter_subscribers.update({ where: { id }, data: { deleted_at: new Date() } });

    try {
      await this.prisma.audit_logs.create({
        data: { user_id: actorId, action: 'NEWSLETTER_SUBSCRIBER_DELETED', resource_type: 'newsletter_subscriber', resource_id: id, changes: { method: 'DELETE', path: `/api/v1/newsletter/subscribers/${id}` } },
      });
    } catch (err) {
      this.logger.warn(`Failed to write NEWSLETTER_SUBSCRIBER_DELETED audit: ${err}`);
    }

    return { message: 'Subscriber deleted', data: null };
  }
}
