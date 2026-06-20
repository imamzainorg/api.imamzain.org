import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform, Type } from "class-transformer";
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from "class-validator";
import { PaginationDto } from "../../common/dto/pagination.dto";
import { MaxBytes } from "../../common/validators/max-bytes.validator";

export class StaticPageTranslationDto {
  @ApiProperty({ example: "ar", minLength: 2, maxLength: 2 })
  @IsString()
  @Length(2, 2)
  lang!: string;

  @ApiProperty({ example: "سيرة الإمام زين العابدين" })
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  title!: string;

  @ApiProperty({
    example: "imam-zain-biography",
    description: "Lowercase letters, numbers and hyphens only. Unique per language.",
  })
  @IsString()
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  @MaxLength(200)
  slug!: string;

  @ApiProperty({
    example: "<p>...rich HTML body...</p>",
    description:
      "Rich HTML body. Sanitised server-side (same allowlist as posts). Maximum 200 KB UTF-8.",
  })
  @IsString()
  @MinLength(1)
  @MaxBytes()
  body!: string;

  @ApiPropertyOptional({ description: "SEO <title> override for this translation." })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  meta_title?: string;

  @ApiPropertyOptional({ description: "SEO meta description for this translation." })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  meta_description?: string;

  @ApiPropertyOptional({ format: "uuid", description: "Media ID used as the OpenGraph image for this translation." })
  @IsOptional()
  @IsUUID()
  og_image_id?: string;

  @ApiPropertyOptional({
    example: false,
    description:
      "Marks this translation as the canonical fallback when the requested language has no row. Exactly one translation per page should carry this flag.",
  })
  @IsOptional()
  @IsBoolean()
  is_default?: boolean;
}

export class CreateStaticPageDto {
  @ApiProperty({ type: [StaticPageTranslationDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StaticPageTranslationDto)
  @ArrayMinSize(1)
  translations!: StaticPageTranslationDto[];

  @ApiPropertyOptional({ example: 0, minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  display_order?: number;

  @ApiPropertyOptional({ example: true, default: true })
  @IsOptional()
  @IsBoolean()
  is_published?: boolean;
}

export class UpdateStaticPageDto {
  @ApiPropertyOptional({ type: [StaticPageTranslationDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StaticPageTranslationDto)
  translations?: StaticPageTranslationDto[];

  @ApiPropertyOptional({ example: 0, minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  display_order?: number;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  is_published?: boolean;
}

export class TogglePublishStaticPageDto {
  @ApiProperty({ example: true })
  @IsBoolean()
  is_published!: boolean;
}

export class StaticPageQueryDto extends PaginationDto {
  @ApiPropertyOptional({
    example: true,
    description: "Filter by published state. Omit on the admin route to include both.",
  })
  @IsOptional()
  @Transform(({ value }) => value === "true" || value === true)
  @IsBoolean()
  is_published?: boolean;
}
