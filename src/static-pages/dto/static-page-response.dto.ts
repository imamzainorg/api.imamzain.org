import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationMetaDto } from '../../common/dto/api-response.dto';

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

class StaticPageListDataDto {
  @ApiProperty({ type: [StaticPageDto] })
  items: StaticPageDto[];

  @ApiProperty({ type: PaginationMetaDto })
  pagination: PaginationMetaDto;
}

export class StaticPageListResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: '2026-01-01T00:00:00.000Z' })
  timestamp: string;

  @ApiProperty({ example: 'Static pages fetched' })
  message: string;

  @ApiProperty({ type: StaticPageListDataDto })
  data: StaticPageListDataDto;
}

export class StaticPageDetailResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: '2026-01-01T00:00:00.000Z' })
  timestamp: string;

  @ApiProperty({ example: 'Static page fetched' })
  message: string;

  @ApiProperty({ type: StaticPageDto })
  data: StaticPageDto;
}

export class StaticPageCreatedResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: '2026-01-01T00:00:00.000Z' })
  timestamp: string;

  @ApiProperty({ example: 'Static page created' })
  message: string;

  @ApiProperty({ type: StaticPageDto })
  data: StaticPageDto;
}

export class StaticPageMessageResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: '2026-01-01T00:00:00.000Z' })
  timestamp: string;

  @ApiProperty({ example: 'Static page deleted' })
  message: string;

  @ApiProperty({ type: Object, nullable: true, example: null })
  data: null;
}
