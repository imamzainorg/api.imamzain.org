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

const VARIANTS_STATUSES = ['ready', 'processing', 'partial', 'unavailable', 'not_applicable'] as const;
const VARIANTS_STATUS_REASONS = [
  'ORIGINAL_MISSING',
  'TOO_SMALL',
  'ANIMATED',
  'NON_RASTER',
  'UNREADABLE',
  'GENERATION_INCOMPLETE',
] as const;

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
      'Pre-generated WebP variants at standard widths (320, 768, 1280, 1920). Up-scaled widths beyond the source resolution are skipped, so smaller originals return fewer variants — **never compare the length to 4**; compare it to `planned_widths` or read `variants_status`.\n\n**Note on `POST /media/confirm`:** the confirm response returns `variants: []` because generation runs in the background. Poll `GET /media/:id` (typically 1–3 s later) until `variants_status` is no longer `processing`.',
  })
  variants: MediaVariantDto[];

  @ApiProperty({
    type: [Number],
    example: [320, 768],
    description:
      'The variant widths the pipeline produces for THIS original: the standard widths strictly smaller than the original itself, or `[]` when none apply (too small, animated, non-raster). Present on `POST /media/confirm`, `GET /media`, `GET /media/:id` and `POST /media/:id/regenerate-variants` (not on `PATCH /media/:id`, which returns the bare row).',
  })
  planned_widths: number[];

  @ApiProperty({
    enum: VARIANTS_STATUSES,
    example: 'ready',
    description:
      'Where the variants are. **`ready`**: every planned width has a variant. **`processing`**: some are still missing and the upload is less than 2 minutes old — keep polling. **`partial`**: some are missing after those 2 minutes (generation failed, or the original is missing from storage — `POST /media/:id/regenerate-variants` gives the definitive answer). **`unavailable`**: no variants can be produced — see `variants_status_reason`; use the original `url`. **`not_applicable`**: the file is animated or not a raster image; the original is the only rendition. Rule for clients: poll until `variants_status !== "processing"`, then use `variants` when `ready`/`partial`, otherwise the original `url`.',
  })
  variants_status: (typeof VARIANTS_STATUSES)[number];

  @ApiPropertyOptional({
    enum: VARIANTS_STATUS_REASONS,
    example: 'TOO_SMALL',
    description:
      'Why the status is not simply `ready`/`processing`. `ORIGINAL_MISSING`: the file is not in storage (typical of legacy rows) — re-upload it. `TOO_SMALL`: the original is not wider than the smallest variant (320 px). `ANIMATED`: an animated image — variants would freeze it to one frame, so none are made (for a GIF that ends up with no variants after the processing window this is inferred; regenerate reports it exactly). `NON_RASTER`: not jpeg/png/gif/webp. `UNREADABLE`: the file could not be decoded. `GENERATION_INCOMPLETE`: some variants failed to generate.',
  })
  variants_status_reason?: (typeof VARIANTS_STATUS_REASONS)[number];
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
 * `variants_status !== "processing"` (never `variants.length === 4`: smaller
 * originals legitimately have fewer variants — see `planned_widths`).
 */
export class MediaCreatedResponseDto extends ApiEnvelope(MediaDto, 'Media created') {}

export class MediaMessageResponseDto extends ApiEnvelope(null, 'Media deleted') {}

class MediaReferenceDto {
  @ApiProperty({ enum: ['post', 'book', 'static_page', 'gallery_image'], example: 'post' })
  type: 'post' | 'book' | 'static_page' | 'gallery_image';

  @ApiProperty({
    example: '9c8d4f7a-1b2e-4c5d-9e6f-7a8b9c0d1e2f',
    description:
      'Id of the referencing resource. For `gallery_image` this is the media id itself: a gallery item uses the media id as its primary key.',
  })
  id: string;

  @ApiProperty({
    enum: ['cover_image', 'attachment', 'og_image', 'gallery_item'],
    example: 'cover_image',
    description: 'How the resource uses the media',
  })
  field: 'cover_image' | 'attachment' | 'og_image' | 'gallery_item';

  @ApiPropertyOptional({ example: 'ar', description: 'Language of the translation holding an `og_image` reference' })
  lang?: string;

  @ApiProperty({
    example: false,
    description: 'The referencing resource is in the trash. It still holds the reference until the image is changed on the record itself.',
  })
  trashed: boolean;
}

class MediaReferencesDataDto {
  @ApiProperty({ example: '9c8d4f7a-1b2e-4c5d-9e6f-7a8b9c0d1e2f' })
  media_id: string;

  @ApiProperty({ example: 3, description: 'How many records reference this media in total' })
  total: number;

  @ApiProperty({ example: 3, description: 'How many of them are listed in `items` (the list is capped at 20)' })
  shown: number;

  @ApiProperty({ example: false, description: 'True when `total` is larger than `shown`' })
  truncated: boolean;

  @ApiProperty({ type: [MediaReferenceDto] })
  items: MediaReferenceDto[];
}

export class MediaReferencesResponseDto extends ApiEnvelope(MediaReferencesDataDto, 'Media references fetched') {}
