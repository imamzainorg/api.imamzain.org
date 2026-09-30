import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Length,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from "class-validator";
import { PaginationDto } from "../../common/dto/pagination.dto";
import { DTO_LIMITS } from "../../common/validators/dto-limits";
import { SearchTerm } from "../../common/validators/search-term";

export class AcademicPaperTranslationDto {
  @ApiProperty({ example: "ar", minLength: 2, maxLength: 2 })
  @IsString()
  @Length(2, 2)
  lang!: string;

  @ApiProperty({ example: "فقه الإمام زين العابدين في الصحيفة السجادية", maxLength: DTO_LIMITS.title })
  @IsString()
  @MinLength(1)
  @MaxLength(DTO_LIMITS.title)
  title!: string;

  @ApiPropertyOptional({ example: "ملخص الورقة البحثية حول المنهج الفقهي...", maxLength: DTO_LIMITS.summary })
  @IsOptional()
  @IsString()
  @MaxLength(DTO_LIMITS.summary)
  abstract?: string;

  @ApiPropertyOptional({
    type: [String],
    example: ["د. محمد العراقي", "أ. علي الكاظمي"],
    maxItems: DTO_LIMITS.listItems,
    description: "Up to 50 authors, each up to 300 characters.",
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(DTO_LIMITS.listItems)
  @IsString({ each: true })
  @MaxLength(DTO_LIMITS.person, { each: true })
  authors?: string[];

  @ApiPropertyOptional({
    type: [String],
    example: ["فقه", "أدعية", "الإمام السجاد"],
    maxItems: DTO_LIMITS.listItems,
    description: "Up to 50 keywords, each up to 200 characters.",
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(DTO_LIMITS.listItems)
  @IsString({ each: true })
  @MaxLength(DTO_LIMITS.label, { each: true })
  keywords?: string[];

  @ApiPropertyOptional({ example: "مجلة الدراسات الإسلامية", maxLength: DTO_LIMITS.title })
  @IsOptional()
  @IsString()
  @MaxLength(DTO_LIMITS.title)
  publication_venue?: string;

  @ApiPropertyOptional({ example: 24, minimum: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  page_count?: number;

  @ApiPropertyOptional({
    example: true,
    description: "Exactly one translation must be the default",
  })
  @IsOptional()
  @IsBoolean()
  is_default?: boolean;
}

export class CreateAcademicPaperDto {
  @ApiProperty({
    format: "uuid",
    description: "ID of an existing academic paper category",
  })
  @IsUUID()
  category_id!: string;

  @ApiPropertyOptional({ example: "2022", maxLength: DTO_LIMITS.code })
  @IsOptional()
  @IsString()
  @MaxLength(DTO_LIMITS.code)
  published_year?: string;

  @ApiPropertyOptional({
    example: "https://cdn.imamzain.org/papers/paper.pdf",
    description: "Direct URL to the PDF file",
    maxLength: DTO_LIMITS.url,
  })
  @IsOptional()
  @IsUrl()
  @MaxLength(DTO_LIMITS.url)
  pdf_url?: string;

  @ApiPropertyOptional({
    example: ["ar"],
    description:
      "ISO 639-1 codes for the language(s) the PDF itself is written in. Distinct from `translations[].lang`, which describes the catalogue metadata — a paper can be catalogued in Arabic while the document is Persian. Defaults to an empty array.",
    maxItems: DTO_LIMITS.listItems,
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(DTO_LIMITS.listItems)
  @IsString({ each: true })
  @Length(2, 2, { each: true })
  document_languages?: string[];

  @ApiPropertyOptional({
    example: true,
    description: "Whether the paper is publicly visible. Defaults to true — papers are typically uploaded already-final.",
  })
  @IsOptional()
  @IsBoolean()
  is_published?: boolean;

  @ApiProperty({
    type: [AcademicPaperTranslationDto],
    description: "Must include exactly one translation with is_default: true",
    maxItems: DTO_LIMITS.listItems,
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AcademicPaperTranslationDto)
  @ArrayMinSize(1)
  @ArrayMaxSize(DTO_LIMITS.listItems)
  translations!: AcademicPaperTranslationDto[];
}

export class UpdateAcademicPaperDto {
  @ApiPropertyOptional({ format: "uuid" })
  @IsOptional()
  @IsUUID()
  category_id?: string;

  @ApiPropertyOptional({ example: "2023", maxLength: DTO_LIMITS.code })
  @IsOptional()
  @IsString()
  @MaxLength(DTO_LIMITS.code)
  published_year?: string;

  @ApiPropertyOptional({
    example: "https://cdn.imamzain.org/papers/updated-paper.pdf",
    maxLength: DTO_LIMITS.url,
  })
  @IsOptional()
  @IsUrl()
  @MaxLength(DTO_LIMITS.url)
  pdf_url?: string;

  @ApiPropertyOptional({
    example: ["ar", "fa"],
    description: "ISO 639-1 codes for the language(s) the PDF itself is written in. Replaces the whole array when supplied.",
    maxItems: DTO_LIMITS.listItems,
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(DTO_LIMITS.listItems)
  @IsString({ each: true })
  @Length(2, 2, { each: true })
  document_languages?: string[];

  @ApiPropertyOptional({ example: true, description: "Whether the paper is publicly visible." })
  @IsOptional()
  @IsBoolean()
  is_published?: boolean;

  @ApiPropertyOptional({ type: [AcademicPaperTranslationDto], maxItems: DTO_LIMITS.listItems })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AcademicPaperTranslationDto)
  @ArrayMaxSize(DTO_LIMITS.listItems)
  translations?: AcademicPaperTranslationDto[];
}

export class TogglePublishDto {
  @ApiProperty({ example: true })
  @IsBoolean()
  is_published!: boolean;
}

export class AcademicPaperQueryDto extends PaginationDto {
  @ApiPropertyOptional({ format: "uuid", description: "Filter by category ID" })
  @IsOptional()
  @IsUUID()
  category_id?: string;

  @ApiPropertyOptional({
    example: "الصحيفة",
    description: "Search across titles and abstracts. 2–200 characters after trimming; a blank value is ignored.",
    minLength: 2,
    maxLength: 200,
  })
  @SearchTerm()
  search?: string;
}
