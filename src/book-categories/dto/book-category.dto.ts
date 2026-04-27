import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsOptional, IsString, Length, Matches, MinLength, ValidateNested } from 'class-validator';

export class BookCategoryTranslationDto {
  @ApiProperty({ example: 'ar', minLength: 2, maxLength: 2 })
  @IsString()
  @Length(2, 2)
  lang: string;

  @ApiProperty({ example: 'الأدعية والزيارات' })
  @IsString()
  @MinLength(1)
  title: string;

  @ApiProperty({ example: 'al-adiya', description: 'Lowercase letters, numbers and hyphens only' })
  @IsString()
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  slug: string;

  @ApiPropertyOptional({ example: 'كتب الأدعية والزيارات المأثورة' })
  @IsOptional()
  @IsString()
  description?: string;
}

export class CreateBookCategoryDto {
  @ApiProperty({ type: [BookCategoryTranslationDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BookCategoryTranslationDto)
  @ArrayMinSize(1)
  translations: BookCategoryTranslationDto[];
}

export class UpdateBookCategoryDto {
  @ApiPropertyOptional({ type: [BookCategoryTranslationDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BookCategoryTranslationDto)
  translations?: BookCategoryTranslationDto[];
}
