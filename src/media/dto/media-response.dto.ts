import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationMetaDto } from '../../common/dto/api-response.dto';

class UploadUrlDataDto {
  @ApiProperty({ example: 'https://bucket.r2.cloudflarestorage.com/upload?...' })
  uploadUrl: string;

  @ApiProperty({ example: 'media/originals/9c8d4f7a-1b2e-4c5d-9e6f-7a8b9c0d1e2f/shrine-photo.jpg' })
  key: string;

  @ApiProperty({
    example: '9c8d4f7a-1b2e-4c5d-9e6f-7a8b9c0d1e2f',
    description:
      'The media row id that will be created on `POST /media/confirm`. Available before the PUT so the CMS can stage references (e.g. wire it into a draft post body) while the upload is in flight.',
  })
  mediaId: string;

  @ApiProperty({
    example: 26214400,
    description:
      'Hard upper bound on the bytes the client may PUT to `uploadUrl`. Validate client-side before starting the PUT — anything larger is rejected at `/media/confirm` with 413 and the R2 object is purged. Per-MIME (currently 25 MB for all image types).',
  })
  maxBytes: number;
}

export class UploadUrlResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
  timestamp: string;

  @ApiProperty({ example: 'Upload URL generated' })
  message: string;

  @ApiProperty({ type: UploadUrlDataDto })
  data: UploadUrlDataDto;
}

class MediaVariantDto {
  @ApiProperty({ example: 768, description: 'Output width in pixels' })
  width: number;

  @ApiProperty({ example: 'https://cdn.imamzain.org/media/variants/<uuid>/w768.webp' })
  url: string;

  @ApiProperty({ example: 24576, description: 'Variant file size in bytes' })
  file_size: number;

  @ApiProperty({ example: 'webp' })
  format: string;
}

class MediaDto {
  @ApiProperty({ example: 'uuid-...' })
  id: string;

  @ApiProperty({ example: 'image.jpg' })
  filename: string;

  @ApiProperty({ example: 'https://cdn.imamzain.org/media/<uuid>-image.jpg' })
  url: string;

  @ApiProperty({ example: 'image/jpeg' })
  mime_type: string;

  @ApiProperty({ example: 204800 })
  file_size: number;

  @ApiPropertyOptional({ example: 'صورة توضيحية' })
  alt_text?: string;

  @ApiPropertyOptional({ example: 1920 })
  width?: number;

  @ApiPropertyOptional({ example: 1080 })
  height?: number;

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
  created_at: string;

  @ApiProperty({
    type: [MediaVariantDto],
    description:
      'Pre-generated WebP variants at standard widths (320, 768, 1280, 1920). Up-scaled widths beyond the source resolution are skipped, so smaller originals return fewer variants. Empty array if generation failed and has not been retried via POST /media/:id/regenerate-variants.',
  })
  variants: MediaVariantDto[];
}

class MediaListDataDto {
  @ApiProperty({ type: [MediaDto] })
  items: MediaDto[];

  @ApiProperty({ type: PaginationMetaDto })
  pagination: PaginationMetaDto;
}

export class MediaListResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
  timestamp: string;

  @ApiProperty({ example: 'Media fetched' })
  message: string;

  @ApiProperty({ type: MediaListDataDto })
  data: MediaListDataDto;
}

export class MediaDetailResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
  timestamp: string;

  @ApiProperty({ example: 'Media fetched' })
  message: string;

  @ApiProperty({ type: MediaDto })
  data: MediaDto;
}

export class MediaCreatedResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
  timestamp: string;

  @ApiProperty({ example: 'Media created' })
  message: string;

  @ApiProperty({ type: MediaDto })
  data: MediaDto;
}

export class MediaMessageResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
  timestamp: string;

  @ApiProperty({ example: 'Media deleted' })
  message: string;

  @ApiProperty({ type: Object, nullable: true, example: null })
  data: null;
}
