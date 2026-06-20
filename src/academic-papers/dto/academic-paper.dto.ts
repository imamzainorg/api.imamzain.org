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
  Matches,
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
    example: "fiqh-al-imam-sajjad",
    description:
      "Optional editor slug. Lowercase latin letters, numbers and hyphens; unique per language. Sets the public /{lang}/academic-papers/{slug} URL. Omit to keep the paper reachable only by UUID.",
  })
  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  @MaxLength(200)
  slug?: string;

  @ApiPropertyOptional({ description: "SEO <title> override for this translation." })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  meta_title?: string;

  @ApiPropertyOptional({ description: "SEO meta description for this translation." })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  meta_description?: string;

  @ApiPropertyOptional({ format: "uuid", description: "Media ID used as the OpenGraph image for this translation." })
  @IsOptional()
  @IsUUID()
  og_image_id?: string;

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

  @ApiPropertyOptional({ type: [AcademicPaperTranslationDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AcademicPaperTranslationDto)
  translations?: AcademicPaperTranslationDto[];
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
