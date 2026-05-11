import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MinLength,
  ValidateNested,
} from "class-validator";
import { PaginationDto } from "../../common/dto/pagination.dto";
import { MaxBytes } from "../../common/validators/max-bytes.validator";

export class PostTranslationDto {
  @ApiProperty({
    example: "ar",
    minLength: 2,
    maxLength: 2,
    description: "ISO 639-1 language code",
  })
  @IsString()
  @Length(2, 2)
  lang!: string;

  @ApiProperty({ example: "حياة الإمام زين العابدين" })
  @IsString()
  @MinLength(1)
  title!: string;

  @ApiPropertyOptional({ example: "نبذة مختصرة عن سيرة الإمام" })
  @IsOptional()
  @IsString()
  summary?: string;

  @ApiProperty({
    example: "<p>نص المقالة الكاملة...</p>",
    description:
      "Rich-text HTML produced by the CMS editor (Tiptap StarterKit allowlist). " +
      "Server-side sanitisation strips javascript:/vbscript: URLs, inline event " +
      "handlers, and any tag outside the allowlist. Maximum 200 KB UTF-8.",
  })
  @IsString()
  @MinLength(1)
  @MaxBytes()
  body!: string;

  @ApiProperty({
    example: "hayat-al-imam-zain",
    description: "URL-friendly slug (lowercase, hyphens only)",
  })
  @IsString()
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  slug!: string;

  @ApiPropertyOptional({
    example: true,
    description: "Exactly one translation must be the default",
  })
  @IsOptional()
  @IsBoolean()
  is_default?: boolean;

  @ApiPropertyOptional({
    example: "حياة الإمام السجاد – السيرة الكاملة",
    description:
      "Used in <title> and the SERP heading. Falls back to `title` when null. Target length ≤ 60 chars.",
    maxLength: 120,
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  meta_title?: string;

  @ApiPropertyOptional({
    example: "نظرة شاملة على سيرة الإمام علي بن الحسين زين العابدين وحياته العلمية والروحية.",
    description:
      "SERP snippet and og:description fallback. Falls back to `summary` (or a body excerpt) when null. Target length ≤ 160 chars.",
    maxLength: 320,
  })
  @IsOptional()
  @IsString()
  @MaxLength(320)
  meta_description?: string;

  @ApiPropertyOptional({
    format: "uuid",
    description:
      "Media UUID used for og:image / twitter:image when the URL is shared. Falls back to the post's cover_image_id when null.",
  })
  @IsOptional()
  @IsUUID()
  og_image_id?: string;
}

export class CreatePostDto {
  @ApiProperty({
    format: "uuid",
    description: "ID of an existing post category",
  })
  @IsUUID()
  category_id!: string;

  @ApiPropertyOptional({
    format: "uuid",
    description: "ID of an existing media record used as cover image",
  })
  @IsOptional()
  @IsUUID()
  cover_image_id?: string;

  @ApiPropertyOptional({ example: false, default: false })
  @IsOptional()
  @IsBoolean()
  is_published?: boolean;

  @ApiPropertyOptional({
    example: "2025-01-15T10:00:00Z",
    description: "ISO 8601 publish timestamp",
  })
  @IsOptional()
  @IsISO8601()
  published_at?: string;

  @ApiProperty({
    type: [PostTranslationDto],
    description: "Must include exactly one translation with is_default: true",
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PostTranslationDto)
  @ArrayMinSize(1)
  translations!: PostTranslationDto[];

  @ApiPropertyOptional({
    type: [String],
    format: "uuid",
    description: "Ordered list of media IDs to attach to the post",
  })
  @IsOptional()
  @IsArray()
  @IsUUID("all", { each: true })
  attachment_ids?: string[];
}

export class UpdatePostDto {
  @ApiPropertyOptional({ format: "uuid" })
  @IsOptional()
  @IsUUID()
  category_id?: string;

  @ApiPropertyOptional({ format: "uuid" })
  @IsOptional()
  @IsUUID()
  cover_image_id?: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  is_published?: boolean;

  @ApiPropertyOptional({ example: "2025-01-15T10:00:00Z" })
  @IsOptional()
  @IsISO8601()
  published_at?: string;

  @ApiPropertyOptional({ type: [PostTranslationDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PostTranslationDto)
  translations?: PostTranslationDto[];

  @ApiPropertyOptional({ type: [String], format: "uuid" })
  @IsOptional()
  @IsArray()
  @IsUUID("all", { each: true })
  attachment_ids?: string[];
}

export class TogglePublishDto {
  @ApiProperty({ example: true })
  @IsBoolean()
  is_published!: boolean;
}

export class PostQueryDto extends PaginationDto {
  @ApiPropertyOptional({ format: "uuid", description: "Filter by category ID" })
  @IsOptional()
  @IsUUID()
  category_id?: string;

  @ApiPropertyOptional({
    example: "الإمام",
    description: "Full-text search across title and body",
  })
  @IsOptional()
  @IsString()
  search?: string;
}
