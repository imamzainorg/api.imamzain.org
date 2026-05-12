import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from "class-validator";

export class RequestUploadUrlDto {
  @ApiProperty({
    example: "shrine-photo.jpg",
    description: "Original filename including extension",
  })
  @IsString()
  filename!: string;

  @ApiProperty({
    example: "image/jpeg",
    description:
      "MIME type. Allowed: image/jpeg, image/png, image/gif, image/webp. Other types are rejected with 400.",
    enum: ["image/jpeg", "image/png", "image/gif", "image/webp"],
  })
  @IsString()
  @Matches(/^image\//)
  mime_type!: string;
}

export class ConfirmUploadDto {
  @ApiProperty({
    example: "media/abc123xyz-shrine-photo.jpg",
    description: "R2 object key returned by the upload-url endpoint",
  })
  @IsString()
  key!: string;

  @ApiProperty({ example: "shrine-photo.jpg" })
  @IsString()
  filename!: string;

  @ApiPropertyOptional({ example: "Interior of Imam Zain Al-Abideen shrine" })
  @IsOptional()
  @IsString()
  alt_text?: string;

  @ApiProperty({ example: "image/jpeg", pattern: "^image/" })
  @IsString()
  @Matches(/^image\//)
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
  @ApiPropertyOptional({ example: "updated-filename.jpg" })
  @IsOptional()
  @IsString()
  filename?: string;

  @ApiPropertyOptional({ example: "Updated alt text for accessibility" })
  @IsOptional()
  @IsString()
  alt_text?: string;

  @ApiPropertyOptional({ example: "image/png", pattern: "^image/" })
  @IsOptional()
  @IsString()
  @Matches(/^image\//)
  mime_type?: string;

  @ApiPropertyOptional({ example: 512000, minimum: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  file_size?: number;

  @ApiPropertyOptional({ example: 2560, minimum: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  width?: number;

  @ApiPropertyOptional({ example: 1440, minimum: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  height?: number;
}

export class MediaQueryDto {
  @ApiPropertyOptional({ example: 1, minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ example: 20, minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @ApiPropertyOptional({
    example: "shrine",
    description:
      "Substring search across `filename` and `alt_text` (case-insensitive). Backed by GIN trigram indexes so it stays cheap as the media library grows.",
    maxLength: 200,
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  @ApiPropertyOptional({
    example: "image/jpeg",
    description:
      "Filter by exact MIME type. Common values: `image/jpeg`, `image/png`, `image/webp`, `image/gif`.",
  })
  @IsOptional()
  @IsString()
  @Matches(/^[\w.+-]+\/[\w.+-]+$/)
  mime_type?: string;
}
