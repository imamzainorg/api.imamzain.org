import type { Context } from 'hono';
import type { Prisma, newsletter_subscribers } from '../../generated/prisma/client';
import { AUDIT_ACTIONS, audit } from '../../lib/audit';
import { defer, getDb } from '../../lib/db';
import { isUniqueViolation, notFound, unauthorized } from '../../lib/errors';
import {
  KEY_INFO,
  hmacHex,
  resolveHmacKeyring,
  verifyHmacHex,
  type HmacKeyring,
} from '../../lib/hmac-keys';
import { isMailConfigured, sendMail } from '../../lib/mail';
import { buildPaginationMeta } from '../../lib/pagination';
import type { AppBindings, AppEnv } from '../../lib/types';
import {
  CONFIRM_RESEND_COOLDOWN_MS,
  buildConfirmationEmail,
  confirmationUrl,
  resolveConfirmConfig,
} from './confirmation';
import type { ConfirmInput, SubscribeInput, UnsubscribeInput } from './schemas';

type Ctx = Context<AppEnv>;

/** A confirmation link is good for 72 hours after the e-mail that carries it was claimed. */
const CONFIRM_TTL_MS = 72 * 3_600_000;

// One answer for every address in every state, see subscribe().
const SUBSCRIBE_ACCEPTED_MESSAGE = 'Please check your inbox to confirm your subscription';

const ONE_HOUR_MS = 3_600_000;

// One answer for every way a link can be bad, so the endpoint can't be used to probe the list.
const INVALID_LINK_MESSAGE = 'This confirmation link is invalid or has expired';

/** A dedicated NEWSLETTER_UNSUBSCRIBE_SECRET as-is for both token types; otherwise one derived key each (lib/hmac-keys). */
const tokenKeys = (env: AppBindings, info: string): HmacKeyring =>
  resolveHmacKeyring({
    dedicatedSecret: env.NEWSLETTER_UNSUBSCRIBE_SECRET,
    dedicatedName: 'NEWSLETTER_UNSUBSCRIBE_SECRET',
    jwtSecret: env.JWT_SECRET,
    info,
  });

/** Embedded in the confirmation e-mail's unsubscribe link; the same MAC every unsubscribe uses. */
const signUnsubscribeToken = (env: AppBindings, subscriberId: string) =>
  hmacHex(tokenKeys(env, KEY_INFO.newsletterUnsubscribe).signingKey, subscriberId);

const verifyUnsubscribeToken = (env: AppBindings, subscriberId: string, token: string) =>
  verifyHmacHex(tokenKeys(env, KEY_INFO.newsletterUnsubscribe), subscriberId, token);

/** Bound to (subscriber, the moment that e-mail was claimed): a newer confirmation e-mail kills every older link. */
const confirmationMessage = (subscriberId: string, issuedAt: Date) =>
  `confirm:${subscriberId}:${issuedAt.getTime()}`;

const signConfirmationToken = (env: AppBindings, subscriberId: string, issuedAt: Date) =>
  hmacHex(
    tokenKeys(env, KEY_INFO.newsletterConfirm).signingKey,
    confirmationMessage(subscriberId, issuedAt),
  );

const verifyConfirmationToken = (
  env: AppBindings,
  subscriberId: string,
  issuedAt: Date,
  token: string,
) =>
  verifyHmacHex(
    tokenKeys(env, KEY_INFO.newsletterConfirm),
    confirmationMessage(subscriberId, issuedAt),
    token,
  );

/** On the list and mailable right now. */
const isLive = (s: Pick<newsletter_subscribers, 'is_active' | 'deleted_at'>) =>
  s.is_active && s.deleted_at === null;

/**
 * Ask to join the list. Nobody is subscribed by this call: the address gets a confirmation e-mail and only
 * clicking its link (POST /newsletter/confirm) makes the subscription real. The reply is identical for a new
 * address, a pending one, an unsubscribed one, a deleted one and one already subscribed, and the mail is sent
 * after the reply, so neither the answer nor its timing gives the state away.
 */
export async function subscribe(c: Ctx, dto: SubscribeInput) {
  await requestConfirmation(c, dto.email);
  return { message: SUBSCRIBE_ACCEPTED_MESSAGE, data: null };
}

async function requestConfirmation(c: Ctx, email: string): Promise<void> {
  const db = getDb(c);
  let subscriber = await db.newsletter_subscribers.findUnique({ where: { email } });
  if (subscriber && isLive(subscriber)) return; // already on the list: nothing to confirm

  let created = false;
  if (!subscriber) {
    try {
      // Inactive until the link is clicked, never mailable before that.
      subscriber = await db.newsletter_subscribers.create({ data: { email, is_active: false } });
      created = true;
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      // A concurrent request created the row first; carry on with theirs.
      subscriber = await db.newsletter_subscribers.findUnique({ where: { email } });
      if (!subscriber || isLive(subscriber)) return;
    }
  }

  if (created) {
    audit(c, {
      actorId: null,
      action: AUDIT_ACTIONS.NEWSLETTER_SUBSCRIBE_REQUESTED,
      resourceType: 'newsletter_subscriber',
      resourceId: subscriber.id,
      changes: { method: 'POST', path: '/api/v1/newsletter/subscribe' },
    });
  }

  // An unsubscribed or deleted row stays exactly as it is until the link is clicked: asking to come back
  // must not undo an opt-out by itself.
  await sendConfirmation(c, subscriber);
}

/**
 * Claim the right to send one confirmation mail, then send it after the response. Claiming is a conditional
 * UPDATE on `confirmation_sent_at`, so two concurrent requests send one mail and the per-address cool-down
 * needs no lock. Both limits fail quietly: the caller must not be able to tell.
 */
async function sendConfirmation(c: Ctx, subscriber: newsletter_subscribers): Promise<void> {
  if (!isMailConfigured(c.env)) {
    console.warn('Newsletter confirmation not sent: the email binding is not configured');
    return;
  }

  const db = getDb(c);
  const config = resolveConfirmConfig(c.env);
  const now = new Date();

  const claimedLastHour = await db.newsletter_subscribers.count({
    where: { confirmation_sent_at: { gte: new Date(now.getTime() - ONE_HOUR_MS) } },
  });
  if (claimedLastHour >= config.maxPerHour) {
    console.warn(`Newsletter confirmation held back: hourly cap of ${config.maxPerHour} reached`);
    return;
  }

  const claim = await db.newsletter_subscribers.updateMany({
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

  defer(c, deliverConfirmation(c, subscriber, now, subscriber.confirmation_sent_at, config));
}

async function deliverConfirmation(
  c: Ctx,
  subscriber: newsletter_subscribers,
  claimedAt: Date,
  previousSentAt: Date | null,
  config: ReturnType<typeof resolveConfirmConfig>,
): Promise<void> {
  let delivered = false;
  try {
    const token = signConfirmationToken(c.env, subscriber.id, claimedAt);
    const message = buildConfirmationEmail(
      confirmationUrl(config.urlBase, subscriber.email, token),
      confirmationUrl(
        config.unsubscribeUrlBase,
        subscriber.email,
        signUnsubscribeToken(c.env, subscriber.id),
      ),
    );
    const result = await sendMail(c.env, { to: subscriber.email, ...message });
    delivered = result.ok;
    if (!result.ok) console.warn(`Newsletter confirmation e-mail failed: ${result.error}`);
  } catch (err) {
    console.error(
      `Newsletter confirmation e-mail failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (!delivered) {
    // Nothing reached the inbox, so neither the cool-down nor the hourly cap should stay spent on it.
    await getDb(c).newsletter_subscribers.updateMany({
      where: { id: subscriber.id, confirmation_sent_at: claimedAt },
      data: { confirmation_sent_at: previousSentAt },
    });
  }
}

/**
 * The click. Turns a pending / opted-out / deleted address into an active subscriber and stamps
 * `confirmed_at`, the moment the CURRENT consent was given.
 */
export async function confirm(c: Ctx, dto: ConfirmInput) {
  const db = getDb(c);
  const subscriber = await db.newsletter_subscribers.findUnique({ where: { email: dto.email } });
  const issuedAt = subscriber?.confirmation_sent_at ?? null;
  if (
    !subscriber ||
    !issuedAt ||
    !verifyConfirmationToken(c.env, subscriber.id, issuedAt, dto.token)
  ) {
    throw unauthorized(INVALID_LINK_MESSAGE);
  }

  // Idempotent: a double click, or a refresh of the confirm page.
  if (isLive(subscriber)) return { message: 'Subscription already confirmed', data: null };

  const now = new Date();
  if (now.getTime() - issuedAt.getTime() > CONFIRM_TTL_MS) throw unauthorized(INVALID_LINK_MESSAGE);
  // Opted out (or removed by an admin) AFTER this link was sent: it no longer speaks for them.
  if (
    (subscriber.unsubscribed_at && subscriber.unsubscribed_at > issuedAt) ||
    (subscriber.deleted_at && subscriber.deleted_at > issuedAt)
  ) {
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

export async function unsubscribe(c: Ctx, dto: UnsubscribeInput) {
  const db = getDb(c);
  const subscriber = await db.newsletter_subscribers.findUnique({ where: { email: dto.email } });

  // "Not found" and "invalid token" give the same error so subscribers can't be enumerated.
  if (!subscriber || !verifyUnsubscribeToken(c.env, subscriber.id, dto.token))
    throw unauthorized('Invalid unsubscribe token');

  // Idempotent: double-clicking the link must not surface a confusing 404.
  if (!subscriber.is_active) return { message: 'Already unsubscribed', data: subscriber };

  const updated = await db.newsletter_subscribers.update({
    where: { id: subscriber.id },
    data: { is_active: false, unsubscribed_at: new Date() },
  });

  audit(c, {
    actorId: null,
    action: AUDIT_ACTIONS.NEWSLETTER_UNSUBSCRIBED,
    resourceType: 'newsletter_subscriber',
    resourceId: subscriber.id,
    changes: { method: 'POST', path: '/api/v1/newsletter/unsubscribe' },
  });

  return { message: 'Successfully unsubscribed', data: updated };
}

export async function findAll(
  c: Ctx,
  page: number,
  limit: number,
  filters: { search?: string; is_active?: boolean },
) {
  const db = getDb(c);
  const where: Prisma.newsletter_subscribersWhereInput = {
    deleted_at: null,
    is_active: filters.is_active ?? true,
  };
  if (filters.search) where.email = { contains: filters.search, mode: 'insensitive' };

  const [items, total] = await Promise.all([
    db.newsletter_subscribers.findMany({
      where,
      orderBy: [{ subscribed_at: 'desc' }, { id: 'asc' }],
      skip: (page - 1) * limit,
      take: limit,
    }),
    db.newsletter_subscribers.count({ where }),
  ]);

  return {
    message: 'Subscribers fetched',
    data: { items, pagination: buildPaginationMeta(page, limit, total) },
  };
}

/** Admin-side unsubscribe: authorised by `newsletter:update` instead of the inbox-ownership token. Idempotent. */
export async function unsubscribeAsAdmin(c: Ctx, id: string, actorId: string) {
  const db = getDb(c);
  const subscriber = await db.newsletter_subscribers.findFirst({ where: { id, deleted_at: null } });
  if (!subscriber) throw notFound('Subscriber not found');

  if (!subscriber.is_active) return { message: 'Already unsubscribed', data: subscriber };

  const updated = await db.newsletter_subscribers.update({
    where: { id },
    data: { is_active: false, unsubscribed_at: new Date() },
  });

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

  const updated = await db.newsletter_subscribers.update({
    where: { id },
    data: { is_active: true, unsubscribed_at: null, confirmed_at: new Date() },
  });

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
  await db.newsletter_subscribers.update({
    where: { id },
    data: { deleted_at: new Date(), is_active: false },
  });

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
    db.newsletter_subscribers.findMany({
      where,
      orderBy: [{ deleted_at: 'desc' }, { id: 'asc' }],
      skip: (page - 1) * limit,
      take: limit,
    }),
    db.newsletter_subscribers.count({ where }),
  ]);
  return {
    message: 'Trash fetched',
    data: { items, pagination: buildPaginationMeta(page, limit, total) },
  };
}

/**
 * Someone subscribed when deleted is active again, but an explicit opt-out survives the round trip and
 * a sign-up that never confirmed stays waiting for its confirmation.
 */
export async function restore(c: Ctx, id: string, actorId: string) {
  const db = getDb(c);
  const subscriber = await db.newsletter_subscribers.findFirst({
    where: { id, deleted_at: { not: null } },
  });
  if (!subscriber) throw notFound('Deleted subscriber not found');

  const wasSubscribed = subscriber.unsubscribed_at === null && subscriber.confirmed_at !== null;
  const updated = await db.newsletter_subscribers.update({
    where: { id },
    data: { deleted_at: null, is_active: wasSubscribed },
  });

  audit(c, {
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
