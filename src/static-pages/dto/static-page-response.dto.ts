import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ApiEnvelope, ApiPaginatedData } from '../../common/dto/api-envelope';

class StaticPageTranslationDto {
  @ApiProperty({ example: 'ar' })
  lang: string;

  @ApiProperty({ example: 'سيرة الإمام زين العابدين' })
  title: string;

  @ApiProperty({ example: 'imam-zain-biography' })
  slug: string;

  @ApiProperty({ example: '<p>...rich HTML body...</p>' })
  body: string;

  @ApiProperty({ example: false })
  is_default: boolean;
}

class StaticPageDto {
  @ApiProperty({ example: 'uuid-...' })
  id: string;

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

class StaticPageListDataDto extends ApiPaginatedData(StaticPageDto) {}

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
