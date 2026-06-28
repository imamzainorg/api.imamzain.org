import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ApiEnvelope, ApiPaginatedData } from '../../common/dto/api-envelope';

class PostCategoryTranslationDto {
  @ApiProperty({ example: 'ar' })
  lang: string;

  @ApiProperty({ example: 'الأخبار والمستجدات' })
  title: string;

  @ApiProperty({ example: 'al-akhbar' })
  slug: string;

  @ApiPropertyOptional({ example: 'آخر الأخبار المتعلقة بالموقع', nullable: true })
  description: string | null;
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

class PostCategoryListDataDto extends ApiPaginatedData(PostCategoryDto) {}

export class PostCategoryListResponseDto extends ApiEnvelope(
  PostCategoryListDataDto,
  'Post categories fetched',
) {}

export class PostCategoryDetailResponseDto extends ApiEnvelope(
  PostCategoryDto,
  'Post category fetched',
) {}

export class PostCategoryCreatedResponseDto extends ApiEnvelope(
  PostCategoryDto,
  'Post category created',
) {}

export class PostCategoryMessageResponseDto extends ApiEnvelope(
  null,
  'Post category deleted',
) {}
