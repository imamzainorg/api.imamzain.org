import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ApiEnvelope, ApiPaginatedData } from '../../common/dto/api-envelope';

class GalleryCategoryTranslationItemDto {
  @ApiProperty({ example: 'ar' })
  lang: string;

  @ApiProperty({ example: 'صور المراقد' })
  title: string;

  @ApiProperty({ example: 'suwar-al-maraqi' })
  slug: string;

  @ApiPropertyOptional({ example: 'صور المراقد المقدسة', nullable: true })
  description: string | null;
}

class GalleryCategoryDto {
  @ApiProperty({ example: 'uuid-...' })
  id: string;

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
  created_at: string;

  @ApiProperty({ type: [GalleryCategoryTranslationItemDto] })
  gallery_category_translations: GalleryCategoryTranslationItemDto[];

  @ApiPropertyOptional({
    type: GalleryCategoryTranslationItemDto,
    nullable: true,
    description:
      'Resolved translation for the requested Accept-Language header, with fallback to the first available translation. Null when the category has no translations.',
  })
  translation: GalleryCategoryTranslationItemDto | null;
}

class GalleryCategoryListDataDto extends ApiPaginatedData(GalleryCategoryDto) {}

export class GalleryCategoryListResponseDto extends ApiEnvelope(
  GalleryCategoryListDataDto,
  'Gallery categories fetched',
) {}

export class GalleryCategoryDetailResponseDto extends ApiEnvelope(
  GalleryCategoryDto,
  'Gallery category fetched',
) {}

export class GalleryCategoryCreatedResponseDto extends ApiEnvelope(
  GalleryCategoryDto,
  'Gallery category created',
) {}

export class GalleryCategoryMessageResponseDto extends ApiEnvelope(
  null,
  'Gallery category deleted',
) {}
