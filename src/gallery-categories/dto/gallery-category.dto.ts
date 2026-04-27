import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsOptional, IsString, Length, Matches, MinLength, ValidateNested } from 'class-validator';

export class GalleryCategoryTranslationDto {
  @ApiProperty({ example: 'ar', minLength: 2, maxLength: 2 })
  @IsString()
  @Length(2, 2)
  lang: string;

  @ApiProperty({ example: 'صور المراقد' })
  @IsString()
  @MinLength(1)
  title: string;

  @ApiProperty({ example: 'suwar-al-maraqi', description: 'Lowercase letters, numbers and hyphens only' })
  @IsString()
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  slug: string;

  @ApiPropertyOptional({ example: 'صور المراقد المقدسة' })
  @IsOptional()
  @IsString()
  description?: string;
}

export class CreateGalleryCategoryDto {
  @ApiProperty({ type: [GalleryCategoryTranslationDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => GalleryCategoryTranslationDto)
  @ArrayMinSize(1)
  translations: GalleryCategoryTranslationDto[];
}

export class UpdateGalleryCategoryDto {
  @ApiPropertyOptional({ type: [GalleryCategoryTranslationDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => GalleryCategoryTranslationDto)
  translations?: GalleryCategoryTranslationDto[];
}
