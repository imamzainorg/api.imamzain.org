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

  @ApiProperty({ example: 47 })
  inactive_subscribers: number;

  @ApiProperty({ example: 12, description: 'Subscribed within the recent window' })
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
