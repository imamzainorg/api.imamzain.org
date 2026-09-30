// NewsletterService now refuses to boot without a signing secret, so we
// install a deterministic test value before importing it.
process.env.NEWSLETTER_UNSUBSCRIBE_SECRET = process.env.NEWSLETTER_UNSUBSCRIBE_SECRET ?? 'test-newsletter-secret';

import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import * as crypto from 'crypto';
import { NewsletterService } from './newsletter.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import { EmailService } from '../email/email.service';
import { AUDIT_ACTIONS } from '../common/audit/audit.actions';
import { deriveKey, KEY_INFO } from '../common/utils/derive-key.util';
import { CONFIRM_RESEND_COOLDOWN_MS, CONFIRM_TTL_MS } from './confirmation.util';

const SUB_ID = 'sub-1';
const EMAIL = 'user@example.com';
const SUBSCRIBED_AT = new Date('2026-01-01T10:00:00.000Z');

const activeSubscriber = {
  id: SUB_ID,
  email: EMAIL,
  is_active: true,
  subscribed_at: SUBSCRIBED_AT,
  unsubscribed_at: null,
  deleted_at: null,
  confirmed_at: SUBSCRIBED_AT,
  confirmation_sent_at: null,
};

const inactiveSubscriber = { ...activeSubscriber, is_active: false, unsubscribed_at: new Date('2026-02-01T00:00:00.000Z') };

/** Signed up, never clicked. */
const pendingSubscriber = { ...activeSubscriber, is_active: false, confirmed_at: null };

const deletedSubscriber = { ...activeSubscriber, is_active: false, deleted_at: new Date('2026-03-01T00:00:00.000Z') };

function secret() {
  return process.env.NEWSLETTER_UNSUBSCRIBE_SECRET!;
}

function tokenFor(id: string) {
  return crypto.createHmac('sha256', secret()).update(id).digest('hex');
}

function confirmTokenFor(id: string, issuedAt: Date) {
  return crypto.createHmac('sha256', secret()).update(`confirm:${id}:${issuedAt.getTime()}`).digest('hex');
}

describe('NewsletterService', () => {
  let service: NewsletterService;
  let prisma: any;
  let audit: any;
  let email: any;

  beforeEach(async () => {
    delete process.env.NEWSLETTER_CONFIRM_MAX_PER_HOUR;
    delete process.env.NEWSLETTER_CONFIRM_URL_BASE;

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
              updateMany: jest.fn().mockResolvedValue({ count: 1 }),
              count: jest.fn().mockResolvedValue(0),
            },
          },
        },
        { provide: AuditService, useValue: { write: jest.fn().mockResolvedValue(true) } },
        {
          provide: EmailService,
          useValue: {
            isConfigured: jest.fn().mockReturnValue(true),
            deliver: jest.fn().mockResolvedValue({ ok: true, messageId: 'm-1' }),
          },
        },
      ],
    }).compile();

    service = module.get<NewsletterService>(NewsletterService);
    prisma = module.get(PrismaService);
    audit = module.get(AuditService);
    email = module.get(EmailService);
  });

  afterEach(() => jest.clearAllMocks());

  /** Wait for the confirmation mail that is sent after subscribe() has answered. */
  const settle = () => service.onModuleDestroy();

  describe('signing secret', () => {
    const original = { own: process.env.NEWSLETTER_UNSUBSCRIBE_SECRET, jwt: process.env.JWT_SECRET };
    afterEach(() => {
      process.env.NEWSLETTER_UNSUBSCRIBE_SECRET = original.own;
      if (original.jwt === undefined) delete process.env.JWT_SECRET;
      else process.env.JWT_SECRET = original.jwt;
    });

    const JWT = 'jwt-secret-for-fallback-0123456789';
    const build = () => new NewsletterService({} as never, {} as never, {} as never);
    const hmac = (key: string | Buffer, message: string) =>
      crypto.createHmac('sha256', key).update(message).digest('hex');

    it('signs with an HKDF-derived key of JWT_SECRET when the dedicated secret is BLANK, as .env.example ships it', () => {
      process.env.NEWSLETTER_UNSUBSCRIBE_SECRET = '';
      process.env.JWT_SECRET = JWT;

      const token = build().signUnsubscribeToken(SUB_ID);

      expect(token).toBe(hmac(deriveKey(JWT, KEY_INFO.newsletterUnsubscribe), SUB_ID));
      expect(token).not.toBe(hmac(JWT, SUB_ID));
    });

    it('prefers the dedicated secret when set — used as-is, exactly as before', () => {
      process.env.NEWSLETTER_UNSUBSCRIBE_SECRET = 'dedicated-secret';
      process.env.JWT_SECRET = JWT;

      expect(build().signUnsubscribeToken(SUB_ID)).toBe(hmac('dedicated-secret', SUB_ID));
    });

    it('refuses to construct with no secret at all rather than sign with an empty key', () => {
      process.env.NEWSLETTER_UNSUBSCRIBE_SECRET = '';
      delete process.env.JWT_SECRET;

      expect(build).toThrow(/required/);
    });

    describe('verification when only JWT_SECRET is set', () => {
      const issuedAt = new Date(Date.now() - 60 * 60_000);

      const serviceFor = (subscriber: unknown) => {
        process.env.NEWSLETTER_UNSUBSCRIBE_SECRET = '';
        process.env.JWT_SECRET = JWT;
        const store = {
          findUnique: jest.fn().mockResolvedValue(subscriber),
          update: jest.fn().mockResolvedValue({}),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        };
        const svc = new NewsletterService(
          { newsletter_subscribers: store } as never,
          { write: jest.fn().mockResolvedValue(true) } as never,
          {} as never,
        );
        return { svc, store };
      };

      it('accepts the unsubscribe token it minted', async () => {
        const { svc } = serviceFor(activeSubscriber);

        const result = await svc.unsubscribe({ email: EMAIL, token: svc.signUnsubscribeToken(SUB_ID) });

        expect(result.message).toBe('Successfully unsubscribed');
      });

      it('still accepts an unsubscribe link minted with the raw JWT_SECRET before the change', async () => {
        const { svc, store } = serviceFor(activeSubscriber);

        const result = await svc.unsubscribe({ email: EMAIL, token: hmac(JWT, SUB_ID) });

        expect(result.message).toBe('Successfully unsubscribed');
        expect(store.update).toHaveBeenCalled();
      });

      it('still accepts a confirmation link minted with the raw JWT_SECRET before the change', async () => {
        const { svc } = serviceFor({ ...pendingSubscriber, confirmation_sent_at: issuedAt });

        const result = await svc.confirm({
          email: EMAIL,
          token: hmac(JWT, `confirm:${SUB_ID}:${issuedAt.getTime()}`),
        });

        expect(result.message).toBe('Subscription confirmed');
      });

      it('rejects a tampered unsubscribe token', async () => {
        const { svc } = serviceFor(activeSubscriber);
        const good = svc.signUnsubscribeToken(SUB_ID);

        await expect(
          svc.unsubscribe({ email: EMAIL, token: `${good.slice(0, -1)}${good.endsWith('0') ? '1' : '0'}` }),
        ).rejects.toThrow(UnauthorizedException);
      });

      it('does not accept an unsubscribe token as a confirmation token, or the reverse', async () => {
        const { svc } = serviceFor({ ...pendingSubscriber, confirmation_sent_at: issuedAt });
        const unsubscribeToken = svc.signUnsubscribeToken(SUB_ID);

        await expect(svc.confirm({ email: EMAIL, token: unsubscribeToken })).rejects.toThrow(UnauthorizedException);

        const confirmToken = hmac(deriveKey(JWT, KEY_INFO.newsletterConfirm), `confirm:${SUB_ID}:${issuedAt.getTime()}`);
        const active = serviceFor(activeSubscriber);
        await expect(active.svc.unsubscribe({ email: EMAIL, token: confirmToken })).rejects.toThrow(
          UnauthorizedException,
        );
      });

      it('does not accept a token derived for the contest', async () => {
        const { svc } = serviceFor(activeSubscriber);
        const contestToken = hmac(deriveKey(JWT, KEY_INFO.contestAttempt), SUB_ID);

        await expect(svc.unsubscribe({ email: EMAIL, token: contestToken })).rejects.toThrow(UnauthorizedException);
      });
    });

    describe('verification with a dedicated secret', () => {
      it('does not fall back to JWT_SECRET-based tokens', async () => {
        process.env.NEWSLETTER_UNSUBSCRIBE_SECRET = 'dedicated-secret';
        process.env.JWT_SECRET = JWT;
        const svc = new NewsletterService(
          { newsletter_subscribers: { findUnique: jest.fn().mockResolvedValue(activeSubscriber) } } as never,
          {} as never,
          {} as never,
        );

        await expect(svc.unsubscribe({ email: EMAIL, token: hmac(JWT, SUB_ID) })).rejects.toThrow(
          UnauthorizedException,
        );
        await expect(
          svc.unsubscribe({ email: EMAIL, token: hmac(deriveKey(JWT, KEY_INFO.newsletterUnsubscribe), SUB_ID) }),
        ).rejects.toThrow(UnauthorizedException);
      });
    });
  });

  // ── subscribe (double opt-in) ─────────────────────────────────────────

  describe('subscribe', () => {
    const created = { ...pendingSubscriber, confirmation_sent_at: null };

    it('creates a PENDING row — inactive until the link is clicked — and audits the request', async () => {
      prisma.newsletter_subscribers.findUnique.mockResolvedValue(null);
      prisma.newsletter_subscribers.create.mockResolvedValue(created);

      await service.subscribe({ email: EMAIL });

      expect(prisma.newsletter_subscribers.create).toHaveBeenCalledWith({ data: { email: EMAIL, is_active: false } });
      expect(audit.write).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: null,
          action: AUDIT_ACTIONS.NEWSLETTER_SUBSCRIBE_REQUESTED,
          resourceId: SUB_ID,
        }),
      );
      await settle();
    });

    it('sends one confirmation mail on the transactional lane with a link bound to that send', async () => {
      prisma.newsletter_subscribers.findUnique.mockResolvedValue(null);
      prisma.newsletter_subscribers.create.mockResolvedValue(created);

      await service.subscribe({ email: EMAIL });
      await settle();

      expect(email.deliver).toHaveBeenCalledTimes(1);
      const message = email.deliver.mock.calls[0][0];
      expect(message.lane).toBe('transactional');
      expect(message.to).toBe(EMAIL);

      // The token in the link is the HMAC of THIS claim's timestamp.
      const claimedAt: Date = prisma.newsletter_subscribers.updateMany.mock.calls[0][0].data.confirmation_sent_at;
      const link = new URL(/https:\/\/\S+/.exec(message.text)![0]);
      expect(link.searchParams.get('email')).toBe(EMAIL);
      expect(link.searchParams.get('token')).toBe(confirmTokenFor(SUB_ID, claimedAt));
    });

    it('answers the same for every state of the address, with no row and no token in the reply', async () => {
      const replies: string[] = [];
      for (const existing of [null, pendingSubscriber, activeSubscriber, inactiveSubscriber, deletedSubscriber]) {
        prisma.newsletter_subscribers.findUnique.mockResolvedValue(existing);
        prisma.newsletter_subscribers.create.mockResolvedValue(created);
        replies.push(JSON.stringify(await service.subscribe({ email: EMAIL })));
      }
      await settle();

      expect(new Set(replies).size).toBe(1);
      const reply = JSON.parse(replies[0]);
      expect(reply).toEqual({ message: 'Please check your inbox to confirm your subscription', data: null });
    });

    it('does nothing at all for an address that is already subscribed', async () => {
      prisma.newsletter_subscribers.findUnique.mockResolvedValue(activeSubscriber);

      await service.subscribe({ email: EMAIL });
      await settle();

      expect(prisma.newsletter_subscribers.create).not.toHaveBeenCalled();
      expect(prisma.newsletter_subscribers.update).not.toHaveBeenCalled();
      expect(prisma.newsletter_subscribers.updateMany).not.toHaveBeenCalled();
      expect(email.deliver).not.toHaveBeenCalled();
    });

    it('does NOT undo an opt-out: an unsubscribed row is left alone until the link is clicked', async () => {
      prisma.newsletter_subscribers.findUnique.mockResolvedValue(inactiveSubscriber);

      await service.subscribe({ email: EMAIL });
      await settle();

      expect(prisma.newsletter_subscribers.create).not.toHaveBeenCalled();
      expect(prisma.newsletter_subscribers.update).not.toHaveBeenCalled();
      // The only write is the confirmation claim, which touches confirmation_sent_at alone.
      expect(prisma.newsletter_subscribers.updateMany).toHaveBeenCalledTimes(1);
      expect(Object.keys(prisma.newsletter_subscribers.updateMany.mock.calls[0][0].data)).toEqual([
        'confirmation_sent_at',
      ]);
      expect(email.deliver).toHaveBeenCalledTimes(1);
    });

    it('does not restore a deleted row either — only the click does', async () => {
      prisma.newsletter_subscribers.findUnique.mockResolvedValue(deletedSubscriber);

      await service.subscribe({ email: EMAIL });
      await settle();

      expect(prisma.newsletter_subscribers.update).not.toHaveBeenCalled();
      expect(email.deliver).toHaveBeenCalledTimes(1);
    });

    it('claims the mail with a per-address cool-down, so a second request inside it sends nothing', async () => {
      prisma.newsletter_subscribers.findUnique.mockResolvedValue(pendingSubscriber);
      prisma.newsletter_subscribers.updateMany.mockResolvedValue({ count: 0 }); // inside the window

      await service.subscribe({ email: EMAIL });
      await settle();

      const claim = prisma.newsletter_subscribers.updateMany.mock.calls[0][0];
      expect(claim.where.id).toBe(SUB_ID);
      expect(claim.where.OR).toEqual([
        { confirmation_sent_at: null },
        { confirmation_sent_at: { lt: expect.any(Date) } },
      ]);
      const cutoff: Date = claim.where.OR[1].confirmation_sent_at.lt;
      expect(Date.now() - cutoff.getTime()).toBeGreaterThanOrEqual(CONFIRM_RESEND_COOLDOWN_MS - 1_000);
      expect(email.deliver).not.toHaveBeenCalled();
    });

    it('sends nothing once the global hourly cap is reached, but still answers 200', async () => {
      prisma.newsletter_subscribers.findUnique.mockResolvedValue(pendingSubscriber);
      prisma.newsletter_subscribers.count.mockResolvedValue(30);

      await expect(service.subscribe({ email: EMAIL })).resolves.toEqual(
        expect.objectContaining({ data: null }),
      );
      await settle();

      expect(prisma.newsletter_subscribers.updateMany).not.toHaveBeenCalled();
      expect(email.deliver).not.toHaveBeenCalled();
    });

    it('takes the hourly cap from NEWSLETTER_CONFIRM_MAX_PER_HOUR', async () => {
      process.env.NEWSLETTER_CONFIRM_MAX_PER_HOUR = '3';
      prisma.newsletter_subscribers.findUnique.mockResolvedValue(pendingSubscriber);
      prisma.newsletter_subscribers.count.mockResolvedValue(3);

      await service.subscribe({ email: EMAIL });
      await settle();

      expect(email.deliver).not.toHaveBeenCalled();
    });

    it('sends nothing (and spends no cool-down) when SMTP is not configured', async () => {
      prisma.newsletter_subscribers.findUnique.mockResolvedValue(pendingSubscriber);
      email.isConfigured.mockReturnValue(false);

      await service.subscribe({ email: EMAIL });
      await settle();

      expect(prisma.newsletter_subscribers.updateMany).not.toHaveBeenCalled();
      expect(email.deliver).not.toHaveBeenCalled();
    });

    it('answers before the mail is sent, so response time does not reveal the state of the address', async () => {
      prisma.newsletter_subscribers.findUnique.mockResolvedValue(pendingSubscriber);
      let finishSend!: () => void;
      email.deliver.mockImplementation(
        () =>
          new Promise((resolve) => {
            finishSend = () => resolve({ ok: true, messageId: 'late' });
          }),
      );

      // Resolves although the SMTP call has not completed.
      await expect(service.subscribe({ email: EMAIL })).resolves.toEqual(expect.objectContaining({ data: null }));
      expect(email.deliver).toHaveBeenCalledTimes(1);

      finishSend();
      await settle();
    });

    it('gives the claim back when the mail could not be sent, so the visitor can try again at once', async () => {
      prisma.newsletter_subscribers.findUnique.mockResolvedValue({
        ...pendingSubscriber,
        confirmation_sent_at: new Date('2026-01-01T00:00:00.000Z'),
      });
      email.deliver.mockResolvedValue({ ok: false, kind: 'transient', systemic: true, error: 'timeout' });

      await service.subscribe({ email: EMAIL });
      await settle();

      const [claim, release] = prisma.newsletter_subscribers.updateMany.mock.calls.map(([a]: any[]) => a);
      expect(release).toEqual({
        where: { id: SUB_ID, confirmation_sent_at: claim.data.confirmation_sent_at },
        data: { confirmation_sent_at: new Date('2026-01-01T00:00:00.000Z') },
      });
    });

    it('carries on with the existing row when a concurrent request created it first', async () => {
      const { Prisma } = await import('@prisma/client');
      prisma.newsletter_subscribers.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(pendingSubscriber);
      prisma.newsletter_subscribers.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique violation', { code: 'P2002', clientVersion: '0.0.0-test' }),
      );

      await expect(service.subscribe({ email: EMAIL })).resolves.toEqual(expect.objectContaining({ data: null }));
      await settle();

      expect(audit.write).not.toHaveBeenCalled(); // the other request audits its own create
      expect(email.deliver).toHaveBeenCalledTimes(1);
    });

    it('lets an unexpected database error through as a failure', async () => {
      prisma.newsletter_subscribers.findUnique.mockResolvedValue(null);
      prisma.newsletter_subscribers.create.mockRejectedValue(new Error('connection lost'));

      await expect(service.subscribe({ email: EMAIL })).rejects.toThrow('connection lost');
    });
  });

  // ── confirm ───────────────────────────────────────────────────────────

  describe('confirm', () => {
    const issuedAt = new Date(Date.now() - 60 * 60_000); // an hour ago
    const pendingWithLink = { ...pendingSubscriber, confirmation_sent_at: issuedAt };
    const goodToken = confirmTokenFor(SUB_ID, issuedAt);

    it('activates a pending subscriber, stamps confirmed_at, and audits the first consent', async () => {
      prisma.newsletter_subscribers.findUnique.mockResolvedValue(pendingWithLink);

      const result = await service.confirm({ email: EMAIL, token: goodToken });

      expect(result).toEqual({ message: 'Subscription confirmed', data: null });
      expect(prisma.newsletter_subscribers.updateMany).toHaveBeenCalledWith({
        // Still inactive and still THIS link.
        where: { id: SUB_ID, is_active: false, confirmation_sent_at: issuedAt },
        data: { is_active: true, confirmed_at: expect.any(Date), unsubscribed_at: null, deleted_at: null },
      });
      expect(audit.write).toHaveBeenCalledWith(
        expect.objectContaining({ actorId: null, action: AUDIT_ACTIONS.NEWSLETTER_SUBSCRIBED, resourceId: SUB_ID }),
      );
    });

    it('brings back someone who had unsubscribed — the click is fresh consent — and audits a re-subscribe', async () => {
      prisma.newsletter_subscribers.findUnique.mockResolvedValue({
        ...inactiveSubscriber, // opted out in February
        confirmation_sent_at: issuedAt, // link sent afterwards
      });

      await service.confirm({ email: EMAIL, token: goodToken });

      expect(prisma.newsletter_subscribers.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ is_active: true, unsubscribed_at: null }) }),
      );
      expect(audit.write).toHaveBeenCalledWith(
        expect.objectContaining({ action: AUDIT_ACTIONS.NEWSLETTER_RESUBSCRIBED }),
      );
    });

    it('brings back a deleted row too', async () => {
      prisma.newsletter_subscribers.findUnique.mockResolvedValue({ ...deletedSubscriber, confirmation_sent_at: issuedAt });

      await service.confirm({ email: EMAIL, token: goodToken });

      expect(prisma.newsletter_subscribers.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ is_active: true, deleted_at: null }) }),
      );
    });

    it('is idempotent: a second click on an already-active subscriber changes nothing', async () => {
      prisma.newsletter_subscribers.findUnique.mockResolvedValue({ ...activeSubscriber, confirmation_sent_at: issuedAt });

      const result = await service.confirm({ email: EMAIL, token: goodToken });

      expect(result.message).toBe('Subscription already confirmed');
      expect(prisma.newsletter_subscribers.updateMany).not.toHaveBeenCalled();
      expect(audit.write).not.toHaveBeenCalled();
    });

    it('treats a lost race with another click as success, not an error', async () => {
      prisma.newsletter_subscribers.findUnique
        .mockResolvedValueOnce(pendingWithLink)
        .mockResolvedValueOnce({ ...activeSubscriber, confirmation_sent_at: issuedAt });
      prisma.newsletter_subscribers.updateMany.mockResolvedValue({ count: 0 });

      const result = await service.confirm({ email: EMAIL, token: goodToken });

      expect(result.message).toBe('Subscription already confirmed');
      expect(audit.write).not.toHaveBeenCalled();
    });

    it('rejects when the row changed under it and is still not subscribed', async () => {
      prisma.newsletter_subscribers.findUnique
        .mockResolvedValueOnce(pendingWithLink)
        .mockResolvedValueOnce({ ...pendingWithLink, deleted_at: new Date() });
      prisma.newsletter_subscribers.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.confirm({ email: EMAIL, token: goodToken })).rejects.toThrow(UnauthorizedException);
    });

    describe('every bad link is the same 401', () => {
      const messages = async (inputs: Array<[string, unknown]>) => {
        const out: string[] = [];
        for (const [token, row] of inputs) {
          prisma.newsletter_subscribers.findUnique.mockResolvedValue(row);
          const err = await service.confirm({ email: EMAIL, token }).catch((e) => e);
          expect(err).toBeInstanceOf(UnauthorizedException);
          out.push(err.message);
        }
        return out;
      };

      it('unknown address, no mail ever sent, wrong token, superseded token, unsubscribe token', async () => {
        const out = await messages([
          [goodToken, null], // unknown address
          [goodToken, { ...pendingSubscriber, confirmation_sent_at: null }], // never sent
          ['0'.repeat(64), pendingWithLink], // wrong token
          [goodToken, { ...pendingSubscriber, confirmation_sent_at: new Date(issuedAt.getTime() + 60_000) }], // newer link sent since
          [tokenFor(SUB_ID), pendingWithLink], // an unsubscribe token replayed as a confirm token
          ['short', pendingWithLink], // wrong length
        ]);

        expect(new Set(out).size).toBe(1);
        expect(prisma.newsletter_subscribers.updateMany).not.toHaveBeenCalled();
      });

      it('expired (older than 72 hours)', async () => {
        const old = new Date(Date.now() - CONFIRM_TTL_MS - 60_000);

        await messages([[confirmTokenFor(SUB_ID, old), { ...pendingSubscriber, confirmation_sent_at: old }]]);

        expect(prisma.newsletter_subscribers.updateMany).not.toHaveBeenCalled();
      });

      it('the person unsubscribed AFTER the link was sent, so an old e-mail cannot undo it', async () => {
        await messages([
          [goodToken, { ...inactiveSubscriber, unsubscribed_at: new Date(issuedAt.getTime() + 60_000), confirmation_sent_at: issuedAt }],
          [goodToken, { ...deletedSubscriber, deleted_at: new Date(issuedAt.getTime() + 60_000), confirmation_sent_at: issuedAt }],
        ]);

        expect(prisma.newsletter_subscribers.updateMany).not.toHaveBeenCalled();
      });
    });
  });

  // ── unsubscribe ───────────────────────────────────────────────────────

  describe('unsubscribe', () => {
    it('deactivates the active subscriber when the token is valid', async () => {
      prisma.newsletter_subscribers.findUnique.mockResolvedValue(activeSubscriber);

      const result = await service.unsubscribe({ email: EMAIL, token: tokenFor(SUB_ID) });

      expect(prisma.newsletter_subscribers.update).toHaveBeenCalledWith({
        where: { id: SUB_ID },
        data: { is_active: false, unsubscribed_at: expect.any(Date) },
      });
      expect(result.message).toBe('Successfully unsubscribed');
    });

    it('is idempotent on already-inactive subscribers', async () => {
      prisma.newsletter_subscribers.findUnique.mockResolvedValue(inactiveSubscriber);

      const result = await service.unsubscribe({ email: EMAIL, token: tokenFor(SUB_ID) });

      expect(result.message).toBe('Already unsubscribed');
      expect(prisma.newsletter_subscribers.update).not.toHaveBeenCalled();
    });

    it('rejects when subscriber does not exist', async () => {
      prisma.newsletter_subscribers.findUnique.mockResolvedValue(null);

      await expect(service.unsubscribe({ email: 'ghost@example.com', token: 'whatever' })).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rejects when token does not match', async () => {
      prisma.newsletter_subscribers.findUnique.mockResolvedValue(activeSubscriber);

      await expect(service.unsubscribe({ email: EMAIL, token: 'wrong-token' })).rejects.toThrow(UnauthorizedException);
    });

    it('does not accept a confirmation token as an unsubscribe token', async () => {
      prisma.newsletter_subscribers.findUnique.mockResolvedValue(activeSubscriber);

      await expect(
        service.unsubscribe({ email: EMAIL, token: confirmTokenFor(SUB_ID, new Date()) }),
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

  describe('unsubscribeAsAdmin', () => {
    it('marks an active subscriber inactive without a token', async () => {
      prisma.newsletter_subscribers.findFirst.mockResolvedValue(activeSubscriber);
      prisma.newsletter_subscribers.update.mockResolvedValue({ ...activeSubscriber, is_active: false });

      const result = await service.unsubscribeAsAdmin(SUB_ID, 'admin-1');

      expect(prisma.newsletter_subscribers.update).toHaveBeenCalledWith({
        where: { id: SUB_ID },
        data: { is_active: false, unsubscribed_at: expect.any(Date) },
      });
      expect(result.message).toBe('Successfully unsubscribed');
    });

    it('is idempotent on already-inactive subscribers', async () => {
      prisma.newsletter_subscribers.findFirst.mockResolvedValue(inactiveSubscriber);

      const result = await service.unsubscribeAsAdmin(SUB_ID, 'admin-1');

      expect(result.message).toBe('Already unsubscribed');
      expect(prisma.newsletter_subscribers.update).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when subscriber not found', async () => {
      prisma.newsletter_subscribers.findFirst.mockResolvedValue(null);

      await expect(service.unsubscribeAsAdmin('ghost', 'admin-1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('resubscribeAsAdmin', () => {
    it('flips an inactive subscriber back to active and re-stamps the consent time', async () => {
      prisma.newsletter_subscribers.findFirst.mockResolvedValue(inactiveSubscriber);
      prisma.newsletter_subscribers.update.mockResolvedValue({ ...activeSubscriber });

      const result = await service.resubscribeAsAdmin(SUB_ID, 'admin-1');

      expect(prisma.newsletter_subscribers.update).toHaveBeenCalledWith({
        where: { id: SUB_ID },
        data: { is_active: true, unsubscribed_at: null, confirmed_at: expect.any(Date) },
      });
      expect(result.message).toBe('Successfully resubscribed');
    });

    it('is idempotent on already-active subscribers', async () => {
      prisma.newsletter_subscribers.findFirst.mockResolvedValue(activeSubscriber);

      const result = await service.resubscribeAsAdmin(SUB_ID, 'admin-1');

      expect(result.message).toBe('Already subscribed');
      expect(prisma.newsletter_subscribers.update).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when subscriber not found', async () => {
      prisma.newsletter_subscribers.findFirst.mockResolvedValue(null);

      await expect(service.resubscribeAsAdmin('ghost', 'admin-1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('softDelete', () => {
    it('sets deleted_at and clears is_active on the subscriber', async () => {
      prisma.newsletter_subscribers.findFirst.mockResolvedValue(activeSubscriber);

      const result = await service.softDelete(SUB_ID, 'admin-1');

      expect(prisma.newsletter_subscribers.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { deleted_at: expect.any(Date), is_active: false } }),
      );
      expect(result.message).toBe('Subscriber deleted');
    });

    it('throws NotFoundException when not found', async () => {
      prisma.newsletter_subscribers.findFirst.mockResolvedValue(null);

      await expect(service.softDelete('ghost', 'admin-1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('restore', () => {
    const restoreAndGetData = async (row: unknown) => {
      prisma.newsletter_subscribers.findFirst.mockResolvedValue(row);
      await service.restore(SUB_ID, 'admin-1');
      return prisma.newsletter_subscribers.update.mock.calls[0][0].data;
    };

    it('reactivates someone who was subscribed when they were deleted (undoing a mistake)', async () => {
      expect(await restoreAndGetData(deletedSubscriber)).toEqual({ deleted_at: null, is_active: true });
    });

    it('keeps an explicit opt-out: an unsubscribed row comes back inactive and unsubscribed_at is not wiped', async () => {
      const data = await restoreAndGetData({ ...deletedSubscriber, unsubscribed_at: new Date('2026-02-01T00:00:00.000Z') });

      expect(data).toEqual({ deleted_at: null, is_active: false });
      expect(data).not.toHaveProperty('unsubscribed_at');
    });

    it('leaves a sign-up that never confirmed waiting for its confirmation', async () => {
      expect(await restoreAndGetData({ ...deletedSubscriber, confirmed_at: null })).toEqual({
        deleted_at: null,
        is_active: false,
      });
    });

    it('records in the audit trail whether the subscriber is active again', async () => {
      await restoreAndGetData({ ...deletedSubscriber, unsubscribed_at: new Date() });

      expect(audit.write).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AUDIT_ACTIONS.NEWSLETTER_SUBSCRIBER_RESTORED,
          changes: expect.objectContaining({ is_active: false }),
        }),
      );
    });

    it('throws NotFoundException when nothing is in the trash under that id', async () => {
      prisma.newsletter_subscribers.findFirst.mockResolvedValue(null);

      await expect(service.restore('ghost', 'admin-1')).rejects.toThrow(NotFoundException);
    });
  });
});
