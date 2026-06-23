import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ApiEnvelope, ApiPaginatedData } from '../../common/dto/api-envelope';

class YoutubeVideoItemDto {
  @ApiProperty({ example: 'dQw4w9WgXcQ', description: 'YouTube 11-char video ID' })
  video_id!: string;

  @ApiProperty({ example: 'Sermon on patience' })
  title!: string;

  @ApiPropertyOptional({ example: 'Full description from YouTube...' })
  description?: string | null;

  @ApiPropertyOptional({ example: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg' })
  thumbnail_url?: string | null;

  @ApiProperty({ example: 'UCGccH_OeEhhWGUE1xeIsxeA' })
  channel_id!: string;

  @ApiPropertyOptional({ example: 'Imam Zain Foundation' })
  channel_title?: string | null;

  @ApiPropertyOptional({ example: '2026-05-10T14:00:00.000Z' })
  published_at?: string | null;

  @ApiPropertyOptional({ example: 'PT5M30S', description: 'ISO 8601 video duration.' })
  duration?: string | null;

  @ApiPropertyOptional({ example: 1284 })
  view_count?: number | null;

  @ApiPropertyOptional({ example: 47 })
  like_count?: number | null;

  @ApiProperty({ example: '2026-05-12T06:00:00.000Z', description: 'When the API last refreshed this row from YouTube.' })
  last_synced_at!: string;
}

class YoutubeVideoListDataDto extends ApiPaginatedData(YoutubeVideoItemDto) {}

export class YoutubeVideoListResponseDto extends ApiEnvelope(YoutubeVideoListDataDto, 'Videos fetched') {}

class YoutubePlaylistItemDto {
  @ApiProperty({ example: 'PLxxxxxxxxxx', description: 'YouTube playlist ID' })
  playlist_id!: string;

  @ApiProperty({ example: 'Khutbahs of the Imams' })
  title!: string;

  @ApiPropertyOptional({ example: 'Curated khutbahs...' })
  description?: string | null;

  @ApiPropertyOptional({ example: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg' })
  thumbnail_url?: string | null;

  @ApiPropertyOptional({ example: 24 })
  item_count?: number | null;

  @ApiProperty({ example: 'UCGccH_OeEhhWGUE1xeIsxeA' })
  channel_id!: string;

  @ApiPropertyOptional({ example: '2026-01-01T00:00:00.000Z' })
  published_at?: string | null;

  @ApiProperty({ example: '2026-05-12T06:00:00.000Z' })
  last_synced_at!: string;
}

class YoutubePlaylistListDataDto extends ApiPaginatedData(YoutubePlaylistItemDto) {}

export class YoutubePlaylistListResponseDto extends ApiEnvelope(YoutubePlaylistListDataDto, 'Playlists fetched') {}

class YoutubePlaylistVideosDataDto {
  @ApiProperty({ type: YoutubePlaylistItemDto })
  playlist!: YoutubePlaylistItemDto;

  @ApiProperty({ type: [YoutubeVideoItemDto], description: 'Videos in playlist order (server preserves YouTube\'s position).' })
  videos!: YoutubeVideoItemDto[];
}

export class YoutubePlaylistVideosResponseDto extends ApiEnvelope(YoutubePlaylistVideosDataDto, 'Playlist videos fetched') {}
