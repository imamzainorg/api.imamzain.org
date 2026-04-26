import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsOptional, IsString, Length, Matches, MinLength, ValidateNested } from 'class-validator';

export class AcademicPaperCategoryTranslationDto {
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

export class CreateAcademicPaperCategoryDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AcademicPaperCategoryTranslationDto)
  @ArrayMinSize(1)
  translations: AcademicPaperCategoryTranslationDto[];
}

export class UpdateAcademicPaperCategoryDto {
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AcademicPaperCategoryTranslationDto)
  translations?: AcademicPaperCategoryTranslationDto[];
}
