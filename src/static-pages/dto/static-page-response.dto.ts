import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ApiEnvelope, ApiPaginatedData } from '../../common/dto/api-envelope';

class StaticPageOgImageDto {
  @ApiProperty({ example: 'uuid-...' })
  id: string;

  @ApiProperty({ example: 'https://cdn.imamzain.org/media/originals/uuid/cover.jpg' })
  url: string;

  @ApiProperty({ example: 'cover.jpg' })
  filename: string;

  @ApiPropertyOptional({ nullable: true })
  alt_text: string | null;

  @ApiProperty({ example: 'image/jpeg' })
  mime_type: string;

  @ApiPropertyOptional({ nullable: true })
  width: number | null;

  @ApiPropertyOptional({ nullable: true })
  height: number | null;
}

/** Full translation row, returned by the detail routes and the admin list / trash. */
class StaticPageTranslationDto {
  @ApiProperty({ example: 'ar' })
  lang: string;

  @ApiProperty({ example: 'سيرة الإمام زين العابدين' })
  title: string;

  @ApiProperty({ example: '<p>...rich HTML body...</p>' })
  body: string;

  @ApiProperty({ example: false })
  is_default: boolean;

  @ApiPropertyOptional({ nullable: true, description: 'SEO <title> override.' })
  meta_title?: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'SEO meta description.' })
  meta_description?: string | null;

  @ApiPropertyOptional({ format: 'uuid', nullable: true, description: 'Media id of the OpenGraph image.' })
  og_image_id?: string | null;

  @ApiPropertyOptional({
    type: StaticPageOgImageDto,
    nullable: true,
    description: 'The resolved OpenGraph image (detail routes only; slim columns — never the whole media row).',
  })
  og_image?: StaticPageOgImageDto | null;
}

/**
 * Translation shape of the PUBLIC list (`GET /static-pages`): the same row
 * without `body` (and without the resolved `og_image`), so the list stays a
 * lightweight directory. Fetch the detail for the HTML.
 */
class StaticPageListTranslationDto {
  @ApiProperty({ example: 'ar' })
  lang: string;

  @ApiProperty({ example: 'سيرة الإمام زين العابدين' })
  title: string;

  @ApiProperty({ example: false })
  is_default: boolean;

  @ApiPropertyOptional({ nullable: true, description: 'SEO <title> override.' })
  meta_title?: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'SEO meta description.' })
  meta_description?: string | null;

  @ApiPropertyOptional({ format: 'uuid', nullable: true, description: 'Media id of the OpenGraph image.' })
  og_image_id?: string | null;
}

class StaticPageDto {
  @ApiProperty({ example: 'uuid-...' })
  id: string;

  @ApiProperty({ example: 'imam-zain-biography', description: 'Canonical, language-agnostic URL slug.' })
  slug: string;

  @ApiProperty({ example: 0 })
  display_order: number;

  @ApiProperty({ example: true })
  is_published: boolean;

  @ApiProperty({ example: '2026-01-01T00:00:00.000Z' })
  created_at: string;

  @ApiProperty({ example: '2026-01-01T00:00:00.000Z' })
  updated_at: string;

  @ApiProperty({ type: [StaticPageTranslationDto] })
  static_page_translations: StaticPageTranslationDto[];

  @ApiPropertyOptional({
    type: StaticPageTranslationDto,
    nullable: true,
    description:
      'Resolved translation for the requested Accept-Language header, with fallback to the default translation. Null when the page has no translations.',
  })
  translation: StaticPageTranslationDto | null;
}

/**
 * Item shape of the PUBLIC list. Carries only the requested / fallback
 * translation, without its body: there is no `static_page_translations` array
 * here — read `translation`, and call the detail route for the body or for
 * the other languages.
 */
class StaticPagePublicListItemDto {
  @ApiProperty({ example: 'uuid-...' })
  id: string;

  @ApiProperty({ example: 'imam-zain-biography', description: 'Canonical, language-agnostic URL slug.' })
  slug: string;

  @ApiProperty({ example: 0 })
  display_order: number;

  @ApiProperty({ example: true })
  is_published: boolean;

  @ApiProperty({ example: '2026-01-01T00:00:00.000Z' })
  created_at: string;

  @ApiProperty({ example: '2026-01-01T00:00:00.000Z' })
  updated_at: string;

  @ApiProperty({
    type: StaticPageListTranslationDto,
    nullable: true,
    description:
      'Resolved translation for the requested Accept-Language header, with fallback to the default translation, WITHOUT the body. Null when the page has no translations.',
  })
  translation: StaticPageListTranslationDto | null;
}

class StaticPagePublicListDataDto extends ApiPaginatedData(StaticPagePublicListItemDto) {}

class StaticPageListDataDto extends ApiPaginatedData(StaticPageDto) {}

/** `GET /static-pages` (public): body-less, single-translation items. */
export class StaticPagePublicListResponseDto extends ApiEnvelope(
  StaticPagePublicListDataDto,
  'Static pages fetched',
) {}

/** `GET /static-pages/admin` and `/trash`: full items with every translation and its body. */
export class StaticPageListResponseDto extends ApiEnvelope(
  StaticPageListDataDto,
  'Static pages fetched',
) {}

export class StaticPageDetailResponseDto extends ApiEnvelope(
  StaticPageDto,
  'Static page fetched',
) {}

export class StaticPageCreatedResponseDto extends ApiEnvelope(
  StaticPageDto,
  'Static page created',
) {}

export class StaticPageMessageResponseDto extends ApiEnvelope(
  null,
  'Static page deleted',
) {}
