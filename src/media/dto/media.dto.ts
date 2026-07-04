import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsInt, IsOptional, IsString, Matches, MaxLength, Min } from "class-validator";
import { PaginationDto } from "../../common/dto/pagination.dto";

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
}

export class MediaQueryDto extends PaginationDto {
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
