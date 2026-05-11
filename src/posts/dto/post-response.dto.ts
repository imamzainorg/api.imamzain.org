import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationMetaDto } from '../../common/dto/api-response.dto';

class PostTranslationItemDto {
  @ApiProperty({ example: 'ar' })
  lang: string;

  @ApiProperty({ example: 'عنوان المنشور' })
  title: string;

  @ApiPropertyOptional({ example: 'مقتطف من المنشور' })
  summary?: string;

  @ApiProperty({ example: 'نص المنشور الكامل...' })
  body: string;

  @ApiProperty({ example: 'hayat-al-imam-zain' })
  slug: string;

  @ApiProperty({ example: true })
  is_default: boolean;

  @ApiPropertyOptional({
    example: 'حياة الإمام السجاد – السيرة الكاملة',
    description: 'SEO: used in <title> and SERP heading. Null falls back to title at render time.',
  })
  meta_title?: string;

  @ApiPropertyOptional({
    example: 'نظرة شاملة على سيرة الإمام علي بن الحسين زين العابدين.',
    description: 'SEO: SERP snippet + og:description fallback. Null falls back to summary or body excerpt.',
  })
  meta_description?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'SEO: media id for og:image / twitter:image. Null falls back to the post cover_image_id.',
  })
  og_image_id?: string;

  @ApiProperty({
    example: 4,
    description:
      'Server-side estimated reading time in minutes. Derived from body text length (~1000 characters per minute, tuned for mixed Arabic + English). Minimum 1 for any non-empty body.',
  })
  reading_time_minutes: number;
}

class PostAttachmentDto {
  @ApiProperty({ example: 'uuid-...' })
  media_id: string;

  @ApiProperty({ example: 0 })
  display_order: number;

  @ApiPropertyOptional({ example: { id: 'uuid-...', url: 'https://cdn.example.com/file.pdf', mime_type: 'application/pdf' } })
  media?: Record<string, any>;
}

class PostSummaryDto {
  @ApiProperty({ example: 'uuid-...' })
  id: string;

  @ApiProperty({ example: 'uuid-...', description: 'ID of the post category' })
  category_id: string;

  @ApiPropertyOptional({ example: 'uuid-...', description: 'ID of the cover image media record' })
  cover_image_id?: string;

  @ApiProperty({ example: true })
  is_published: boolean;

  @ApiProperty({ example: false, description: 'Editorial featured flag — surfaces in `?featured=true` queries.' })
  is_featured: boolean;

  @ApiPropertyOptional({ example: '2024-01-01T00:00:00.000Z' })
  published_at?: string;

  @ApiProperty({ example: 0 })
  views: number;

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
  created_at: string;

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
  updated_at: string;

  @ApiProperty({ type: [PostTranslationItemDto], description: 'All stored translations' })
  post_translations: PostTranslationItemDto[];

  @ApiProperty({ type: PostTranslationItemDto, nullable: true, description: 'Resolved translation for the requested language' })
  translation: PostTranslationItemDto | null;
}

class PostDetailDto extends PostSummaryDto {
  @ApiProperty({ type: [PostAttachmentDto], description: 'Ordered list of attachments' })
  post_attachments: PostAttachmentDto[];
}

class PostListDataDto {
  @ApiProperty({ type: [PostSummaryDto] })
  items: PostSummaryDto[];

  @ApiProperty({ type: PaginationMetaDto })
  pagination: PaginationMetaDto;
}

export class PostListResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
  timestamp: string;

  @ApiProperty({ example: 'Posts fetched' })
  message: string;

  @ApiProperty({ type: PostListDataDto })
  data: PostListDataDto;
}

export class PostDetailResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
  timestamp: string;

  @ApiProperty({ example: 'Post fetched' })
  message: string;

  @ApiProperty({ type: PostDetailDto })
  data: PostDetailDto;
}

export class PostCreatedResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
  timestamp: string;

  @ApiProperty({ example: 'Post created' })
  message: string;

  @ApiProperty({ type: PostDetailDto })
  data: PostDetailDto;
}

export class PostMessageResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
  timestamp: string;

  @ApiProperty({ example: 'Post deleted' })
  message: string;

  @ApiProperty({ type: Object, nullable: true, example: null })
  data: null;
}
