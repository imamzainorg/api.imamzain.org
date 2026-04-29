import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Min,
  MinLength,
  ValidateNested,
} from "class-validator";
import { PaginationDto } from "../../common/dto/pagination.dto";

export class BookTranslationDto {
  @ApiProperty({ example: "ar", minLength: 2, maxLength: 2 })
  @IsString()
  @Length(2, 2)
  lang!: string;

  @ApiProperty({ example: "الصحيفة السجادية" })
  @IsString()
  @MinLength(1)
  title!: string;

  @ApiPropertyOptional({ example: "الإمام علي بن الحسين" })
  @IsOptional()
  @IsString()
  author?: string;

  @ApiPropertyOptional({ example: "دار الإسلام" })
  @IsOptional()
  @IsString()
  publisher?: string;

  @ApiPropertyOptional({
    example: "مجموعة أدعية مأثورة عن الإمام زين العابدين",
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ example: "أدعية الأئمة" })
  @IsOptional()
  @IsString()
  series?: string;

  @ApiPropertyOptional({
    example: true,
    description: "Exactly one translation must be the default",
  })
  @IsOptional()
  @IsBoolean()
  is_default?: boolean;
}

export class CreateBookDto {
  @ApiProperty({
    format: "uuid",
    description: "ID of an existing book category",
  })
  @IsUUID()
  category_id!: string;

  @ApiProperty({
    format: "uuid",
    description: "ID of an existing media record for the cover image",
  })
  @IsUUID()
  cover_image_id!: string;

  @ApiPropertyOptional({ example: "978-9953-0-2287-6" })
  @IsOptional()
  @IsString()
  isbn?: string;

  @ApiPropertyOptional({ example: 320, minimum: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  pages?: number;

  @ApiPropertyOptional({ example: "2010" })
  @IsOptional()
  @IsString()
  publish_year?: string;

  @ApiPropertyOptional({
    example: 1,
    description: "Part number within a multi-volume series",
    minimum: 1,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  part_number?: number;

  @ApiPropertyOptional({
    example: 3,
    description: "Total number of parts in the series",
    minimum: 1,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  parts?: number;

  @ApiProperty({
    type: [BookTranslationDto],
    description: "Must include exactly one translation with is_default: true",
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BookTranslationDto)
  @ArrayMinSize(1)
  translations!: BookTranslationDto[];
}

export class UpdateBookDto {
  @ApiPropertyOptional({ format: "uuid" })
  @IsOptional()
  @IsUUID()
  category_id?: string;

  @ApiPropertyOptional({ format: "uuid" })
  @IsOptional()
  @IsUUID()
  cover_image_id?: string;

  @ApiPropertyOptional({ example: "978-9953-0-2287-6" })
  @IsOptional()
  @IsString()
  isbn?: string;

  @ApiPropertyOptional({ example: 400, minimum: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  pages?: number;

  @ApiPropertyOptional({ example: "2015" })
  @IsOptional()
  @IsString()
  publish_year?: string;

  @ApiPropertyOptional({ example: 2, minimum: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  part_number?: number;

  @ApiPropertyOptional({ example: 3, minimum: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  parts?: number;

  @ApiPropertyOptional({ type: [BookTranslationDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BookTranslationDto)
  translations?: BookTranslationDto[];
}

export class BookQueryDto extends PaginationDto {
  @ApiPropertyOptional({ format: "uuid", description: "Filter by category ID" })
  @IsOptional()
  @IsUUID()
  category_id?: string;

  @ApiPropertyOptional({
    example: "الصحيفة",
    description: "Search across book titles",
  })
  @IsOptional()
  @IsString()
  search?: string;
}
