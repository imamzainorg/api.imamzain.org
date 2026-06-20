import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from "class-validator";

// ── Translations ────────────────────────────────────────────────────────────

export class StoreTranslationDto {
  @ApiProperty({ example: "ar", minLength: 2, maxLength: 2 })
  @IsString()
  @Length(2, 2)
  lang!: string;

  @ApiProperty({ example: "كربلاء المقدسة", description: "Localized city name." })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  city_name!: string;
}

export class StoreLocationTranslationDto {
  @ApiProperty({ example: "ar", minLength: 2, maxLength: 2 })
  @IsString()
  @Length(2, 2)
  lang!: string;

  @ApiProperty({ example: "مكتبة الروضة الحسينية", description: "Localized sale-point name." })
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  name!: string;

  @ApiProperty({ example: "شارع باب القبلة، بجوار الصحن الشريف", description: "Localized street address." })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  address!: string;
}

// ── Locations ───────────────────────────────────────────────────────────────

export class CreateStoreLocationDto {
  @ApiPropertyOptional({ example: "+964 770 000 0000" })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  phone?: string;

  @ApiPropertyOptional({
    example: "https://www.google.com/maps/embed?pb=...",
    description: "Google Maps iframe embed URL (the `src` of the embed snippet).",
  })
  @IsOptional()
  @IsUrl({ require_protocol: true })
  @MaxLength(2000)
  gps_embed_url?: string;

  @ApiPropertyOptional({
    example: "https://maps.app.goo.gl/abc123",
    description: "Shareable Google Maps link.",
  })
  @IsOptional()
  @IsUrl({ require_protocol: true })
  @MaxLength(2000)
  gps_link?: string;

  @ApiPropertyOptional({ example: 0, minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  display_order?: number;

  @ApiProperty({ type: [StoreLocationTranslationDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StoreLocationTranslationDto)
  @ArrayMinSize(1)
  translations!: StoreLocationTranslationDto[];
}

export class UpdateStoreLocationDto {
  @ApiPropertyOptional({ example: "+964 770 000 0000" })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  phone?: string;

  @ApiPropertyOptional({ example: "https://www.google.com/maps/embed?pb=..." })
  @IsOptional()
  @IsUrl({ require_protocol: true })
  @MaxLength(2000)
  gps_embed_url?: string;

  @ApiPropertyOptional({ example: "https://maps.app.goo.gl/abc123" })
  @IsOptional()
  @IsUrl({ require_protocol: true })
  @MaxLength(2000)
  gps_link?: string;

  @ApiPropertyOptional({ example: 0, minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  display_order?: number;

  @ApiPropertyOptional({ type: [StoreLocationTranslationDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StoreLocationTranslationDto)
  translations?: StoreLocationTranslationDto[];
}

// ── Stores ──────────────────────────────────────────────────────────────────

export class CreateStoreDto {
  @ApiProperty({ type: [StoreTranslationDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StoreTranslationDto)
  @ArrayMinSize(1)
  translations!: StoreTranslationDto[];

  @ApiPropertyOptional({ example: 0, minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  display_order?: number;

  @ApiPropertyOptional({
    type: [CreateStoreLocationDto],
    description: "Optional sale-points to create alongside the store in one call.",
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateStoreLocationDto)
  locations?: CreateStoreLocationDto[];
}

export class UpdateStoreDto {
  @ApiPropertyOptional({ type: [StoreTranslationDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StoreTranslationDto)
  translations?: StoreTranslationDto[];

  @ApiPropertyOptional({ example: 0, minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  display_order?: number;
}
