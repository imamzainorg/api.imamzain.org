import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform, Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MaxLength,
  MinLength,
  ValidateNested,
} from "class-validator";
import { PaginationDto } from "../../common/dto/pagination.dto";
import { DTO_LIMITS } from "../../common/validators/dto-limits";

export class GalleryImageTranslationDto {
  @ApiProperty({ example: "ar", minLength: 2, maxLength: 2 })
  @IsString()
  @Length(2, 2)
  lang!: string;

  @ApiProperty({ example: "مرقد الإمام زين العابدين", maxLength: DTO_LIMITS.title })
  @IsString()
  @MinLength(1)
  @MaxLength(DTO_LIMITS.title)
  title!: string;

  @ApiPropertyOptional({
    example: "صورة داخل المرقد الشريف في المدينة المنورة",
    maxLength: DTO_LIMITS.summary,
  })
  @IsOptional()
  @IsString()
  @MaxLength(DTO_LIMITS.summary)
  description?: string;

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
}

export class CreateGalleryImageDto {
  @ApiProperty({
    format: "uuid",
    description: "ID of an existing media record",
  })
  @IsUUID()
  media_id!: string;

  @ApiPropertyOptional({
    format: "uuid",
    description: "ID of a gallery category",
  })
  @IsOptional()
  @IsUUID()
  category_id?: string;

  @ApiPropertyOptional({
    example: "2023-11-05",
    description: "ISO 8601 date when the photo was taken",
  })
  @IsOptional()
  @IsDateString()
  taken_at?: string;

  @ApiPropertyOptional({ example: "Ahmad Al-Kaabi", maxLength: DTO_LIMITS.person })
  @IsOptional()
  @IsString()
  @MaxLength(DTO_LIMITS.person)
  author?: string;

  @ApiPropertyOptional({
    type: [String],
    example: ["shrine", "pilgrimage", "karbala"],
    maxItems: DTO_LIMITS.listItems,
    description: "Up to 50 tags, each up to 200 characters.",
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(DTO_LIMITS.listItems)
  @IsString({ each: true })
  @MaxLength(DTO_LIMITS.label, { each: true })
  tags?: string[];

  @ApiPropertyOptional({
    type: [String],
    example: ["Karbala", "Iraq"],
    maxItems: DTO_LIMITS.listItems,
    description: "Up to 50 locations, each up to 200 characters.",
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(DTO_LIMITS.listItems)
  @IsString({ each: true })
  @MaxLength(DTO_LIMITS.label, { each: true })
  locations?: string[];

  @ApiPropertyOptional({
    example: true,
    description: "Whether the image is publicly visible. Defaults to true — photos are typically uploaded already-final.",
  })
  @IsOptional()
  @IsBoolean()
  is_published?: boolean;

  @ApiProperty({ type: [GalleryImageTranslationDto], maxItems: DTO_LIMITS.listItems })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => GalleryImageTranslationDto)
  @ArrayMinSize(1)
  @ArrayMaxSize(DTO_LIMITS.listItems)
  translations!: GalleryImageTranslationDto[];
}

export class UpdateGalleryImageDto {
  // media_id is the primary key for gallery_images and intentionally not updatable.
  @ApiPropertyOptional({ format: "uuid" })
  @IsOptional()
  @IsUUID()
  category_id?: string;

  @ApiPropertyOptional({ example: "2023-12-01" })
  @IsOptional()
  @IsDateString()
  taken_at?: string;

  @ApiPropertyOptional({ example: "Updated Photographer Name", maxLength: DTO_LIMITS.person })
  @IsOptional()
  @IsString()
  @MaxLength(DTO_LIMITS.person)
  author?: string;

  @ApiPropertyOptional({ type: [String], example: ["shrine"], maxItems: DTO_LIMITS.listItems })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(DTO_LIMITS.listItems)
  @IsString({ each: true })
  @MaxLength(DTO_LIMITS.label, { each: true })
  tags?: string[];

  @ApiPropertyOptional({ type: [String], example: ["Medina"], maxItems: DTO_LIMITS.listItems })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(DTO_LIMITS.listItems)
  @IsString({ each: true })
  @MaxLength(DTO_LIMITS.label, { each: true })
  locations?: string[];

  @ApiPropertyOptional({ example: true, description: "Whether the image is publicly visible." })
  @IsOptional()
  @IsBoolean()
  is_published?: boolean;

  @ApiPropertyOptional({ type: [GalleryImageTranslationDto], maxItems: DTO_LIMITS.listItems })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => GalleryImageTranslationDto)
  @ArrayMaxSize(DTO_LIMITS.listItems)
  translations?: GalleryImageTranslationDto[];
}

export class TogglePublishDto {
  @ApiProperty({ example: true })
  @IsBoolean()
  is_published!: boolean;
}

export class GalleryQueryDto extends PaginationDto {
  @ApiPropertyOptional({
    format: "uuid",
    description: "Filter by gallery category ID",
  })
  @IsOptional()
  @IsUUID()
  category_id?: string;

  @ApiPropertyOptional({
    type: [String],
    example: ["shrine"],
    description: "Filter images that have ALL specified tags",
    maxItems: DTO_LIMITS.listItems,
  })
  @IsOptional()
  @Transform(({ value }) => (Array.isArray(value) ? value : [value]))
  @IsArray()
  @ArrayMaxSize(DTO_LIMITS.listItems)
  @IsString({ each: true })
  @MaxLength(DTO_LIMITS.label, { each: true })
  tags?: string[];

  @ApiPropertyOptional({
    type: [String],
    example: ["Karbala"],
    description: "Filter images that have ALL specified locations",
    maxItems: DTO_LIMITS.listItems,
  })
  @IsOptional()
  @Transform(({ value }) => (Array.isArray(value) ? value : [value]))
  @IsArray()
  @ArrayMaxSize(DTO_LIMITS.listItems)
  @IsString({ each: true })
  @MaxLength(DTO_LIMITS.label, { each: true })
  locations?: string[];
}
