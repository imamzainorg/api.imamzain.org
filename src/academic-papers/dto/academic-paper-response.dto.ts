import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationMetaDto } from '../../common/dto/api-response.dto';

/**
 * Full academic-paper translation, returned on detail endpoints. List
 * endpoints (`GET /academic-papers`, `/academic-papers/trash`) use the
 * slimmer `AcademicPaperListTranslationItemDto` below — `abstract` is
 * dropped to keep list payloads small.
 */
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

/** List-endpoint translation shape — drops `abstract` (typically the heaviest field). */
class AcademicPaperListTranslationItemDto {
  @ApiProperty({ example: 'ar' })
  lang: string;

  @ApiProperty({ example: 'بحث في الفقه الإسلامي' })
  title: string;

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

class AcademicPaperCategoryTranslationRefDto {
  @ApiProperty({ example: 'ar' })
  lang: string;

  @ApiProperty({ example: 'الفقه والأحكام' })
  title: string;

  @ApiProperty({ example: 'al-fiqh' })
  slug: string;

  @ApiPropertyOptional({ example: 'أبحاث في الفقه الإسلامي', nullable: true })
  description: string | null;
}

class AcademicPaperCategoryRefDto {
  @ApiProperty({ example: 'uuid-...' })
  id: string;

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
  created_at: string;

  @ApiProperty({ type: [AcademicPaperCategoryTranslationRefDto], description: 'All translations of the parent category.' })
  academic_paper_category_translations: AcademicPaperCategoryTranslationRefDto[];
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

  @ApiProperty({ type: AcademicPaperCategoryRefDto, description: 'Parent academic paper category with all of its translations.' })
  academic_paper_categories: AcademicPaperCategoryRefDto;
}

/**
 * List-shape academic paper — translations drop `abstract`.
 */
class AcademicPaperListItemDto {
  @ApiProperty({ example: 'uuid-...' })
  id: string;

  @ApiProperty({ example: 'uuid-...' })
  category_id: string;

  @ApiPropertyOptional({ example: '2024' })
  published_year?: string;

  @ApiPropertyOptional({ example: 'https://cdn.imamzain.org/papers/paper.pdf' })
  pdf_url?: string;

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
  created_at: string;

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
  updated_at: string;

  @ApiProperty({
    type: [AcademicPaperListTranslationItemDto],
    description: 'All stored translations, slim shape — no `abstract`. Call the detail endpoint when the full abstract is needed.',
  })
  academic_paper_translations: AcademicPaperListTranslationItemDto[];

  @ApiProperty({ type: AcademicPaperListTranslationItemDto, nullable: true })
  translation: AcademicPaperListTranslationItemDto | null;

  @ApiProperty({ type: AcademicPaperCategoryRefDto })
  academic_paper_categories: AcademicPaperCategoryRefDto;
}

class AcademicPaperListDataDto {
  @ApiProperty({ type: [AcademicPaperListItemDto] })
  items: AcademicPaperListItemDto[];

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
