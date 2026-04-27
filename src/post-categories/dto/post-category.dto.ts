import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
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
  @ApiProperty({ example: 'ar', minLength: 2, maxLength: 2 })
  @IsString()
  @Length(2, 2)
  lang: string;

  @ApiProperty({ example: 'الأخبار والمستجدات' })
  @IsString()
  @MinLength(1)
  title: string;

  @ApiProperty({ example: 'al-akhbar', description: 'Lowercase letters, numbers and hyphens only' })
  @IsString()
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  slug: string;

  @ApiPropertyOptional({ example: 'آخر الأخبار المتعلقة بالموقع' })
  @IsOptional()
  @IsString()
  description?: string;
}

export class CreatePostCategoryDto {
  @ApiProperty({ type: [PostCategoryTranslationDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PostCategoryTranslationDto)
  @ArrayMinSize(1)
  translations: PostCategoryTranslationDto[];
}

export class UpdatePostCategoryDto {
  @ApiPropertyOptional({ type: [PostCategoryTranslationDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PostCategoryTranslationDto)
  translations?: PostCategoryTranslationDto[];
}
