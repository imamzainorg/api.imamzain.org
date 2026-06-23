import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ApiEnvelope, ApiPaginatedData } from '../../common/dto/api-envelope';

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

export class UploadUrlResponseDto extends ApiEnvelope(UploadUrlDataDto, 'Upload URL generated') {}

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
      'Pre-generated WebP variants at standard widths (320, 768, 1280, 1920). Up-scaled widths beyond the source resolution are skipped, so smaller originals return fewer variants.\n\n**Note on `POST /media/confirm`:** the confirm response returns `variants: []` because generation runs in the background. Poll `GET /media/:id` (typically 1–3 s later) until the array populates. If it stays empty past ~10 s, call `POST /media/:id/regenerate-variants`.',
  })
  variants: MediaVariantDto[];
}

class MediaListDataDto extends ApiPaginatedData(MediaDto) {}

export class MediaListResponseDto extends ApiEnvelope(MediaListDataDto, 'Media fetched') {}

export class MediaDetailResponseDto extends ApiEnvelope(MediaDto, 'Media fetched') {}

/**
 * Response from `POST /media/confirm`. The media row is created and the
 * response carries an **empty `variants[]` array** — sharp variant
 * generation runs in the background and the variants populate via
 * `GET /media/:id` ~1–3 seconds later. If the CMS needs to render the
 * variants immediately, poll the detail endpoint until
 * `variants.length === 4`; if it stays empty past ~10 s, call
 * `POST /media/:id/regenerate-variants`.
 */
export class MediaCreatedResponseDto extends ApiEnvelope(MediaDto, 'Media created') {}

export class MediaMessageResponseDto extends ApiEnvelope(null, 'Media deleted') {}
