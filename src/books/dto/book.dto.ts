import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform, Type } from "class-transformer";
import {
  ArrayMaxSize,
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
  ValidateIf,
  ValidateNested,
} from "class-validator";
import { PaginationDto } from "../../common/dto/pagination.dto";
import { DTO_LIMITS } from "../../common/validators/dto-limits";
import { toQueryBoolean } from "../../common/validators/query-boolean";
import { SearchTerm } from "../../common/validators/search-term";

const HTTP_URL = /^https?:\/\/.+/i;

export class BookTranslationDto {
  @ApiProperty({ example: "ar", minLength: 2, maxLength: 2 })
  @IsString()
  @Length(2, 2)
  lang!: string;

  @ApiProperty({ example: "الصحيفة السجادية", maxLength: DTO_LIMITS.title })
  @IsString()
  @MinLength(1)
  @MaxLength(DTO_LIMITS.title)
  title!: string;

  @ApiPropertyOptional({ example: "الإمام علي بن الحسين", maxLength: DTO_LIMITS.person })
  @IsOptional()
  @IsString()
  @MaxLength(DTO_LIMITS.person)
  author?: string;

  @ApiPropertyOptional({ example: "دار الإسلام", maxLength: DTO_LIMITS.person })
  @IsOptional()
  @IsString()
  @MaxLength(DTO_LIMITS.person)
  publisher?: string;

  @ApiPropertyOptional({
    example: "مجموعة أدعية مأثورة عن الإمام زين العابدين",
    maxLength: DTO_LIMITS.summary,
  })
  @IsOptional()
  @IsString()
  @MaxLength(DTO_LIMITS.summary)
  description?: string;

  @ApiPropertyOptional({ example: "أدعية الأئمة", maxLength: DTO_LIMITS.title })
  @IsOptional()
  @IsString()
  @MaxLength(DTO_LIMITS.title)
  series?: string;

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
    example: true,
    description: "Exactly one translation must be the default",
  })
  @IsOptional()
  @IsBoolean()
  is_default?: boolean;
}

export class CreateBookDto {
  @ApiProperty({
    format: "uuid",
    description: "ID of an existing book category",
  })
  @IsUUID()
  category_id!: string;

  @ApiProperty({
    format: "uuid",
    description: "ID of an existing media record for the cover image",
  })
  @IsUUID()
  cover_image_id!: string;

  @ApiPropertyOptional({
    example: "al-sahifa-al-sajjadiyya",
    description:
      "Optional editor slug (single, language-agnostic). Lowercase latin letters, numbers and hyphens; unique. Sets the public /books/{slug} URL. Omit to keep the book reachable only by UUID.",
  })
  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  @MaxLength(200)
  slug?: string;

  @ApiPropertyOptional({ example: "978-9953-0-2287-6", maxLength: DTO_LIMITS.code })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(DTO_LIMITS.code)
  isbn?: string;

  @ApiPropertyOptional({ example: 320, minimum: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  pages?: number;

  @ApiPropertyOptional({ example: "2010", maxLength: DTO_LIMITS.code })
  @IsOptional()
  @IsString()
  @MaxLength(DTO_LIMITS.code)
  publish_year?: string;

  @ApiPropertyOptional({
    example: "https://cdn.imamzain.org/books/al-sahifa-al-sajjadiyya.pdf",
    description: "Direct URL of the downloadable book PDF.",
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  @Matches(HTTP_URL, { message: "pdf_url must be an http(s) URL" })
  pdf_url?: string;

  @ApiPropertyOptional({
    example: ["ar"],
    description:
      "ISO 639-1 codes for the language(s) the PDF itself is written in. Distinct from `translations[].lang`, which describes the catalogue metadata — a book can be catalogued in Arabic and English while the document is Arabic-only. Defaults to an empty array.",
    maxItems: DTO_LIMITS.listItems,
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(DTO_LIMITS.listItems)
  @IsString({ each: true })
  @Length(2, 2, { each: true })
  document_languages?: string[];

  @ApiPropertyOptional({
    example: 1,
    description: "Part number within a multi-volume series",
    minimum: 1,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  part_number?: number;

  @ApiPropertyOptional({
    example: 3,
    description: "Total number of parts in the series",
    minimum: 1,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  parts?: number;

  @ApiPropertyOptional({
    example: true,
    description: "Whether the book is publicly visible. Defaults to true — books are typically uploaded already-final.",
  })
  @IsOptional()
  @IsBoolean()
  is_published?: boolean;

  @ApiPropertyOptional({
    format: "uuid",
    description:
      "ID of the series this book is a part of. The referenced book becomes the series' parent/cover entry and must not itself have a parent (one level deep only).",
  })
  @IsOptional()
  @IsUUID()
  parent_id?: string;

  @ApiPropertyOptional({
    example: false,
    description: 'Whether this book belongs to the institution\'s "الإصدارات" (Publications) release list — independent of its topical category_id.',
  })
  @IsOptional()
  @IsBoolean()
  is_publication?: boolean;

  @ApiProperty({
    type: [BookTranslationDto],
    description: "Must include exactly one translation with is_default: true",
    maxItems: DTO_LIMITS.listItems,
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BookTranslationDto)
  @ArrayMinSize(1)
  @ArrayMaxSize(DTO_LIMITS.listItems)
  translations!: BookTranslationDto[];
}

export class UpdateBookDto {
  @ApiPropertyOptional({ format: "uuid" })
  @IsOptional()
  @IsUUID()
  category_id?: string;

  @ApiPropertyOptional({ format: "uuid" })
  @IsOptional()
  @IsUUID()
  cover_image_id?: string;

  @ApiPropertyOptional({ example: "al-sahifa-al-sajjadiyya", description: "Optional editor slug (single, language-agnostic)." })
  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  @MaxLength(200)
  slug?: string;

  @ApiPropertyOptional({ example: "978-9953-0-2287-6", maxLength: DTO_LIMITS.code })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(DTO_LIMITS.code)
  isbn?: string;

  @ApiPropertyOptional({ example: 400, minimum: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  pages?: number;

  @ApiPropertyOptional({ example: "2015", maxLength: DTO_LIMITS.code })
  @IsOptional()
  @IsString()
  @MaxLength(DTO_LIMITS.code)
  publish_year?: string;

  @ApiPropertyOptional({
    example: "https://cdn.imamzain.org/books/al-sahifa-al-sajjadiyya.pdf",
    description: "Direct URL of the downloadable book PDF.",
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  @Matches(HTTP_URL, { message: "pdf_url must be an http(s) URL" })
  pdf_url?: string;

  @ApiPropertyOptional({
    example: ["ar", "fa"],
    description: "ISO 639-1 codes for the language(s) the PDF itself is written in. Replaces the whole array when supplied.",
    maxItems: DTO_LIMITS.listItems,
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(DTO_LIMITS.listItems)
  @IsString({ each: true })
  @Length(2, 2, { each: true })
  document_languages?: string[];

  @ApiPropertyOptional({ example: 2, minimum: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  part_number?: number;

  @ApiPropertyOptional({ example: 3, minimum: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  parts?: number;

  @ApiPropertyOptional({ example: true, description: "Whether the book is publicly visible." })
  @IsOptional()
  @IsBoolean()
  is_published?: boolean;

  @ApiPropertyOptional({
    format: "uuid",
    nullable: true,
    description:
      "ID of the series this book is a part of. The referenced book becomes the series' parent/cover entry and must not itself have a parent (one level deep only). Pass null to detach this book from its series.",
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  parent_id?: string | null;

  @ApiPropertyOptional({
    example: false,
    description: 'Whether this book belongs to the institution\'s "الإصدارات" (Publications) release list — independent of its topical category_id.',
  })
  @IsOptional()
  @IsBoolean()
  is_publication?: boolean;

  @ApiPropertyOptional({ type: [BookTranslationDto], maxItems: DTO_LIMITS.listItems })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BookTranslationDto)
  @ArrayMaxSize(DTO_LIMITS.listItems)
  translations?: BookTranslationDto[];
}

export class TogglePublishDto {
  @ApiProperty({ example: true })
  @IsBoolean()
  is_published!: boolean;
}

export class BookQueryDto extends PaginationDto {
  @ApiPropertyOptional({ format: "uuid", description: "Filter by category ID" })
  @IsOptional()
  @IsUUID()
  category_id?: string;

  @ApiPropertyOptional({
    example: "الصحيفة",
    description: "Search across book titles. 2–200 characters after trimming; a blank value is ignored.",
    minLength: 2,
    maxLength: 200,
  })
  @SearchTerm()
  search?: string;

  @ApiPropertyOptional({
    example: true,
    description:
      'Filter to books on the institution\'s "الإصدارات" (Publications) release list. Independent of category_id — a book can carry a topical category AND be flagged as a Publication. Only `true` / `false` are accepted.',
  })
  @IsOptional()
  @Transform(toQueryBoolean)
  @IsBoolean()
  is_publication?: boolean;
}
