import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SubscribeDto, UnsubscribeDto } from './dto/newsletter.dto';

@Injectable()
export class NewsletterService {
  constructor(private readonly prisma: PrismaService) {}

  async subscribe(dto: SubscribeDto) {
    const existing = await this.prisma.newsletter_subscribers.findFirst({
      where: { email: dto.email, deleted_at: null },
    });

    if (existing) {
      if (existing.is_active) {
        throw new ConflictException('This email is already subscribed');
      }
      const updated = await this.prisma.newsletter_subscribers.update({
        where: { id: existing.id },
        data: { is_active: true, unsubscribed_at: null },
      });

      try {
        await this.prisma.audit_logs.create({
          data: { user_id: null, action: 'NEWSLETTER_RESUBSCRIBED', resource_type: 'newsletter_subscriber', resource_id: existing.id, changes: { method: 'POST', path: '/api/v1/newsletter/subscribe' } },
        });
      } catch {}

      return { message: 'Successfully resubscribed', data: updated };
    }

    const subscriber = await this.prisma.newsletter_subscribers.create({
      data: { email: dto.email, is_active: true },
    });

    try {
      await this.prisma.audit_logs.create({
        data: { user_id: null, action: 'NEWSLETTER_SUBSCRIBED', resource_type: 'newsletter_subscriber', resource_id: subscriber.id, changes: { method: 'POST', path: '/api/v1/newsletter/subscribe' } },
      });
    } catch {}

    return { message: 'Successfully subscribed', data: subscriber };
  }

  async unsubscribe(dto: UnsubscribeDto) {
    const subscriber = await this.prisma.newsletter_subscribers.findFirst({
      where: { email: dto.email, deleted_at: null },
    });

    if (!subscriber || !subscriber.is_active) {
      throw new NotFoundException('Subscriber not found');
    }

    const updated = await this.prisma.newsletter_subscribers.update({
      where: { id: subscriber.id },
      data: { is_active: false, unsubscribed_at: new Date() },
    });

    try {
      await this.prisma.audit_logs.create({
        data: { user_id: null, action: 'NEWSLETTER_UNSUBSCRIBED', resource_type: 'newsletter_subscriber', resource_id: subscriber.id, changes: { method: 'POST', path: '/api/v1/newsletter/unsubscribe' } },
      });
    } catch {}

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
        orderBy: { subscribed_at: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.newsletter_subscribers.count({ where }),
    ]);

    return { message: 'Subscribers fetched', data: { items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } } };
  }

  async softDelete(id: string, actorId: string) {
    const subscriber = await this.prisma.newsletter_subscribers.findFirst({ where: { id, deleted_at: null } });
    if (!subscriber) throw new NotFoundException('Subscriber not found');

    await this.prisma.newsletter_subscribers.update({ where: { id }, data: { deleted_at: new Date() } });

    try {
      await this.prisma.audit_logs.create({
        data: { user_id: actorId, action: 'NEWSLETTER_SUBSCRIBER_DELETED', resource_type: 'newsletter_subscriber', resource_id: id, changes: { method: 'DELETE', path: `/api/v1/newsletter/subscribers/${id}` } },
      });
    } catch {}

    return { message: 'Subscriber deleted', data: null };
  }
}
