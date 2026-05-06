import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationMetaDto } from '../../common/dto/api-response.dto';

class BookTranslationItemDto {
  @ApiProperty({ example: 'ar' })
  lang: string;

  @ApiProperty({ example: 'الصحيفة السجادية' })
  title: string;

  @ApiPropertyOptional({ example: 'الإمام علي بن الحسين' })
  author?: string;

  @ApiPropertyOptional({ example: 'دار الإسلام' })
  publisher?: string;

  @ApiPropertyOptional({ example: 'مجموعة أدعية مأثورة عن الإمام زين العابدين' })
  description?: string;

  @ApiPropertyOptional({ example: 'أدعية الأئمة' })
  series?: string;

  @ApiProperty({ example: true })
  is_default: boolean;
}

class BookDto {
  @ApiProperty({ example: 'uuid-...' })
  id: string;

  @ApiProperty({ example: 'uuid-...', description: 'ID of the book category' })
  category_id: string;

  @ApiProperty({ example: 'uuid-...', description: 'ID of the cover image media record' })
  cover_image_id: string;

  @ApiPropertyOptional({ example: '978-9953-0-2287-6' })
  isbn?: string;

  @ApiPropertyOptional({ example: 320 })
  pages?: number;

  @ApiPropertyOptional({ example: '2010' })
  publish_year?: string;

  @ApiPropertyOptional({ example: 1 })
  part_number?: number;

  @ApiPropertyOptional({ example: 3 })
  parts?: number;

  @ApiProperty({ example: 0 })
  views: number;

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
  created_at: string;

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
  updated_at: string;

  @ApiProperty({ type: [BookTranslationItemDto], description: 'All stored translations' })
  book_translations: BookTranslationItemDto[];

  @ApiProperty({ type: BookTranslationItemDto, nullable: true, description: 'Resolved translation for the requested language' })
  translation: BookTranslationItemDto | null;
}

class BookListDataDto {
  @ApiProperty({ type: [BookDto] })
  items: BookDto[];

  @ApiProperty({ type: PaginationMetaDto })
  pagination: PaginationMetaDto;
}

export class BookListResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
  timestamp: string;

  @ApiProperty({ example: 'Books fetched' })
  message: string;

  @ApiProperty({ type: BookListDataDto })
  data: BookListDataDto;
}

export class BookDetailResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
  timestamp: string;

  @ApiProperty({ example: 'Book fetched' })
  message: string;

  @ApiProperty({ type: BookDto })
  data: BookDto;
}

export class BookCreatedResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
  timestamp: string;

  @ApiProperty({ example: 'Book created' })
  message: string;

  @ApiProperty({ type: BookDto })
  data: BookDto;
}

export class BookMessageResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
  timestamp: string;

  @ApiProperty({ example: 'Book deleted' })
  message: string;

  @ApiProperty({ type: Object, nullable: true, example: null })
  data: null;
}
