import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsOptional, IsString, Length, Matches, MinLength, ValidateNested } from 'class-validator';

export class GalleryCategoryTranslationDto {
  @IsString()
  @Length(2, 2)
  lang: string;

  @IsString()
  @MinLength(1)
  title: string;

  @IsString()
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  slug: string;

  @IsOptional()
  @IsString()
  description?: string;
}

export class CreateGalleryCategoryDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => GalleryCategoryTranslationDto)
  @ArrayMinSize(1)
  translations: GalleryCategoryTranslationDto[];
}

export class UpdateGalleryCategoryDto {
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => GalleryCategoryTranslationDto)
  translations?: GalleryCategoryTranslationDto[];
}
