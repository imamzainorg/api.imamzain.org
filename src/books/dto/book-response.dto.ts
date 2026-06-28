import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ApiEnvelope, ApiPaginatedData } from '../../common/dto/api-envelope';

/**
 * Full book translation, returned on detail endpoints (`GET /books/:id`,
 * create / update responses). List endpoints (`GET /books`,
 * `GET /books/trash`) use the slimmer `BookListTranslationItemDto`
 * below — `description` is dropped to keep list payloads small.
 */
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

/** List-endpoint translation shape — drops `description` (typically the heaviest field). */
class BookListTranslationItemDto {
  @ApiProperty({ example: 'ar' })
  lang: string;

  @ApiProperty({ example: 'الصحيفة السجادية' })
  title: string;

  @ApiPropertyOptional({ example: 'الإمام علي بن الحسين' })
  author?: string;

  @ApiPropertyOptional({ example: 'دار الإسلام' })
  publisher?: string;

  @ApiPropertyOptional({ example: 'أدعية الأئمة' })
  series?: string;

  @ApiProperty({ example: true })
  is_default: boolean;
}

class BookCategoryTranslationRefDto {
  @ApiProperty({ example: 'ar' })
  lang: string;

  @ApiProperty({ example: 'الأدعية والزيارات' })
  title: string;

  @ApiProperty({ example: 'al-adiya' })
  slug: string;

  @ApiPropertyOptional({ example: 'كتب الأدعية والزيارات المأثورة', nullable: true })
  description: string | null;
}

class BookCategoryRefDto {
  @ApiProperty({ example: 'uuid-...' })
  id: string;

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
  created_at: string;

  @ApiProperty({ type: [BookCategoryTranslationRefDto], description: 'All translations of the parent category.' })
  book_category_translations: BookCategoryTranslationRefDto[];
}

class BookMediaRefDto {
  @ApiProperty({ example: 'uuid-...' })
  id: string;

  @ApiProperty({ example: 'https://cdn.imamzain.org/media/originals/uuid/cover.jpg' })
  url: string;

  @ApiProperty({ example: 'cover.jpg' })
  filename: string;

  @ApiPropertyOptional({ example: 'صورة الغلاف', nullable: true })
  alt_text: string | null;

  @ApiProperty({ example: 'image/jpeg' })
  mime_type: string;

  @ApiPropertyOptional({ example: 1200, nullable: true })
  width: number | null;

  @ApiPropertyOptional({ example: 1800, nullable: true })
  height: number | null;
}

/**
 * Detail-shape book — full translations including `description`.
 * Returned by `GET /books/:id`, create, update, and view-track responses.
 */
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

  @ApiProperty({ type: BookCategoryRefDto, description: 'Parent book category with all of its translations.' })
  book_categories: BookCategoryRefDto;

  @ApiProperty({ type: BookMediaRefDto, description: 'Cover image media record (every book has a cover).' })
  media: BookMediaRefDto;
}

/**
 * List-shape book — same scalar fields, but the embedded translations drop
 * `description` and the `media` ref is the slim public-facing subset.
 */
class BookListItemDto {
  @ApiProperty({ example: 'uuid-...' })
  id: string;

  @ApiProperty({ example: 'uuid-...' })
  category_id: string;

  @ApiProperty({ example: 'uuid-...' })
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

  @ApiProperty({
    type: [BookListTranslationItemDto],
    description: 'All stored translations, slim shape — no `description`. Call the detail endpoint when the full description is needed.',
  })
  book_translations: BookListTranslationItemDto[];

  @ApiProperty({ type: BookListTranslationItemDto, nullable: true })
  translation: BookListTranslationItemDto | null;

  @ApiProperty({ type: BookCategoryRefDto })
  book_categories: BookCategoryRefDto;

  @ApiProperty({ type: BookMediaRefDto })
  media: BookMediaRefDto;
}

class BookListDataDto extends ApiPaginatedData(BookListItemDto) {}

export class BookListResponseDto extends ApiEnvelope(BookListDataDto, 'Books fetched') {}

export class BookDetailResponseDto extends ApiEnvelope(BookDto, 'Book fetched') {}

export class BookCreatedResponseDto extends ApiEnvelope(BookDto, 'Book created') {}

export class BookMessageResponseDto extends ApiEnvelope(null, 'Book deleted') {}
