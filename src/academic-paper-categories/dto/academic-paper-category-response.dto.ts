import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ApiEnvelope, ApiPaginatedData } from '../../common/dto/api-envelope';

class AcademicPaperCategoryTranslationItemDto {
  @ApiProperty({ example: 'ar' })
  lang: string;

  @ApiProperty({ example: 'الفقه والأحكام' })
  title: string;

  @ApiProperty({ example: 'al-fiqh' })
  slug: string;

  @ApiPropertyOptional({ example: 'أبحاث في الفقه الإسلامي', nullable: true })
  description: string | null;
}

class AcademicPaperCategoryDto {
  @ApiProperty({ example: 'uuid-...' })
  id: string;

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
  created_at: string;

  @ApiProperty({ type: [AcademicPaperCategoryTranslationItemDto] })
  academic_paper_category_translations: AcademicPaperCategoryTranslationItemDto[];

  @ApiPropertyOptional({
    type: AcademicPaperCategoryTranslationItemDto,
    nullable: true,
    description:
      'Resolved translation for the requested Accept-Language header, with fallback to the first available translation. Null when the category has no translations.',
  })
  translation: AcademicPaperCategoryTranslationItemDto | null;
}

class AcademicPaperCategoryListDataDto extends ApiPaginatedData(
  AcademicPaperCategoryDto,
) {}

export class AcademicPaperCategoryListResponseDto extends ApiEnvelope(
  AcademicPaperCategoryListDataDto,
  'Academic paper categories fetched',
) {}

export class AcademicPaperCategoryDetailResponseDto extends ApiEnvelope(
  AcademicPaperCategoryDto,
  'Academic paper category fetched',
) {}

export class AcademicPaperCategoryCreatedResponseDto extends ApiEnvelope(
  AcademicPaperCategoryDto,
  'Academic paper category created',
) {}

export class AcademicPaperCategoryMessageResponseDto extends ApiEnvelope(
  null,
  'Academic paper category deleted',
) {}
