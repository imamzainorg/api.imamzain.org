import { Transform, Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';

export class GalleryImageTranslationDto {
  @IsString()
  @Length(2, 2)
  lang: string;

  @IsString()
  @MinLength(1)
  title: string;

  @IsOptional()
  @IsString()
  description?: string;
}

export class CreateGalleryImageDto {
  @IsUUID()
  media_id: string;

  @IsOptional()
  @IsUUID()
  category_id?: string;

  @IsOptional()
  @IsDateString()
  taken_at?: string;

  @IsOptional()
  @IsString()
  author?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  locations?: string[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => GalleryImageTranslationDto)
  @ArrayMinSize(1)
  translations: GalleryImageTranslationDto[];
}

export class UpdateGalleryImageDto {
  @IsOptional()
  @IsUUID()
  media_id?: string;

  @IsOptional()
  @IsUUID()
  category_id?: string;

  @IsOptional()
  @IsDateString()
  taken_at?: string;

  @IsOptional()
  @IsString()
  author?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  locations?: string[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => GalleryImageTranslationDto)
  translations?: GalleryImageTranslationDto[];
}

export class GalleryQueryDto extends PaginationDto {
  @IsOptional()
  @IsUUID()
  category_id?: string;

  @IsOptional()
  @Transform(({ value }) => (Array.isArray(value) ? value : [value]))
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @IsOptional()
  @Transform(({ value }) => (Array.isArray(value) ? value : [value]))
  @IsArray()
  @IsString({ each: true })
  locations?: string[];
}
