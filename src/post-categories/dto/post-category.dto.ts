import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsString,
  Length,
  Matches,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class PostCategoryTranslationDto {
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

export class CreatePostCategoryDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PostCategoryTranslationDto)
  @ArrayMinSize(1)
  translations: PostCategoryTranslationDto[];
}

export class UpdatePostCategoryDto {
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PostCategoryTranslationDto)
  translations?: PostCategoryTranslationDto[];
}
