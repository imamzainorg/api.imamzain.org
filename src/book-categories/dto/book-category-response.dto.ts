import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationMetaDto } from '../../common/dto/api-response.dto';

class BookCategoryTranslationItemDto {
  @ApiProperty({ example: 'ar' })
  lang: string;

  @ApiProperty({ example: 'الفقه' })
  name: string;

  @ApiProperty({ example: true })
  is_default: boolean;
}

class BookCategoryDto {
  @ApiProperty({ example: 'uuid-...' })
  id: string;

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
  created_at: string;

  @ApiProperty({ type: [BookCategoryTranslationItemDto] })
  book_category_translations: BookCategoryTranslationItemDto[];

  @ApiPropertyOptional({
    type: BookCategoryTranslationItemDto,
    nullable: true,
    description:
      'Resolved translation for the requested Accept-Language header, with fallback to the first available translation. Null when the category has no translations.',
  })
  translation: BookCategoryTranslationItemDto | null;
}

class BookCategoryListDataDto {
  @ApiProperty({ type: [BookCategoryDto] })
  items: BookCategoryDto[];

  @ApiProperty({ type: PaginationMetaDto })
  pagination: PaginationMetaDto;
}

export class BookCategoryListResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
  timestamp: string;

  @ApiProperty({ example: 'Book categories fetched' })
  message: string;

  @ApiProperty({ type: BookCategoryListDataDto })
  data: BookCategoryListDataDto;
}

export class BookCategoryDetailResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
  timestamp: string;

  @ApiProperty({ example: 'Book category fetched' })
  message: string;

  @ApiProperty({ type: BookCategoryDto })
  data: BookCategoryDto;
}

export class BookCategoryCreatedResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
  timestamp: string;

  @ApiProperty({ example: 'Book category created' })
  message: string;

  @ApiProperty({ type: BookCategoryDto })
  data: BookCategoryDto;
}

export class BookCategoryMessageResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
  timestamp: string;

  @ApiProperty({ example: 'Book category deleted' })
  message: string;

  @ApiProperty({ type: Object, nullable: true, example: null })
  data: null;
}
