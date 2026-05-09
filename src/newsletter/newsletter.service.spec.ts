import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import * as crypto from 'crypto';
import { NewsletterService } from './newsletter.service';
import { PrismaService } from '../prisma/prisma.service';

const SUB_ID = 'sub-1';

const activeSubscriber = {
  id: SUB_ID,
  email: 'user@example.com',
  is_active: true,
  subscribed_at: new Date(),
  unsubscribed_at: null,
  deleted_at: null,
};

const inactiveSubscriber = { ...activeSubscriber, is_active: false };

function tokenFor(id: string) {
  const secret = process.env.NEWSLETTER_UNSUBSCRIBE_SECRET ?? process.env.JWT_SECRET ?? '';
  return crypto.createHmac('sha256', secret).update(id).digest('hex');
}

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
              findUnique: jest.fn(),
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
    it('creates new subscriber and returns an unsubscribe token when email not found', async () => {
      prisma.newsletter_subscribers.findUnique.mockResolvedValue(null);
      prisma.newsletter_subscribers.create.mockResolvedValue(activeSubscriber);

      const result = await service.subscribe({ email: 'user@example.com' });

      expect(prisma.newsletter_subscribers.create).toHaveBeenCalledWith({
        data: { email: 'user@example.com', is_active: true },
      });
      expect(result.message).toBe('Successfully subscribed');
      expect(result.data.unsubscribe_token).toBe(tokenFor(SUB_ID));
    });

    it('reactivates an inactive subscriber and returns a token', async () => {
      prisma.newsletter_subscribers.findUnique.mockResolvedValue(inactiveSubscriber);
      prisma.newsletter_subscribers.update.mockResolvedValue({ ...activeSubscriber });

      const result = await service.subscribe({ email: 'user@example.com' });

      expect(prisma.newsletter_subscribers.update).toHaveBeenCalledWith({
        where: { id: SUB_ID },
        data: { is_active: true, unsubscribed_at: null, deleted_at: null },
      });
      expect(result.message).toBe('Successfully resubscribed');
      expect(result.data.unsubscribe_token).toBe(tokenFor(SUB_ID));
    });

    it('throws ConflictException when already active', async () => {
      prisma.newsletter_subscribers.findUnique.mockResolvedValue(activeSubscriber);

      await expect(service.subscribe({ email: 'user@example.com' })).rejects.toThrow(ConflictException);
    });

    it('maps a P2002 race into ConflictException', async () => {
      prisma.newsletter_subscribers.findUnique.mockResolvedValue(null);
      const p2002 = Object.assign(new Error('Unique violation'), { code: 'P2002' });
      prisma.newsletter_subscribers.create.mockRejectedValue(p2002);

      await expect(service.subscribe({ email: 'user@example.com' })).rejects.toThrow(ConflictException);
    });
  });

  describe('unsubscribe', () => {
    it('deactivates the active subscriber when the token is valid', async () => {
      prisma.newsletter_subscribers.findUnique.mockResolvedValue(activeSubscriber);

      const result = await service.unsubscribe({
        email: 'user@example.com',
        token: tokenFor(SUB_ID),
      });

      expect(prisma.newsletter_subscribers.update).toHaveBeenCalledWith({
        where: { id: SUB_ID },
        data: { is_active: false, unsubscribed_at: expect.any(Date) },
      });
      expect(result.message).toBe('Successfully unsubscribed');
    });

    it('is idempotent on already-inactive subscribers', async () => {
      prisma.newsletter_subscribers.findUnique.mockResolvedValue(inactiveSubscriber);

      const result = await service.unsubscribe({
        email: 'user@example.com',
        token: tokenFor(SUB_ID),
      });

      expect(result.message).toBe('Already unsubscribed');
      expect(prisma.newsletter_subscribers.update).not.toHaveBeenCalled();
    });

    it('rejects when subscriber does not exist', async () => {
      prisma.newsletter_subscribers.findUnique.mockResolvedValue(null);

      await expect(
        service.unsubscribe({ email: 'ghost@example.com', token: 'whatever' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects when token does not match', async () => {
      prisma.newsletter_subscribers.findUnique.mockResolvedValue(activeSubscriber);

      await expect(
        service.unsubscribe({ email: 'user@example.com', token: 'wrong-token' }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('findAll', () => {
    it('returns paginated active subscribers', async () => {
      prisma.newsletter_subscribers.findMany.mockResolvedValue([activeSubscriber]);
      prisma.newsletter_subscribers.count.mockResolvedValue(1);

      const result = await service.findAll(1, 10, {});

      expect(result.data.items).toHaveLength(1);
      expect(result.data.pagination).toEqual({ page: 1, limit: 10, total: 1, pages: 1 });
    });

    it('queries only active and non-deleted subscribers', async () => {
      prisma.newsletter_subscribers.findMany.mockResolvedValue([]);
      prisma.newsletter_subscribers.count.mockResolvedValue(0);

      await service.findAll(1, 10, {});

      expect(prisma.newsletter_subscribers.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { is_active: true, deleted_at: null } }),
      );
    });
  });

  describe('softDelete', () => {
    it('sets deleted_at on the subscriber', async () => {
      prisma.newsletter_subscribers.findFirst.mockResolvedValue(activeSubscriber);

      const result = await service.softDelete(SUB_ID, 'admin-1');

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
