import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationMetaDto } from '../../common/dto/api-response.dto';

/**
 * Full translation row, returned by detail endpoints (`GET /posts/:id`,
 * `GET /posts/by-slug/:slug`) and create / update / publish responses.
 *
 * List endpoints (`GET /posts`, `GET /posts/admin`, `GET /posts/trash`)
 * return the slimmer `PostListTranslationItemDto` below — they drop
 * `body` and set `reading_time_minutes` to 0 to keep page payloads
 * small. Read the full row from the detail endpoint when you need
 * `body` or the real reading time.
 */
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
      'Server-side estimated reading time in minutes. Derived from body text length (~1000 characters per minute, tuned for mixed Arabic + English). Minimum 1 for any non-empty body. Always 0 on list endpoints (body isn’t fetched there) — read from a detail endpoint for the real value.',
  })
  reading_time_minutes: number;
}

/**
 * Translation shape returned by list endpoints. Identical to the detail
 * shape except `body` is omitted and `reading_time_minutes` is always 0.
 * Kept as its own DTO so generated clients have an accurate type for the
 * list response shape and don't expect a `body` field that isn't there.
 */
class PostListTranslationItemDto {
  @ApiProperty({ example: 'ar' })
  lang: string;

  @ApiProperty({ example: 'عنوان المنشور' })
  title: string;

  @ApiPropertyOptional({ example: 'مقتطف من المنشور' })
  summary?: string;

  @ApiProperty({ example: 'hayat-al-imam-zain' })
  slug: string;

  @ApiProperty({ example: true })
  is_default: boolean;

  @ApiPropertyOptional({ example: 'حياة الإمام السجاد – السيرة الكاملة' })
  meta_title?: string;

  @ApiPropertyOptional({ example: 'نظرة شاملة على سيرة الإمام علي بن الحسين زين العابدين.' })
  meta_description?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  og_image_id?: string;

  @ApiProperty({
    example: 0,
    description: 'Always 0 on list responses — read from `GET /posts/:id` for the real value.',
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

class PostCategoryTranslationRefDto {
  @ApiProperty({ example: 'ar' })
  lang: string;

  @ApiProperty({ example: 'الأخبار والمستجدات' })
  title: string;

  @ApiProperty({ example: 'al-akhbar' })
  slug: string;

  @ApiPropertyOptional({ example: 'آخر الأخبار المتعلقة بالموقع', nullable: true })
  description: string | null;
}

class PostCategoryRefDto {
  @ApiProperty({ example: 'uuid-...' })
  id: string;

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
  created_at: string;

  @ApiProperty({ type: [PostCategoryTranslationRefDto], description: 'All translations of the parent category — resolve client-side or rely on Accept-Language during a subsequent /post-categories fetch.' })
  post_category_translations: PostCategoryTranslationRefDto[];
}

class MediaRefDto {
  @ApiProperty({ example: 'uuid-...' })
  id: string;

  @ApiProperty({ example: 'https://cdn.imamzain.org/media/originals/uuid/cover.jpg' })
  url: string;

  @ApiProperty({ example: 'cover.jpg' })
  filename: string;

  @ApiPropertyOptional({ example: 'صورة الغلاف', nullable: true })
  alt_text: string | null;

  @ApiProperty({ example: 'image/jpeg' })
  mime_type: string;

  @ApiPropertyOptional({ example: 1920, nullable: true })
  width: number | null;

  @ApiPropertyOptional({ example: 1080, nullable: true })
  height: number | null;
}

/**
 * Item shape returned in `GET /posts*` list responses. Slim translations
 * (no `body`, no `reading_time_minutes` > 0) keep page payloads small —
 * a typical post list is 80–95% smaller than the equivalent detail-shaped
 * payload.
 */
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

  @ApiProperty({
    type: [PostListTranslationItemDto],
    description: 'All stored translations, slim shape — no `body`. Call the detail endpoint when full text is required.',
  })
  post_translations: PostListTranslationItemDto[];

  @ApiProperty({ type: PostListTranslationItemDto, nullable: true, description: 'Resolved (slim) translation for the requested language' })
  translation: PostListTranslationItemDto | null;

  @ApiProperty({ type: PostCategoryRefDto, description: 'Parent post category with all of its translations.' })
  post_categories: PostCategoryRefDto;

  @ApiPropertyOptional({ type: MediaRefDto, nullable: true, description: 'Cover image media record. Null when the post has no cover.' })
  media: MediaRefDto | null;

  @ApiPropertyOptional({
    type: [PostAttachmentDto],
    description: 'First attachment for list thumbnails (max 1 item). Full ordered list lives on the detail endpoint.',
  })
  post_attachments?: PostAttachmentDto[];
}

/**
 * Item shape returned in detail responses (`GET /posts/:id`,
 * `GET /posts/by-slug/:slug`, and the create / update / publish bodies).
 * Carries full translations (`body` included) and the complete attachment
 * list.
 */
class PostDetailDto {
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

  @ApiProperty({ type: [PostTranslationItemDto], description: 'All stored translations, full shape including `body`.' })
  post_translations: PostTranslationItemDto[];

  @ApiProperty({ type: PostTranslationItemDto, nullable: true, description: 'Resolved translation for the requested language' })
  translation: PostTranslationItemDto | null;

  @ApiProperty({ type: PostCategoryRefDto, description: 'Parent post category with all of its translations.' })
  post_categories: PostCategoryRefDto;

  @ApiPropertyOptional({ type: MediaRefDto, nullable: true, description: 'Cover image media record. Null when the post has no cover.' })
  media: MediaRefDto | null;

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

class BulkActionDataDto {
  @ApiProperty({ example: 8, description: 'Number of rows that actually changed' })
  affected: number;

  @ApiProperty({
    type: [String],
    format: 'uuid',
    example: [],
    description:
      'IDs that were not changed: not found, already soft-deleted, or already in the requested state',
  })
  skipped: string[];
}

export class PostBulkResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: '2026-05-11T12:00:00.000Z' })
  timestamp: string;

  @ApiProperty({ example: '8 post(s) published' })
  message: string;

  @ApiProperty({ type: BulkActionDataDto })
  data: BulkActionDataDto;
}
