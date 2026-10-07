import type { Context } from 'hono';
import { getDb } from '../../lib/db';
import type { AppEnv } from '../../lib/types';

const RECENT_WINDOW_DAYS = 7;

interface AggregatedCounts {
  posts_total: bigint;
  posts_published: bigint;
  posts_draft: bigint;
  posts_recent: bigint;
}

interface AggregatedAudioCounts {
  audios_total: bigint;
  audios_published: bigint;
  audios_draft: bigint;
}

export async function getStats(c: Context<AppEnv>) {
  const db = getDb(c);
  const recentSince = new Date(Date.now() - RECENT_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const [
    postCounts,
    audioCounts,
    booksTotal,
    papersTotal,
    galleryTotal,
    mediaTotal,
    usersTotal,
    subscribersActive,
    subscribersInactive,
    subscribersPending,
    subscribersRecent,
    contactNew,
    contactRecent,
    proxyNew,
    proxyRecent,
    formsNotificationFailedContact,
    formsNotificationFailedProxy,
    contestAttemptsRecent,
  ] = await Promise.all([
    // Collapse 4 separate post count queries into 1 FILTER-based aggregate.
    // The original 4 sequential COUNTs each did their own index scan; this
    // does a single scan with conditional aggregation.
    db.$queryRaw<AggregatedCounts[]>`
      SELECT
        COUNT(*) FILTER (WHERE deleted_at IS NULL) AS posts_total,
        COUNT(*) FILTER (WHERE deleted_at IS NULL AND is_published = TRUE) AS posts_published,
        COUNT(*) FILTER (WHERE deleted_at IS NULL AND is_published = FALSE) AS posts_draft,
        COUNT(*) FILTER (WHERE deleted_at IS NULL AND created_at >= ${recentSince}) AS posts_recent
      FROM posts
    `,
    db.$queryRaw<AggregatedAudioCounts[]>`
      SELECT
        COUNT(*) FILTER (WHERE deleted_at IS NULL) AS audios_total,
        COUNT(*) FILTER (WHERE deleted_at IS NULL AND is_published = TRUE) AS audios_published,
        COUNT(*) FILTER (WHERE deleted_at IS NULL AND is_published = FALSE) AS audios_draft
      FROM audios
    `,
    // parent_id: null — count distinct catalogue titles, not raw rows;
    // a 12-part series is 12 rows but one book on every other surface.
    db.books.count({ where: { deleted_at: null, parent_id: null } }),
    db.academic_papers.count({ where: { deleted_at: null } }),
    db.gallery_images.count({ where: { deleted_at: null } }),
    db.media.count(),
    db.users.count({ where: { deleted_at: null } }),
    db.newsletter_subscribers.count({ where: { deleted_at: null, is_active: true } }),
    // Inactive = opted out. A sign-up still waiting for its confirmation click
    // is inactive too (confirmed_at NULL) but is counted separately below, so it
    // is not mistaken for an unsubscribe.
    db.newsletter_subscribers.count({
      where: { deleted_at: null, is_active: false, confirmed_at: { not: null } },
    }),
    db.newsletter_subscribers.count({
      where: { deleted_at: null, is_active: false, confirmed_at: null },
    }),
    // New consents in the window — confirmations and admin re-subscribes — not
    // raw sign-up attempts, which the confirmation e-mail has not yet vouched for.
    db.newsletter_subscribers.count({
      where: { deleted_at: null, confirmed_at: { gte: recentSince } },
    }),
    db.contact_submissions.count({ where: { deleted_at: null, status: 'NEW' } }),
    db.contact_submissions.count({
      where: { deleted_at: null, submitted_at: { gte: recentSince } },
    }),
    db.proxy_visit_requests.count({ where: { deleted_at: null, status: 'PENDING' } }),
    db.proxy_visit_requests.count({
      where: { deleted_at: null, submitted_at: { gte: recentSince } },
    }),
    // Notifications that are STILL waiting and whose last send failed — i.e.
    // stuck right now (SMTP down or misconfigured), retried automatically by the
    // digest cron. notified_at IS NULL keeps historical failures out: rows from
    // before the outbox existed were stamped notified_at by the migration and are
    // never retried, so they must not hold this counter above zero forever.
    db.contact_submissions.count({
      where: { deleted_at: null, notified_at: null, notification_failed_at: { not: null } },
    }),
    db.proxy_visit_requests.count({
      where: { deleted_at: null, notified_at: null, notification_failed_at: { not: null } },
    }),
    db.qutuf_sajjadiya_contest_attempts.count({
      where: { started_at: { gte: recentSince } },
    }),
  ]);

  const postRow = postCounts[0];
  const audioRow = audioCounts[0];

  return {
    message: 'Dashboard stats',
    data: {
      recent_window_days: RECENT_WINDOW_DAYS,
      posts: {
        total: Number(postRow?.posts_total ?? 0),
        published: Number(postRow?.posts_published ?? 0),
        drafts: Number(postRow?.posts_draft ?? 0),
        recent: Number(postRow?.posts_recent ?? 0),
      },
      audios: {
        total: Number(audioRow?.audios_total ?? 0),
        published: Number(audioRow?.audios_published ?? 0),
        drafts: Number(audioRow?.audios_draft ?? 0),
      },
      library: {
        books: booksTotal,
        academic_papers: papersTotal,
        gallery_images: galleryTotal,
        media_assets: mediaTotal,
      },
      users: {
        total: usersTotal,
      },
      newsletter: {
        active_subscribers: subscribersActive,
        inactive_subscribers: subscribersInactive,
        pending_subscribers: subscribersPending,
        recent_subscribers: subscribersRecent,
      },
      forms: {
        contact_new: contactNew,
        contact_recent: contactRecent,
        proxy_visit_pending: proxyNew,
        proxy_visit_recent: proxyRecent,
        unsent_notifications: formsNotificationFailedContact + formsNotificationFailedProxy,
      },
      contest: {
        attempts_recent: contestAttemptsRecent,
      },
    },
  };
}
