import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const RECENT_WINDOW_DAYS = 7;

/**
 * Aggregates the small set of counts a CMS home screen needs in one request.
 *
 * The CMS previously had to fan out 10+ list calls (each filtered with
 * limit=1 just to read the total) to render its dashboard. This endpoint
 * collapses that into a single round-trip with one Promise.all over
 * Prisma `count` queries.
 */
@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getStats() {
    const recentSince = new Date(Date.now() - RECENT_WINDOW_DAYS * 24 * 60 * 60 * 1000);

    const [
      postsTotal,
      postsPublished,
      postsDraft,
      postsRecent,
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
      contestAttemptsRecent,
    ] = await Promise.all([
      this.prisma.posts.count({ where: { deleted_at: null } }),
      this.prisma.posts.count({ where: { deleted_at: null, is_published: true } }),
      this.prisma.posts.count({ where: { deleted_at: null, is_published: false } }),
      this.prisma.posts.count({ where: { deleted_at: null, created_at: { gte: recentSince } } }),
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
      this.prisma.qutuf_sajjadiya_contest_attempts.count({
        where: { started_at: { gte: recentSince } },
      }),
    ]);

    return {
      message: 'Dashboard stats',
      data: {
        recent_window_days: RECENT_WINDOW_DAYS,
        posts: {
          total: postsTotal,
          published: postsPublished,
          drafts: postsDraft,
          recent: postsRecent,
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
        },
        contest: {
          attempts_recent: contestAttemptsRecent,
        },
      },
    };
  }
}
