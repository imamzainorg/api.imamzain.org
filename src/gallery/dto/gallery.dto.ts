import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform, Type } from "class-transformer";
import {
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

export class GalleryImageTranslationDto {
  @ApiProperty({ example: "ar", minLength: 2, maxLength: 2 })
  @IsString()
  @Length(2, 2)
  lang!: string;

  @ApiProperty({ example: "مرقد الإمام زين العابدين" })
  @IsString()
  @MinLength(1)
  title!: string;

  @ApiPropertyOptional({
    example: "صورة داخل المرقد الشريف في المدينة المنورة",
  })
  @IsOptional()
  @IsString()
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

  @ApiPropertyOptional({ example: "Ahmad Al-Kaabi" })
  @IsOptional()
  @IsString()
  author?: string;

  @ApiPropertyOptional({
    type: [String],
    example: ["shrine", "pilgrimage", "karbala"],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @ApiPropertyOptional({ type: [String], example: ["Karbala", "Iraq"] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  locations?: string[];

  @ApiPropertyOptional({
    example: true,
    description: "Whether the image is publicly visible. Defaults to true — photos are typically uploaded already-final.",
  })
  @IsOptional()
  @IsBoolean()
  is_published?: boolean;

  @ApiProperty({ type: [GalleryImageTranslationDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => GalleryImageTranslationDto)
  @ArrayMinSize(1)
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

  @ApiPropertyOptional({ example: "Updated Photographer Name" })
  @IsOptional()
  @IsString()
  author?: string;

  @ApiPropertyOptional({ type: [String], example: ["shrine"] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @ApiPropertyOptional({ type: [String], example: ["Medina"] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  locations?: string[];

  @ApiPropertyOptional({ example: true, description: "Whether the image is publicly visible." })
  @IsOptional()
  @IsBoolean()
  is_published?: boolean;

  @ApiPropertyOptional({ type: [GalleryImageTranslationDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => GalleryImageTranslationDto)
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
  })
  @IsOptional()
  @Transform(({ value }) => (Array.isArray(value) ? value : [value]))
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @ApiPropertyOptional({
    type: [String],
    example: ["Karbala"],
    description: "Filter images that have ALL specified locations",
  })
  @IsOptional()
  @Transform(({ value }) => (Array.isArray(value) ? value : [value]))
  @IsArray()
  @IsString({ each: true })
  locations?: string[];
}
