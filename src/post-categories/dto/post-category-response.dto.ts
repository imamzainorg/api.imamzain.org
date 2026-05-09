import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationMetaDto } from '../../common/dto/api-response.dto';

class PostCategoryTranslationDto {
  @ApiProperty({ example: 'ar' })
  lang: string;

  @ApiProperty({ example: 'الفقه' })
  name: string;

  @ApiProperty({ example: true })
  is_default: boolean;
}

class PostCategoryDto {
  @ApiProperty({ example: 'uuid-...' })
  id: string;

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
  created_at: string;

  @ApiProperty({ type: [PostCategoryTranslationDto] })
  post_category_translations: PostCategoryTranslationDto[];

  @ApiPropertyOptional({
    type: PostCategoryTranslationDto,
    nullable: true,
    description:
      'Resolved translation for the requested Accept-Language header, with fallback to the first available translation. Null when the category has no translations.',
  })
  translation: PostCategoryTranslationDto | null;
}

class PostCategoryListDataDto {
  @ApiProperty({ type: [PostCategoryDto] })
  items: PostCategoryDto[];

  @ApiProperty({ type: PaginationMetaDto })
  pagination: PaginationMetaDto;
}

export class PostCategoryListResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
  timestamp: string;

  @ApiProperty({ example: 'Post categories fetched' })
  message: string;

  @ApiProperty({ type: PostCategoryListDataDto })
  data: PostCategoryListDataDto;
}

export class PostCategoryDetailResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
  timestamp: string;

  @ApiProperty({ example: 'Post category fetched' })
  message: string;

  @ApiProperty({ type: PostCategoryDto })
  data: PostCategoryDto;
}

export class PostCategoryCreatedResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
  timestamp: string;

  @ApiProperty({ example: 'Post category created' })
  message: string;

  @ApiProperty({ type: PostCategoryDto })
  data: PostCategoryDto;
}

export class PostCategoryMessageResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
  timestamp: string;

  @ApiProperty({ example: 'Post category deleted' })
  message: string;

  @ApiProperty({ type: Object, nullable: true, example: null })
  data: null;
}
