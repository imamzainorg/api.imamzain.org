import { ApiProperty } from '@nestjs/swagger';

class PostsStatsDto {
  @ApiProperty({ example: 142 })
  total: number;

  @ApiProperty({ example: 128 })
  published: number;

  @ApiProperty({ example: 14 })
  drafts: number;

  @ApiProperty({ example: 6, description: 'Created within the recent window' })
  recent: number;
}

class AudiosStatsDto {
  @ApiProperty({ example: 50 })
  total: number;

  @ApiProperty({ example: 48 })
  published: number;

  @ApiProperty({ example: 2 })
  drafts: number;
}

class LibraryStatsDto {
  @ApiProperty({ example: 87 })
  books: number;

  @ApiProperty({ example: 23 })
  academic_papers: number;

  @ApiProperty({ example: 412 })
  gallery_images: number;

  @ApiProperty({ example: 504 })
  media_assets: number;
}

class UsersStatsDto {
  @ApiProperty({ example: 9 })
  total: number;
}

class NewsletterStatsDto {
  @ApiProperty({ example: 1280 })
  active_subscribers: number;

  @ApiProperty({ example: 47, description: 'Opted out (unsubscribed by themselves or by an admin). Excludes sign-ups still waiting for confirmation.' })
  inactive_subscribers: number;

  @ApiProperty({ example: 5, description: 'Signed up but have not yet clicked the confirmation link (double opt-in). Not mailed until they do.' })
  pending_subscribers: number;

  @ApiProperty({ example: 12, description: 'Confirmed their subscription within the recent window' })
  recent_subscribers: number;
}

class FormsStatsDto {
  @ApiProperty({ example: 4, description: 'Contact submissions awaiting response' })
  contact_new: number;

  @ApiProperty({ example: 11 })
  contact_recent: number;

  @ApiProperty({ example: 2 })
  proxy_visit_pending: number;

  @ApiProperty({ example: 5 })
  proxy_visit_recent: number;

  @ApiProperty({
    example: 0,
    description:
      'Submissions still waiting for their admin-notification digest whose last send failed — stuck RIGHT NOW (SMTP down, or stale credentials); the digest cron retries them every minute and the count drops to 0 by itself once mail flows. Historical failures from before the digest outbox existed are not counted. Non-zero for more than a few minutes: on-call should investigate.',
  })
  unsent_notifications: number;
}

class ContestStatsDto {
  @ApiProperty({ example: 318 })
  attempts_recent: number;
}

class DashboardStatsDataDto {
  @ApiProperty({ example: 7 })
  recent_window_days: number;

  @ApiProperty({ type: PostsStatsDto })
  posts: PostsStatsDto;

  @ApiProperty({ type: AudiosStatsDto })
  audios: AudiosStatsDto;

  @ApiProperty({ type: LibraryStatsDto })
  library: LibraryStatsDto;

  @ApiProperty({ type: UsersStatsDto })
  users: UsersStatsDto;

  @ApiProperty({ type: NewsletterStatsDto })
  newsletter: NewsletterStatsDto;

  @ApiProperty({ type: FormsStatsDto })
  forms: FormsStatsDto;

  @ApiProperty({ type: ContestStatsDto })
  contest: ContestStatsDto;
}

/**
 * Aggregated CMS home-screen counters.
 *
 * **Server-side cached for 30 seconds** to absorb the bursty fan-out of
 * every CMS user opening the dashboard at once. The CMS should not poll
 * faster than the cache TTL — the response is byte-identical until the
 * cache expires. The 4 post counters are collapsed into a single
 * `FILTER`-based SQL aggregate so the underlying read pressure stays
 * minimal regardless of cache state.
 */
export class DashboardStatsResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: '2026-05-10T12:00:00.000Z' })
  timestamp: string;

  @ApiProperty({ example: 'Dashboard stats' })
  message: string;

  @ApiProperty({ type: DashboardStatsDataDto })
  data: DashboardStatsDataDto;
}
