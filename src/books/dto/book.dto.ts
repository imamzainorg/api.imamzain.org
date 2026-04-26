import { Type } from 'class-transformer';
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
} from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';

export class BookTranslationDto {
  @IsString()
  @Length(2, 2)
  lang: string;

  @IsString()
  @MinLength(1)
  title: string;

  @IsOptional()
  @IsString()
  author?: string;

  @IsOptional()
  @IsString()
  publisher?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  series?: string;

  @IsOptional()
  @IsBoolean()
  is_default?: boolean;
}

export class CreateBookDto {
  @IsUUID()
  category_id: string;

  @IsUUID()
  cover_image_id: string;

  @IsOptional()
  @IsString()
  isbn?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  pages?: number;

  @IsOptional()
  @IsString()
  publish_year?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  part_number?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  parts?: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BookTranslationDto)
  @ArrayMinSize(1)
  translations: BookTranslationDto[];
}

export class UpdateBookDto {
  @IsOptional()
  @IsUUID()
  category_id?: string;

  @IsOptional()
  @IsUUID()
  cover_image_id?: string;

  @IsOptional()
  @IsString()
  isbn?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  pages?: number;

  @IsOptional()
  @IsString()
  publish_year?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  part_number?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  parts?: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BookTranslationDto)
  translations?: BookTranslationDto[];
}

export class BookQueryDto extends PaginationDto {
  @IsOptional()
  @IsUUID()
  category_id?: string;

  @IsOptional()
  @IsString()
  search?: string;
}
