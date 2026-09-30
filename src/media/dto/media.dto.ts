import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsInt, IsOptional, IsString, Matches, MaxLength, Min } from "class-validator";
import { PaginationDto } from "../../common/dto/pagination.dto";
import { DTO_LIMITS } from "../../common/validators/dto-limits";
import { SearchTerm } from "../../common/validators/search-term";

export class RequestUploadUrlDto {
  @ApiProperty({
    example: "shrine-photo.jpg",
    description: "Original filename including extension",
    maxLength: DTO_LIMITS.filename,
  })
  @IsString()
  @MaxLength(DTO_LIMITS.filename)
  filename!: string;

  @ApiProperty({
    example: "image/jpeg",
    description:
      "MIME type. Allowed: image/jpeg, image/png, image/gif, image/webp. Other types are rejected with 400.",
    enum: ["image/jpeg", "image/png", "image/gif", "image/webp"],
  })
  @IsString()
  @Matches(/^image\//)
  @MaxLength(DTO_LIMITS.mimeType)
  mime_type!: string;
}

export class ConfirmUploadDto {
  @ApiProperty({
    example: "media/abc123xyz-shrine-photo.jpg",
    description: "R2 object key returned by the upload-url endpoint",
    maxLength: DTO_LIMITS.storageKey,
  })
  @IsString()
  @MaxLength(DTO_LIMITS.storageKey)
  key!: string;

  @ApiProperty({ example: "shrine-photo.jpg", maxLength: DTO_LIMITS.filename })
  @IsString()
  @MaxLength(DTO_LIMITS.filename)
  filename!: string;

  @ApiPropertyOptional({ example: "Interior of Imam Zain Al-Abideen shrine", maxLength: DTO_LIMITS.caption })
  @IsOptional()
  @IsString()
  @MaxLength(DTO_LIMITS.caption)
  alt_text?: string;

  @ApiProperty({ example: "image/jpeg", pattern: "^image/", maxLength: DTO_LIMITS.mimeType })
  @IsString()
  @Matches(/^image\//)
  @MaxLength(DTO_LIMITS.mimeType)
  mime_type!: string;

  @ApiProperty({
    example: 204800,
    description: "File size in bytes",
    minimum: 1,
  })
  @IsInt()
  @Min(1)
  file_size!: number;

  @ApiPropertyOptional({
    example: 1920,
    description: "Image width in pixels",
    minimum: 1,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  width?: number;

  @ApiPropertyOptional({
    example: 1080,
    description: "Image height in pixels",
    minimum: 1,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  height?: number;
}

export class UpdateMediaDto {
  @ApiPropertyOptional({ example: "updated-filename.jpg", maxLength: DTO_LIMITS.filename })
  @IsOptional()
  @IsString()
  @MaxLength(DTO_LIMITS.filename)
  filename?: string;

  @ApiPropertyOptional({ example: "Updated alt text for accessibility", maxLength: DTO_LIMITS.caption })
  @IsOptional()
  @IsString()
  @MaxLength(DTO_LIMITS.caption)
  alt_text?: string;
}

export class MediaQueryDto extends PaginationDto {
  @ApiPropertyOptional({
    example: "shrine",
    description:
      "Substring search across `filename` and `alt_text` (case-insensitive). Backed by GIN trigram indexes so it stays cheap as the media library grows. 2–200 characters after trimming; a blank value is ignored.",
    minLength: 2,
    maxLength: 200,
  })
  @SearchTerm()
  search?: string;

  @ApiPropertyOptional({
    example: "image/jpeg",
    description:
      "Filter by exact MIME type. Common values: `image/jpeg`, `image/png`, `image/webp`, `image/gif`.",
  })
  @IsOptional()
  @IsString()
  @Matches(/^[\w.+-]+\/[\w.+-]+$/)
  @MaxLength(DTO_LIMITS.mimeType)
  mime_type?: string;
}
