import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ApiEnvelope, ApiPaginatedData } from '../../common/dto/api-envelope';

/**
 * Full gallery-image translation, returned on detail endpoints. List
 * endpoints (`GET /gallery`, `/gallery/trash`) use the slim
 * `GalleryImageListTranslationItemDto` below — `description` is dropped.
 */
class GalleryImageTranslationItemDto {
  @ApiProperty({ example: 'ar' })
  lang: string;

  @ApiProperty({ example: 'صورة من المعرض' })
  title: string;

  @ApiPropertyOptional({ example: 'وصف الصورة' })
  description?: string;

  @ApiPropertyOptional({ description: 'SEO <title> override for this translation.' })
  meta_title?: string;

  @ApiPropertyOptional({ description: 'SEO meta description for this translation.' })
  meta_description?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Media id used as the OpenGraph image for this translation.' })
  og_image_id?: string;
}

/** List-endpoint translation shape — description dropped, SEO fields kept. */
class GalleryImageListTranslationItemDto {
  @ApiProperty({ example: 'ar' })
  lang: string;

  @ApiProperty({ example: 'صورة من المعرض' })
  title: string;

  @ApiPropertyOptional({ description: 'SEO <title> override for this translation.' })
  meta_title?: string;

  @ApiPropertyOptional({ description: 'SEO meta description for this translation.' })
  meta_description?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Media id used as the OpenGraph image for this translation.' })
  og_image_id?: string;
}

/** One pre-generated WebP rendition, ordered by width — feed these to `srcset`. */
class GalleryMediaVariantDto {
  @ApiProperty({ example: 'uuid-...' })
  id: string;

  @ApiProperty({ example: 768, description: 'Output width in pixels' })
  width: number;

  @ApiProperty({ example: 'https://cdn.imamzain.org/media/variants/uuid/w768.webp' })
  url: string;

  @ApiProperty({ example: 'webp' })
  format: string;
}

/**
 * Public shape of the embedded media: `file_size`, `created_at` and
 * `uploaded_by` are not part of it. The admin reads (`GET /gallery/admin`,
 * `/gallery/admin/:id` and the create / update / publish responses) return the
 * full media record on top of this.
 */
class GalleryMediaDto {
  @ApiProperty({ example: 'uuid-...' })
  id: string;

  @ApiProperty({ example: 'https://cdn.example.com/image.jpg' })
  url: string;

  @ApiProperty({ example: 'image.jpg' })
  filename: string;

  @ApiPropertyOptional({ example: 'صورة من المعرض', nullable: true })
  alt_text?: string | null;

  @ApiProperty({ example: 'image/jpeg' })
  mime_type: string;

  @ApiPropertyOptional({ example: 1920 })
  width?: number;

  @ApiPropertyOptional({ example: 1080 })
  height?: number;

  @ApiProperty({
    type: [GalleryMediaVariantDto],
    description: 'WebP variants ordered by width ascending; may be shorter than the standard four (small originals skip up-scaled widths) or empty.',
  })
  media_variants: GalleryMediaVariantDto[];
}

class GalleryCategoryTranslationRefDto {
  @ApiProperty({ example: 'ar' })
  lang: string;

  @ApiProperty({ example: 'صور المراقد' })
  title: string;

  @ApiProperty({ example: 'suwar-al-maraqi' })
  slug: string;

  @ApiPropertyOptional({ example: 'صور المراقد المقدسة', nullable: true })
  description: string | null;
}

class GalleryCategoryRefDto {
  @ApiProperty({ example: 'uuid-...' })
  id: string;

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
  created_at: string;

  @ApiProperty({ type: [GalleryCategoryTranslationRefDto], description: 'All translations of the parent category.' })
  gallery_category_translations: GalleryCategoryTranslationRefDto[];
}

class GalleryImageDto {
  @ApiProperty({ example: 'uuid-...' })
  media_id: string;

  @ApiPropertyOptional({ example: 'uuid-...', description: 'ID of the gallery category' })
  category_id?: string;

  @ApiPropertyOptional({ example: '2024-01-01T00:00:00.000Z' })
  taken_at?: string;

  @ApiPropertyOptional({ example: 'Ahmad Al-Hassan' })
  author?: string;

  @ApiProperty({ type: [String], example: ['كربلاء', 'زيارة'] })
  tags: string[];

  @ApiProperty({ type: [String], example: ['العراق', 'كربلاء المقدسة'] })
  locations: string[];

  @ApiProperty({ example: 0 })
  views: number;

  @ApiProperty({ example: true })
  is_published: boolean;

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
  created_at: string;

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
  updated_at: string;

  @ApiPropertyOptional({ format: 'uuid', nullable: true, description: 'Staff user who added the image. Admin responses only — the public detail route omits it.' })
  added_by?: string | null;

  @ApiProperty({ type: GalleryMediaDto })
  media: GalleryMediaDto;

  @ApiProperty({ type: [GalleryImageTranslationItemDto], description: 'All stored translations' })
  gallery_image_translations: GalleryImageTranslationItemDto[];

  @ApiProperty({ type: GalleryImageTranslationItemDto, nullable: true, description: 'Resolved translation for the requested language' })
  translation: GalleryImageTranslationItemDto | null;

  @ApiPropertyOptional({ type: GalleryCategoryRefDto, nullable: true, description: 'Parent gallery category. Null when the image is uncategorised.' })
  gallery_categories: GalleryCategoryRefDto | null;
}

/**
 * List-shape gallery image — translations drop `description`.
 */
class GalleryImageListItemDto {
  @ApiProperty({ example: 'uuid-...' })
  media_id: string;

  @ApiPropertyOptional({ example: 'uuid-...' })
  category_id?: string;

  @ApiPropertyOptional({ example: '2024-01-01T00:00:00.000Z' })
  taken_at?: string;

  @ApiPropertyOptional({ example: 'Ahmad Al-Hassan' })
  author?: string;

  @ApiProperty({ type: [String], example: ['كربلاء', 'زيارة'] })
  tags: string[];

  @ApiProperty({ type: [String], example: ['العراق', 'كربلاء المقدسة'] })
  locations: string[];

  @ApiProperty({ example: 0 })
  views: number;

  @ApiProperty({ example: true })
  is_published: boolean;

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
  created_at: string;

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
  updated_at: string;

  @ApiProperty({ type: GalleryMediaDto })
  media: GalleryMediaDto;

  @ApiProperty({
    type: [GalleryImageListTranslationItemDto],
    description: 'All stored translations, slim shape — no `description`. Call the detail endpoint when the full description is needed.',
  })
  gallery_image_translations: GalleryImageListTranslationItemDto[];

  @ApiProperty({ type: GalleryImageListTranslationItemDto, nullable: true })
  translation: GalleryImageListTranslationItemDto | null;

  @ApiPropertyOptional({ type: GalleryCategoryRefDto, nullable: true })
  gallery_categories: GalleryCategoryRefDto | null;
}

class GalleryListDataDto extends ApiPaginatedData(GalleryImageListItemDto) {}

export class GalleryListResponseDto extends ApiEnvelope(GalleryListDataDto, 'Gallery images fetched') {}

export class GalleryDetailResponseDto extends ApiEnvelope(GalleryImageDto, 'Gallery image fetched') {}

export class GalleryCreatedResponseDto extends ApiEnvelope(GalleryImageDto, 'Gallery image created') {}

export class GalleryMessageResponseDto extends ApiEnvelope(null, 'Gallery image deleted') {}
