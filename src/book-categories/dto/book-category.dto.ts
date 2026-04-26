import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsOptional, IsString, Length, Matches, MinLength, ValidateNested } from 'class-validator';

export class BookCategoryTranslationDto {
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

export class CreateBookCategoryDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BookCategoryTranslationDto)
  @ArrayMinSize(1)
  translations: BookCategoryTranslationDto[];
}

export class UpdateBookCategoryDto {
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BookCategoryTranslationDto)
  translations?: BookCategoryTranslationDto[];
}
