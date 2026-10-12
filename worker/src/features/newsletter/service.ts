import type { Context } from 'hono';
import type { Prisma, newsletter_subscribers } from '../../generated/prisma/client';
import { AUDIT_ACTIONS, audit } from '../../lib/audit';
import { getDb } from '../../lib/db';
import { notFound, unauthorized } from '../../lib/errors';
import { KEY_INFO, resolveHmacKeyring, verifyHmacHex, type HmacKeyring } from '../../lib/hmac-keys';
import { buildPaginationMeta } from '../../lib/pagination';
import type { AppBindings, AppEnv } from '../../lib/types';
import type { ConfirmInput, UnsubscribeInput } from './schemas';

type Ctx = Context<AppEnv>;

/** A confirmation link is good for 72 hours after the e-mail that carries it was claimed. */
const CONFIRM_TTL_MS = 72 * 3_600_000;

// One answer for every way a link can be bad, so the endpoint can't be used to probe the list.
const INVALID_LINK_MESSAGE = 'This confirmation link is invalid or has expired';

/** A dedicated NEWSLETTER_UNSUBSCRIBE_SECRET as-is for both token types; otherwise one derived key each (lib/hmac-keys). */
const tokenKeys = (env: AppBindings, info: string): HmacKeyring =>
  resolveHmacKeyring({ dedicatedSecret: env.NEWSLETTER_UNSUBSCRIBE_SECRET, dedicatedName: 'NEWSLETTER_UNSUBSCRIBE_SECRET', jwtSecret: env.JWT_SECRET, info });

const verifyUnsubscribeToken = (env: AppBindings, subscriberId: string, token: string) =>
  verifyHmacHex(tokenKeys(env, KEY_INFO.newsletterUnsubscribe), subscriberId, token);

/** Bound to (subscriber, the moment that e-mail was claimed): a newer confirmation e-mail kills every older link. */
const verifyConfirmationToken = (env: AppBindings, subscriberId: string, issuedAt: Date, token: string) =>
  verifyHmacHex(tokenKeys(env, KEY_INFO.newsletterConfirm), `confirm:${subscriberId}:${issuedAt.getTime()}`, token);

/** On the list and mailable right now. */
const isLive = (s: Pick<newsletter_subscribers, 'is_active' | 'deleted_at'>) => s.is_active && s.deleted_at === null;

// POST /newsletter/subscribe is not here: it sends the confirmation e-mail, so it stays on Nest until
// the e-mail sender is ported (D1).

/**
 * The click. Turns a pending / opted-out / deleted address into an active subscriber and stamps
 * `confirmed_at`, the moment the CURRENT consent was given.
 */
export async function confirm(c: Ctx, dto: ConfirmInput) {
  const db = getDb(c);
  const subscriber = await db.newsletter_subscribers.findUnique({ where: { email: dto.email } });
  const issuedAt = subscriber?.confirmation_sent_at ?? null;
  if (!subscriber || !issuedAt || !verifyConfirmationToken(c.env, subscriber.id, issuedAt, dto.token)) {
    throw unauthorized(INVALID_LINK_MESSAGE);
  }

  // Idempotent: a double click, or a refresh of the confirm page.
  if (isLive(subscriber)) return { message: 'Subscription already confirmed', data: null };

  const now = new Date();
  if (now.getTime() - issuedAt.getTime() > CONFIRM_TTL_MS) throw unauthorized(INVALID_LINK_MESSAGE);
  // Opted out (or removed by an admin) AFTER this link was sent: it no longer speaks for them.
  if ((subscriber.unsubscribed_at && subscriber.unsubscribed_at > issuedAt) || (subscriber.deleted_at && subscriber.deleted_at > issuedAt)) {
    throw unauthorized(INVALID_LINK_MESSAGE);
  }

  const activated = await db.newsletter_subscribers.updateMany({
    // Still inactive and still THIS link: two concurrent clicks activate once.
    where: { id: subscriber.id, is_active: false, confirmation_sent_at: issuedAt },
    data: { is_active: true, confirmed_at: now, unsubscribed_at: null, deleted_at: null },
  });
  if (activated.count === 0) {
    const fresh = await db.newsletter_subscribers.findUnique({ where: { id: subscriber.id } });
    if (fresh && isLive(fresh)) return { message: 'Subscription already confirmed', data: null };
    throw unauthorized(INVALID_LINK_MESSAGE);
  }

  audit(c, {
    actorId: null,
    action: subscriber.confirmed_at === null ? AUDIT_ACTIONS.NEWSLETTER_SUBSCRIBED : AUDIT_ACTIONS.NEWSLETTER_RESUBSCRIBED,
    resourceType: 'newsletter_subscriber',
    resourceId: subscriber.id,
    changes: { method: 'POST', path: '/api/v1/newsletter/confirm' },
  });

  return { message: 'Subscription confirmed', data: null };
}

export async function unsubscribe(c: Ctx, dto: UnsubscribeInput) {
  const db = getDb(c);
  const subscriber = await db.newsletter_subscribers.findUnique({ where: { email: dto.email } });

  // "Not found" and "invalid token" give the same error so subscribers can't be enumerated.
  if (!subscriber || !verifyUnsubscribeToken(c.env, subscriber.id, dto.token)) throw unauthorized('Invalid unsubscribe token');

  // Idempotent: double-clicking the link must not surface a confusing 404.
  if (!subscriber.is_active) return { message: 'Already unsubscribed', data: subscriber };

  const updated = await db.newsletter_subscribers.update({ where: { id: subscriber.id }, data: { is_active: false, unsubscribed_at: new Date() } });

  audit(c, {
    actorId: null,
    action: AUDIT_ACTIONS.NEWSLETTER_UNSUBSCRIBED,
    resourceType: 'newsletter_subscriber',
    resourceId: subscriber.id,
    changes: { method: 'POST', path: '/api/v1/newsletter/unsubscribe' },
  });

  return { message: 'Successfully unsubscribed', data: updated };
}

export async function findAll(c: Ctx, page: number, limit: number, filters: { search?: string; is_active?: boolean }) {
  const db = getDb(c);
  const where: Prisma.newsletter_subscribersWhereInput = { deleted_at: null, is_active: filters.is_active ?? true };
  if (filters.search) where.email = { contains: filters.search, mode: 'insensitive' };

  const [items, total] = await Promise.all([
    db.newsletter_subscribers.findMany({ where, orderBy: [{ subscribed_at: 'desc' }, { id: 'asc' }], skip: (page - 1) * limit, take: limit }),
    db.newsletter_subscribers.count({ where }),
  ]);

  return { message: 'Subscribers fetched', data: { items, pagination: buildPaginationMeta(page, limit, total) } };
}

/** Admin-side unsubscribe: authorised by `newsletter:update` instead of the inbox-ownership token. Idempotent. */
export async function unsubscribeAsAdmin(c: Ctx, id: string, actorId: string) {
  const db = getDb(c);
  const subscriber = await db.newsletter_subscribers.findFirst({ where: { id, deleted_at: null } });
  if (!subscriber) throw notFound('Subscriber not found');

  if (!subscriber.is_active) return { message: 'Already unsubscribed', data: subscriber };

  const updated = await db.newsletter_subscribers.update({ where: { id }, data: { is_active: false, unsubscribed_at: new Date() } });

  audit(c, {
    actorId,
    action: AUDIT_ACTIONS.NEWSLETTER_UNSUBSCRIBED_BY_ADMIN,
    resourceType: 'newsletter_subscriber',
    resourceId: id,
    changes: { method: 'POST', path: `/api/v1/newsletter/subscribers/${id}/unsubscribe` },
  });

  return { message: 'Successfully unsubscribed', data: updated };
}

/** Admin-side resubscribe: the admin vouches for the consent, so `confirmed_at` is re-stamped. Idempotent. */
export async function resubscribeAsAdmin(c: Ctx, id: string, actorId: string) {
  const db = getDb(c);
  const subscriber = await db.newsletter_subscribers.findFirst({ where: { id, deleted_at: null } });
  if (!subscriber) throw notFound('Subscriber not found');

  if (subscriber.is_active) return { message: 'Already subscribed', data: subscriber };

  const updated = await db.newsletter_subscribers.update({ where: { id }, data: { is_active: true, unsubscribed_at: null, confirmed_at: new Date() } });

  audit(c, {
    actorId,
    action: AUDIT_ACTIONS.NEWSLETTER_RESUBSCRIBED_BY_ADMIN,
    resourceType: 'newsletter_subscriber',
    resourceId: id,
    changes: { method: 'POST', path: `/api/v1/newsletter/subscribers/${id}/resubscribe` },
  });

  return { message: 'Successfully resubscribed', data: updated };
}

export async function softDelete(c: Ctx, id: string, actorId: string) {
  const db = getDb(c);
  const subscriber = await db.newsletter_subscribers.findFirst({ where: { id, deleted_at: null } });
  if (!subscriber) throw notFound('Subscriber not found');

  // is_active is cleared too, so a deleted row never reads is_active=true.
  await db.newsletter_subscribers.update({ where: { id }, data: { deleted_at: new Date(), is_active: false } });

  audit(c, {
    actorId,
    action: AUDIT_ACTIONS.NEWSLETTER_SUBSCRIBER_DELETED,
    resourceType: 'newsletter_subscriber',
    resourceId: id,
    changes: { method: 'DELETE', path: `/api/v1/newsletter/subscribers/${id}` },
  });

  return { message: 'Subscriber deleted', data: null };
}

export async function findTrash(c: Ctx, page: number, limit: number) {
  const db = getDb(c);
  const where: Prisma.newsletter_subscribersWhereInput = { deleted_at: { not: null } };
  const [items, total] = await Promise.all([
    db.newsletter_subscribers.findMany({ where, orderBy: [{ deleted_at: 'desc' }, { id: 'asc' }], skip: (page - 1) * limit, take: limit }),
    db.newsletter_subscribers.count({ where }),
  ]);
  return { message: 'Trash fetched', data: { items, pagination: buildPaginationMeta(page, limit, total) } };
}

/**
 * Someone subscribed when deleted is active again, but an explicit opt-out survives the round trip and
 * a sign-up that never confirmed stays waiting for its confirmation.
 */
export async function restore(c: Ctx, id: string, actorId: string) {
  const db = getDb(c);
  const subscriber = await db.newsletter_subscribers.findFirst({ where: { id, deleted_at: { not: null } } });
  if (!subscriber) throw notFound('Deleted subscriber not found');

  const wasSubscribed = subscriber.unsubscribed_at === null && subscriber.confirmed_at !== null;
  const updated = await db.newsletter_subscribers.update({ where: { id }, data: { deleted_at: null, is_active: wasSubscribed } });

  audit(c, {
    actorId,
    action: AUDIT_ACTIONS.NEWSLETTER_SUBSCRIBER_RESTORED,
    resourceType: 'newsletter_subscriber',
    resourceId: id,
    changes: { method: 'POST', path: `/api/v1/newsletter/subscribers/${id}/restore`, is_active: wasSubscribed },
  });

  return { message: 'Subscriber restored', data: updated };
}
