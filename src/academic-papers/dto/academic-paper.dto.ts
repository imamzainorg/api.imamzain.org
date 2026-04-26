import { Type } from 'class-transformer';
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
} from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';

export class AcademicPaperTranslationDto {
  @IsString()
  @Length(2, 2)
  lang: string;

  @IsString()
  @MinLength(1)
  title: string;

  @IsOptional()
  @IsString()
  abstract?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  authors?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  keywords?: string[];

  @IsOptional()
  @IsString()
  publication_venue?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  page_count?: number;

  @IsOptional()
  @IsBoolean()
  is_default?: boolean;
}

export class CreateAcademicPaperDto {
  @IsUUID()
  category_id: string;

  @IsOptional()
  @IsString()
  published_year?: string;

  @IsOptional()
  @IsUrl()
  pdf_url?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AcademicPaperTranslationDto)
  @ArrayMinSize(1)
  translations: AcademicPaperTranslationDto[];
}

export class UpdateAcademicPaperDto {
  @IsOptional()
  @IsUUID()
  category_id?: string;

  @IsOptional()
  @IsString()
  published_year?: string;

  @IsOptional()
  @IsUrl()
  pdf_url?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AcademicPaperTranslationDto)
  translations?: AcademicPaperTranslationDto[];
}

export class AcademicPaperQueryDto extends PaginationDto {
  @IsOptional()
  @IsUUID()
  category_id?: string;

  @IsOptional()
  @IsString()
  search?: string;
}
