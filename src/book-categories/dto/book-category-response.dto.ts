import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ApiEnvelope, ApiPaginatedData } from '../../common/dto/api-envelope';

class BookCategoryTranslationItemDto {
  @ApiProperty({ example: 'ar' })
  lang: string;

  @ApiProperty({ example: 'الأدعية والزيارات' })
  title: string;

  @ApiProperty({ example: 'al-adiya' })
  slug: string;

  @ApiPropertyOptional({ example: 'كتب الأدعية والزيارات المأثورة', nullable: true })
  description: string | null;
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

class BookCategoryListDataDto extends ApiPaginatedData(BookCategoryDto) {}

export class BookCategoryListResponseDto extends ApiEnvelope(BookCategoryListDataDto, 'Book categories fetched') {}

export class BookCategoryDetailResponseDto extends ApiEnvelope(BookCategoryDto, 'Book category fetched') {}

export class BookCategoryCreatedResponseDto extends ApiEnvelope(BookCategoryDto, 'Book category created') {}

export class BookCategoryMessageResponseDto extends ApiEnvelope(null, 'Book category deleted') {}
