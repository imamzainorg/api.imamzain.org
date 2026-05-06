import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationMetaDto } from '../../common/dto/api-response.dto';

class GalleryImageTranslationItemDto {
  @ApiProperty({ example: 'ar' })
  lang: string;

  @ApiProperty({ example: 'صورة من المعرض' })
  title: string;

  @ApiPropertyOptional({ example: 'وصف الصورة' })
  description?: string;
}

class GalleryMediaDto {
  @ApiProperty({ example: 'uuid-...' })
  id: string;

  @ApiProperty({ example: 'https://cdn.example.com/image.jpg' })
  url: string;

  @ApiProperty({ example: 'image/jpeg' })
  mime_type: string;

  @ApiPropertyOptional({ example: 1920 })
  width?: number;

  @ApiPropertyOptional({ example: 1080 })
  height?: number;
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

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
  created_at: string;

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
  updated_at: string;

  @ApiProperty({ type: GalleryMediaDto })
  media: GalleryMediaDto;

  @ApiProperty({ type: [GalleryImageTranslationItemDto], description: 'All stored translations' })
  gallery_image_translations: GalleryImageTranslationItemDto[];

  @ApiProperty({ type: GalleryImageTranslationItemDto, nullable: true, description: 'Resolved translation for the requested language' })
  translation: GalleryImageTranslationItemDto | null;
}

class GalleryListDataDto {
  @ApiProperty({ type: [GalleryImageDto] })
  items: GalleryImageDto[];

  @ApiProperty({ type: PaginationMetaDto })
  pagination: PaginationMetaDto;
}

export class GalleryListResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
  timestamp: string;

  @ApiProperty({ example: 'Gallery images fetched' })
  message: string;

  @ApiProperty({ type: GalleryListDataDto })
  data: GalleryListDataDto;
}

export class GalleryDetailResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
  timestamp: string;

  @ApiProperty({ example: 'Gallery image fetched' })
  message: string;

  @ApiProperty({ type: GalleryImageDto })
  data: GalleryImageDto;
}

export class GalleryCreatedResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
  timestamp: string;

  @ApiProperty({ example: 'Gallery image created' })
  message: string;

  @ApiProperty({ type: GalleryImageDto })
  data: GalleryImageDto;
}

export class GalleryMessageResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
  timestamp: string;

  @ApiProperty({ example: 'Gallery image deleted' })
  message: string;

  @ApiProperty({ type: Object, nullable: true, example: null })
  data: null;
}
