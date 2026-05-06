import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationMetaDto } from '../../common/dto/api-response.dto';

class GalleryCategoryTranslationItemDto {
  @ApiProperty({ example: 'ar' })
  lang: string;

  @ApiProperty({ example: 'الفعاليات' })
  name: string;

  @ApiProperty({ example: true })
  is_default: boolean;
}

class GalleryCategoryDto {
  @ApiProperty({ example: 'uuid-...' })
  id: string;

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
  created_at: string;

  @ApiProperty({ type: [GalleryCategoryTranslationItemDto] })
  gallery_category_translations: GalleryCategoryTranslationItemDto[];
}

class GalleryCategoryListDataDto {
  @ApiProperty({ type: [GalleryCategoryDto] })
  items: GalleryCategoryDto[];

  @ApiProperty({ type: PaginationMetaDto })
  pagination: PaginationMetaDto;
}

export class GalleryCategoryListResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
  timestamp: string;

  @ApiProperty({ example: 'Gallery categories fetched' })
  message: string;

  @ApiProperty({ type: GalleryCategoryListDataDto })
  data: GalleryCategoryListDataDto;
}

export class GalleryCategoryDetailResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
  timestamp: string;

  @ApiProperty({ example: 'Gallery category fetched' })
  message: string;

  @ApiProperty({ type: GalleryCategoryDto })
  data: GalleryCategoryDto;
}

export class GalleryCategoryCreatedResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
  timestamp: string;

  @ApiProperty({ example: 'Gallery category created' })
  message: string;

  @ApiProperty({ type: GalleryCategoryDto })
  data: GalleryCategoryDto;
}

export class GalleryCategoryMessageResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
  timestamp: string;

  @ApiProperty({ example: 'Gallery category deleted' })
  message: string;

  @ApiProperty({ type: Object, nullable: true, example: null })
  data: null;
}
