import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
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

export class AcademicPaperTranslationDto {
  @ApiProperty({ example: "ar", minLength: 2, maxLength: 2 })
  @IsString()
  @Length(2, 2)
  lang!: string;

  @ApiProperty({ example: "فقه الإمام زين العابدين في الصحيفة السجادية" })
  @IsString()
  @MinLength(1)
  title!: string;

  @ApiPropertyOptional({ example: "ملخص الورقة البحثية حول المنهج الفقهي..." })
  @IsOptional()
  @IsString()
  abstract?: string;

  @ApiPropertyOptional({
    type: [String],
    example: ["د. محمد العراقي", "أ. علي الكاظمي"],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  authors?: string[];

  @ApiPropertyOptional({
    type: [String],
    example: ["فقه", "أدعية", "الإمام السجاد"],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  keywords?: string[];

  @ApiPropertyOptional({ example: "مجلة الدراسات الإسلامية" })
  @IsOptional()
  @IsString()
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

  @ApiPropertyOptional({ example: "2022" })
  @IsOptional()
  @IsString()
  published_year?: string;

  @ApiPropertyOptional({
    example: "https://cdn.imamzain.org/papers/paper.pdf",
    description: "Direct URL to the PDF file",
  })
  @IsOptional()
  @IsUrl()
  pdf_url?: string;

  @ApiPropertyOptional({
    example: ["ar"],
    description:
      "ISO 639-1 codes for the language(s) the PDF itself is written in. Distinct from `translations[].lang`, which describes the catalogue metadata — a paper can be catalogued in Arabic while the document is Persian. Defaults to an empty array.",
  })
  @IsOptional()
  @IsArray()
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
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AcademicPaperTranslationDto)
  @ArrayMinSize(1)
  translations!: AcademicPaperTranslationDto[];
}

export class UpdateAcademicPaperDto {
  @ApiPropertyOptional({ format: "uuid" })
  @IsOptional()
  @IsUUID()
  category_id?: string;

  @ApiPropertyOptional({ example: "2023" })
  @IsOptional()
  @IsString()
  published_year?: string;

  @ApiPropertyOptional({
    example: "https://cdn.imamzain.org/papers/updated-paper.pdf",
  })
  @IsOptional()
  @IsUrl()
  pdf_url?: string;

  @ApiPropertyOptional({
    example: ["ar", "fa"],
    description: "ISO 639-1 codes for the language(s) the PDF itself is written in. Replaces the whole array when supplied.",
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @Length(2, 2, { each: true })
  document_languages?: string[];

  @ApiPropertyOptional({ example: true, description: "Whether the paper is publicly visible." })
  @IsOptional()
  @IsBoolean()
  is_published?: boolean;

  @ApiPropertyOptional({ type: [AcademicPaperTranslationDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AcademicPaperTranslationDto)
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
    description: "Search across titles and abstracts",
    maxLength: 200,
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;
}
