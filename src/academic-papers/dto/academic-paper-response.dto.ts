import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationMetaDto } from '../../common/dto/api-response.dto';

class AcademicPaperTranslationItemDto {
  @ApiProperty({ example: 'ar' })
  lang: string;

  @ApiProperty({ example: 'بحث في الفقه الإسلامي' })
  title: string;

  @ApiPropertyOptional({ example: 'ملخص البحث' })
  abstract?: string;

  @ApiPropertyOptional({ type: [String], example: ['د. محمد العراقي', 'أ. علي الكاظمي'] })
  authors?: string[];

  @ApiPropertyOptional({ type: [String], example: ['فقه', 'أدعية', 'الإمام السجاد'] })
  keywords?: string[];

  @ApiPropertyOptional({ example: 'مجلة الدراسات الإسلامية' })
  publication_venue?: string;

  @ApiPropertyOptional({ example: 24 })
  page_count?: number;

  @ApiProperty({ example: true })
  is_default: boolean;
}

class AcademicPaperDto {
  @ApiProperty({ example: 'uuid-...' })
  id: string;

  @ApiProperty({ example: 'uuid-...', description: 'ID of the academic paper category' })
  category_id: string;

  @ApiPropertyOptional({ example: '2024' })
  published_year?: string;

  @ApiPropertyOptional({ example: 'https://cdn.imamzain.org/papers/paper.pdf' })
  pdf_url?: string;

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
  created_at: string;

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
  updated_at: string;

  @ApiProperty({ type: [AcademicPaperTranslationItemDto], description: 'All stored translations' })
  academic_paper_translations: AcademicPaperTranslationItemDto[];

  @ApiProperty({ type: AcademicPaperTranslationItemDto, nullable: true, description: 'Resolved translation for the requested language' })
  translation: AcademicPaperTranslationItemDto | null;
}

class AcademicPaperListDataDto {
  @ApiProperty({ type: [AcademicPaperDto] })
  items: AcademicPaperDto[];

  @ApiProperty({ type: PaginationMetaDto })
  pagination: PaginationMetaDto;
}

export class AcademicPaperListResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
  timestamp: string;

  @ApiProperty({ example: 'Academic papers fetched' })
  message: string;

  @ApiProperty({ type: AcademicPaperListDataDto })
  data: AcademicPaperListDataDto;
}

export class AcademicPaperDetailResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
  timestamp: string;

  @ApiProperty({ example: 'Academic paper fetched' })
  message: string;

  @ApiProperty({ type: AcademicPaperDto })
  data: AcademicPaperDto;
}

export class AcademicPaperCreatedResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
  timestamp: string;

  @ApiProperty({ example: 'Academic paper created' })
  message: string;

  @ApiProperty({ type: AcademicPaperDto })
  data: AcademicPaperDto;
}

export class AcademicPaperMessageResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
  timestamp: string;

  @ApiProperty({ example: 'Academic paper deleted' })
  message: string;

  @ApiProperty({ type: Object, nullable: true, example: null })
  data: null;
}
