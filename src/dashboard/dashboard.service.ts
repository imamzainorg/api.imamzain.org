import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TtlCache } from '../common/utils/ttl-cache.util';

const RECENT_WINDOW_DAYS = 7;
// The CMS home screen doesn't need second-by-second accuracy. 30s keeps the
// counts fresh enough for an editor's "just published" feedback loop, while
// absorbing the spike of every CMS user opening the dashboard at once.
const DASHBOARD_CACHE_TTL_MS = 30_000;

interface AggregatedCounts {
  posts_total: bigint;
  posts_published: bigint;
  posts_draft: bigint;
  posts_recent: bigint;
}

/**
 * Aggregates the small set of counts a CMS home screen needs in one request.
 *
 * Implementation note: heavy counts on the same table are collapsed via
 * FILTER clauses into a single SELECT (4 post counts → 1 query), keeping the
 * total round-trip count low. The whole response is also cached in-process
 * for `DASHBOARD_CACHE_TTL_MS`.
 */
@Injectable()
export class DashboardService {
  private readonly cache = new TtlCache<unknown>(DASHBOARD_CACHE_TTL_MS);

  constructor(private readonly prisma: PrismaService) {}

  async getStats() {
    const cached = this.cache.get('stats');
    if (cached) return cached as { message: string; data: unknown };

    const recentSince = new Date(Date.now() - RECENT_WINDOW_DAYS * 24 * 60 * 60 * 1000);

    const [
      postCounts,
      booksTotal,
      papersTotal,
      galleryTotal,
      mediaTotal,
      usersTotal,
      subscribersActive,
      subscribersInactive,
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
      this.prisma.$queryRaw<AggregatedCounts[]>`
        SELECT
          COUNT(*) FILTER (WHERE deleted_at IS NULL) AS posts_total,
          COUNT(*) FILTER (WHERE deleted_at IS NULL AND is_published = TRUE) AS posts_published,
          COUNT(*) FILTER (WHERE deleted_at IS NULL AND is_published = FALSE) AS posts_draft,
          COUNT(*) FILTER (WHERE deleted_at IS NULL AND created_at >= ${recentSince}) AS posts_recent
        FROM posts
      `,
      this.prisma.books.count({ where: { deleted_at: null } }),
      this.prisma.academic_papers.count({ where: { deleted_at: null } }),
      this.prisma.gallery_images.count({ where: { deleted_at: null } }),
      this.prisma.media.count(),
      this.prisma.users.count({ where: { deleted_at: null } }),
      this.prisma.newsletter_subscribers.count({ where: { deleted_at: null, is_active: true } }),
      this.prisma.newsletter_subscribers.count({ where: { deleted_at: null, is_active: false } }),
      this.prisma.newsletter_subscribers.count({
        where: { deleted_at: null, subscribed_at: { gte: recentSince } },
      }),
      this.prisma.contact_submissions.count({ where: { deleted_at: null, status: 'NEW' } }),
      this.prisma.contact_submissions.count({
        where: { deleted_at: null, submitted_at: { gte: recentSince } },
      }),
      this.prisma.proxy_visit_requests.count({ where: { deleted_at: null, status: 'PENDING' } }),
      this.prisma.proxy_visit_requests.count({
        where: { deleted_at: null, submitted_at: { gte: recentSince } },
      }),
      this.prisma.contact_submissions.count({
        where: { deleted_at: null, notification_failed_at: { not: null } },
      }),
      this.prisma.proxy_visit_requests.count({
        where: { deleted_at: null, notification_failed_at: { not: null } },
      }),
      this.prisma.qutuf_sajjadiya_contest_attempts.count({
        where: { started_at: { gte: recentSince } },
      }),
    ]);

    const postRow = postCounts[0];

    const response = {
      message: 'Dashboard stats',
      data: {
        recent_window_days: RECENT_WINDOW_DAYS,
        posts: {
          total: Number(postRow?.posts_total ?? 0),
          published: Number(postRow?.posts_published ?? 0),
          drafts: Number(postRow?.posts_draft ?? 0),
          recent: Number(postRow?.posts_recent ?? 0),
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

    this.cache.set('stats', response);
    return response;
  }
}
