import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from "class-validator";
import { DTO_LIMITS } from "../../common/validators/dto-limits";

export class GalleryCategoryTranslationDto {
  @ApiProperty({ example: "ar", minLength: 2, maxLength: 2 })
  @IsString()
  @Length(2, 2)
  lang!: string;

  @ApiProperty({ example: "صور المراقد", maxLength: DTO_LIMITS.title })
  @IsString()
  @MinLength(1)
  @MaxLength(DTO_LIMITS.title)
  title!: string;

  @ApiProperty({
    example: "suwar-al-maraqi",
    description: "Lowercase letters, numbers and hyphens only",
    maxLength: DTO_LIMITS.slug,
  })
  @IsString()
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  @MaxLength(DTO_LIMITS.slug)
  slug!: string;

  @ApiPropertyOptional({ example: "صور المراقد المقدسة", maxLength: DTO_LIMITS.summary })
  @IsOptional()
  @IsString()
  @MaxLength(DTO_LIMITS.summary)
  description?: string;
}

export class CreateGalleryCategoryDto {
  @ApiProperty({ type: [GalleryCategoryTranslationDto], maxItems: DTO_LIMITS.listItems })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => GalleryCategoryTranslationDto)
  @ArrayMinSize(1)
  @ArrayMaxSize(DTO_LIMITS.listItems)
  translations!: GalleryCategoryTranslationDto[];
}

export class UpdateGalleryCategoryDto {
  @ApiPropertyOptional({ type: [GalleryCategoryTranslationDto], maxItems: DTO_LIMITS.listItems })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => GalleryCategoryTranslationDto)
  @ArrayMaxSize(DTO_LIMITS.listItems)
  translations?: GalleryCategoryTranslationDto[];
}
