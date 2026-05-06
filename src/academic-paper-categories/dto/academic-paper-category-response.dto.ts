import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationMetaDto } from '../../common/dto/api-response.dto';

class AcademicPaperCategoryTranslationItemDto {
  @ApiProperty({ example: 'ar' })
  lang: string;

  @ApiProperty({ example: 'الفقه المقارن' })
  name: string;

  @ApiProperty({ example: true })
  is_default: boolean;
}

class AcademicPaperCategoryDto {
  @ApiProperty({ example: 'uuid-...' })
  id: string;

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
  created_at: string;

  @ApiProperty({ type: [AcademicPaperCategoryTranslationItemDto] })
  academic_paper_category_translations: AcademicPaperCategoryTranslationItemDto[];
}

class AcademicPaperCategoryListDataDto {
  @ApiProperty({ type: [AcademicPaperCategoryDto] })
  items: AcademicPaperCategoryDto[];

  @ApiProperty({ type: PaginationMetaDto })
  pagination: PaginationMetaDto;
}

export class AcademicPaperCategoryListResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
  timestamp: string;

  @ApiProperty({ example: 'Academic paper categories fetched' })
  message: string;

  @ApiProperty({ type: AcademicPaperCategoryListDataDto })
  data: AcademicPaperCategoryListDataDto;
}

export class AcademicPaperCategoryDetailResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
  timestamp: string;

  @ApiProperty({ example: 'Academic paper category fetched' })
  message: string;

  @ApiProperty({ type: AcademicPaperCategoryDto })
  data: AcademicPaperCategoryDto;
}

export class AcademicPaperCategoryCreatedResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
  timestamp: string;

  @ApiProperty({ example: 'Academic paper category created' })
  message: string;

  @ApiProperty({ type: AcademicPaperCategoryDto })
  data: AcademicPaperCategoryDto;
}

export class AcademicPaperCategoryMessageResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
  timestamp: string;

  @ApiProperty({ example: 'Academic paper category deleted' })
  message: string;

  @ApiProperty({ type: Object, nullable: true, example: null })
  data: null;
}
