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
    description: "Search across titles",
  })
  @IsOptional()
  @IsString()
  search?: string;
}
