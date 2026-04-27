import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { NewsletterService } from './newsletter.service';
import { PrismaService } from '../prisma/prisma.service';

const activeSubscriber = {
  id: 'sub-1',
  email: 'user@example.com',
  is_active: true,
  subscribed_at: new Date(),
  unsubscribed_at: null,
  deleted_at: null,
};

const inactiveSubscriber = { ...activeSubscriber, is_active: false };

describe('NewsletterService', () => {
  let service: NewsletterService;
  let prisma: any;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NewsletterService,
        {
          provide: PrismaService,
          useValue: {
            newsletter_subscribers: {
              findFirst: jest.fn(),
              findMany: jest.fn(),
              create: jest.fn(),
              update: jest.fn().mockResolvedValue({}),
              count: jest.fn(),
            },
            audit_logs: { create: jest.fn().mockResolvedValue({}) },
          },
        },
      ],
    }).compile();

    service = module.get<NewsletterService>(NewsletterService);
    prisma = module.get(PrismaService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('subscribe', () => {
    it('creates new subscriber when email not found', async () => {
      prisma.newsletter_subscribers.findFirst.mockResolvedValue(null);
      prisma.newsletter_subscribers.create.mockResolvedValue(activeSubscriber);

      const result = await service.subscribe({ email: 'user@example.com' });

      expect(prisma.newsletter_subscribers.create).toHaveBeenCalledWith({
        data: { email: 'user@example.com', is_active: true },
      });
      expect(result.message).toBe('Successfully subscribed');
    });

    it('reactivates an inactive subscriber', async () => {
      prisma.newsletter_subscribers.findFirst.mockResolvedValue(inactiveSubscriber);
      prisma.newsletter_subscribers.update.mockResolvedValue({ ...activeSubscriber });

      const result = await service.subscribe({ email: 'user@example.com' });

      expect(prisma.newsletter_subscribers.update).toHaveBeenCalledWith({
        where: { id: 'sub-1' },
        data: { is_active: true, unsubscribed_at: null },
      });
      expect(result.message).toBe('Successfully resubscribed');
    });

    it('throws ConflictException when already active', async () => {
      prisma.newsletter_subscribers.findFirst.mockResolvedValue(activeSubscriber);

      await expect(service.subscribe({ email: 'user@example.com' })).rejects.toThrow(ConflictException);
    });
  });

  describe('unsubscribe', () => {
    it('deactivates active subscriber', async () => {
      prisma.newsletter_subscribers.findFirst.mockResolvedValue(activeSubscriber);

      const result = await service.unsubscribe({ email: 'user@example.com' });

      expect(prisma.newsletter_subscribers.update).toHaveBeenCalledWith({
        where: { id: 'sub-1' },
        data: { is_active: false, unsubscribed_at: expect.any(Date) },
      });
      expect(result.message).toBe('Successfully unsubscribed');
    });

    it('throws NotFoundException when subscriber not found', async () => {
      prisma.newsletter_subscribers.findFirst.mockResolvedValue(null);

      await expect(service.unsubscribe({ email: 'ghost@example.com' })).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when subscriber is already inactive', async () => {
      prisma.newsletter_subscribers.findFirst.mockResolvedValue(inactiveSubscriber);

      await expect(service.unsubscribe({ email: 'user@example.com' })).rejects.toThrow(NotFoundException);
    });
  });

  describe('findAll', () => {
    it('returns paginated active subscribers', async () => {
      prisma.newsletter_subscribers.findMany.mockResolvedValue([activeSubscriber]);
      prisma.newsletter_subscribers.count.mockResolvedValue(1);

      const result = await service.findAll(1, 10);

      expect(result.data.items).toHaveLength(1);
      expect(result.data.pagination).toEqual({ page: 1, limit: 10, total: 1, pages: 1 });
    });

    it('queries only active and non-deleted subscribers', async () => {
      prisma.newsletter_subscribers.findMany.mockResolvedValue([]);
      prisma.newsletter_subscribers.count.mockResolvedValue(0);

      await service.findAll(1, 10);

      expect(prisma.newsletter_subscribers.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { is_active: true, deleted_at: null } }),
      );
    });
  });

  describe('softDelete', () => {
    it('sets deleted_at on the subscriber', async () => {
      prisma.newsletter_subscribers.findFirst.mockResolvedValue(activeSubscriber);

      const result = await service.softDelete('sub-1', 'admin-1');

      expect(prisma.newsletter_subscribers.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { deleted_at: expect.any(Date) } }),
      );
      expect(result.message).toBe('Subscriber deleted');
    });

    it('throws NotFoundException when not found', async () => {
      prisma.newsletter_subscribers.findFirst.mockResolvedValue(null);

      await expect(service.softDelete('ghost', 'admin-1')).rejects.toThrow(NotFoundException);
    });
  });
});
