import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiPayloadTooLargeResponse,
  ApiQuery,
  ApiTags,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Auth } from '../common/decorators/auth.decorator';
import { CurrentUser, CurrentUserPayload } from '../common/decorators/current-user.decorator';
import {
  ConflictErrorDto,
  ForbiddenErrorDto,
  NotFoundErrorDto,
  PayloadTooLargeErrorDto,
  TooManyRequestsErrorDto,
  ValidationErrorDto,
} from '../common/dto/api-response.dto';
import { ConfirmUploadDto, MediaQueryDto, RequestUploadUrlDto, UpdateMediaDto } from './dto/media.dto';
import {
  MediaCreatedResponseDto,
  MediaDetailResponseDto,
  MediaListResponseDto,
  MediaMessageResponseDto,
  MediaReferencesResponseDto,
  UploadUrlResponseDto,
} from './dto/media-response.dto';
import { MediaService } from './media.service';

// A malformed `:id` deliberately reaches Prisma (no ParseUUIDPipe): every service
// path here does its first Prisma lookup before touching storage or sharp, and the
// P2023 that comes back is answered as INVALID_IDENTIFIER by the exception filter,
// like every other resource route.
@ApiTags('Media')
@Controller('media')
export class MediaController {
  constructor(private readonly mediaService: MediaService) {}

  @Post('upload-url')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Auth('media:create')
  @ApiOperation({
    summary: 'Request a pre-signed R2 upload URL',
    description:
      'Step 1 of the two-step upload flow. Use the returned `uploadUrl` to PUT the file directly to R2, ' +
      'then call `POST /media/confirm` with the returned `key`. Allowed MIME types: ' +
      '`image/jpeg`, `image/png`, `image/gif`, `image/webp` (max **25 MB** each — exposed as `maxBytes` ' +
      'in the response so the CMS should validate before starting the PUT). The signed URL is bound to the ' +
      'requesting user — only that user can confirm the upload. The response also includes the ' +
      '`mediaId` that will be created at confirm time, so the CMS can stage references while the ' +
      'upload is in flight. R2 layout: originals at `media/originals/<mediaId>/<slug>.<ext>`; variants ' +
      'at `media/variants/<mediaId>/w<width>.webp`. The URL and the pending upload it belongs to both expire ' +
      '15 minutes after issue. Requires permission: `media:create`.',
  })
  @ApiOkResponse({ type: UploadUrlResponseDto, description: 'Returns a pre-signed PUT URL (valid for at most 15 minutes), the storage key, the planned mediaId, and the per-MIME byte cap' })
  @ApiBadRequestResponse({ type: ValidationErrorDto, description: 'Validation failed, or MIME type not in the allowlist' })
  requestUploadUrl(@Body() dto: RequestUploadUrlDto, @CurrentUser() user: CurrentUserPayload) {
    return this.mediaService.requestUploadUrl(dto, user.id);
  }

  @Post('confirm')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @HttpCode(201)
  // Listed above @Auth so this route-specific 403 wins over the decorator's
  // standard "Insufficient permissions" text (topmost same-status ApiResponse
  // takes precedence in @nestjs/swagger).
  @ApiForbiddenResponse({ type: ForbiddenErrorDto, description: 'The key was issued to a different user' })
  @Auth('media:create')
  @ApiOperation({
    summary: 'Confirm an upload and register the media record',
    description:
      'Step 2 of the two-step upload flow. Call after successfully PUTting the file to R2 using the signed URL. ' +
      'The server verifies the key is one this user requested via `/media/upload-url`, and authoritatively reads ' +
      'the actual stored Content-Type and Content-Length from R2 (client-supplied values are not trusted). ' +
      'If the stored size exceeds the per-MIME cap (currently 25 MB for images) the R2 object is deleted and ' +
      'a 413 is returned. On success the media row is created with the same `mediaId` baked into the upload key, ' +
      'and both originals and variants share the `<mediaId>` folder segment in R2. The `width` / `height` on the ' +
      'row come from the file itself (EXIF-orientation aware), not from the values the client declared.\n\n' +
      '**Variants are generated in the background.** The response returns immediately with `variants: []`; ' +
      'EXIF-oriented WebP variants (at most 320/768/1280/1920 px, and never wider than the original) finish ' +
      'populating ~1–3 seconds later. The response says which widths to expect (`planned_widths`) and where they ' +
      'are (`variants_status`, `processing` at this point). **Poll `GET /media/:id` until `variants_status` is no ' +
      'longer `processing`** — never wait for `variants.length === 4`, since an original narrower than 1920 px ' +
      'legitimately has fewer variants. `partial` (still incomplete after 2 minutes) is the cue to offer ' +
      '`POST /media/:id/regenerate-variants`; `unavailable` / `not_applicable` mean use the original `url`. ' +
      'While the variants are built, the original is also rewritten without its EXIF / XMP / IPTC metadata (GPS, ' +
      'camera serials): same format and Content-Type, orientation baked in, so `file_size` can change a moment ' +
      'after confirm. Requires permission: `media:create`.',
  })
  @ApiCreatedResponse({ type: MediaCreatedResponseDto, description: 'Media record registered in the database. Returns the media object with `variants: []`, `planned_widths` and `variants_status: "processing"` (or `unavailable` / `TOO_SMALL` when the original is under 321 px) — variants populate asynchronously and become visible on subsequent `GET /media/:id` calls.' })
  @ApiBadRequestResponse({ type: ValidationErrorDto, description: 'Validation failed, the key is not under the managed prefix, the file was not uploaded to R2, or the stored object is not a real jpeg/png/gif/webp image' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No pending upload exists for that key — request a new upload URL first' })
  @ApiPayloadTooLargeResponse({ type: PayloadTooLargeErrorDto, description: 'Uploaded file exceeds the per-MIME byte cap (`maxBytes` from the upload-url response); the R2 object is deleted' })
  confirmUpload(@Body() dto: ConfirmUploadDto, @CurrentUser() user: CurrentUserPayload) {
    return this.mediaService.confirmUpload(dto, user.id);
  }

  @Get()
  @Auth('media:read')
  @ApiOperation({
    summary: 'List all media records (paginated, searchable, filterable)',
    description:
      'CMS media-picker / library view. Supports substring search on `filename` + `alt_text` (case-insensitive, backed by GIN trigram indexes) and exact `mime_type` filter. Every item carries `variants`, `planned_widths` and `variants_status`. Requires permission: `media:read`.',
  })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1, description: 'Page number (default: 1)' })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20, description: 'Items per page (default: 20, max: 100)' })
  @ApiQuery({ name: 'search', required: false, type: String, example: 'shrine', description: 'Substring match on filename + alt_text' })
  @ApiQuery({ name: 'mime_type', required: false, type: String, example: 'image/jpeg', description: 'Exact mime type filter' })
  @ApiOkResponse({ type: MediaListResponseDto, description: 'Paginated list of media records' })
  @ApiBadRequestResponse({ type: ValidationErrorDto, description: 'Invalid query parameters (page < 1, limit out of 1–100, or non-integer values)' })
  findAll(@Query() query: MediaQueryDto) {
    return this.mediaService.findAll(query);
  }

  @Get(':id')
  @Auth('media:read')
  @ApiOperation({ summary: 'Get a single media record', description: 'Requires permission: `media:read`' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: MediaDetailResponseDto, description: 'Media record detail including filename, MIME type, dimensions, public CDN URL, the variants, `planned_widths` and `variants_status`' })
  @ApiBadRequestResponse({ type: ValidationErrorDto, description: 'Malformed id (`code: INVALID_IDENTIFIER`)' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No media record with that ID exists' })
  findOne(@Param('id') id: string) {
    return this.mediaService.findOne(id);
  }

  @Get(':id/references')
  @Auth('media:read')
  @ApiOperation({
    summary: 'List the records that still use a media file',
    description:
      'The answer to a `409 MEDIA_IN_USE` from `DELETE /media/:id`: every post (cover, attachment, og:image), book (cover, og:image), ' +
      'static page (og:image) and gallery item (the item itself, or its og:image) that references the file. Records in the trash ' +
      'are included and flagged `trashed: true` — they keep their reference until the image is changed on the record itself. ' +
      'Capped at 20 entries (`total` is the real count, `truncated` says whether the list is cut). A gallery item uses the ' +
      'media id as its primary key: a `gallery_image` entry with this media\'s own id means the file IS that gallery item. ' +
      'Requires permission: `media:read`.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: MediaReferencesResponseDto, description: 'Referencing records (possibly empty — then the media can be deleted)' })
  @ApiBadRequestResponse({ type: ValidationErrorDto, description: 'Malformed id (`code: INVALID_IDENTIFIER`)' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No media record with that ID exists' })
  findReferences(@Param('id') id: string) {
    return this.mediaService.findReferences(id);
  }

  @Patch(':id')
  @Auth('media:update')
  @ApiOperation({ summary: 'Update media metadata (filename, alt text)', description: 'Requires permission: `media:update`' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: MediaDetailResponseDto, description: 'Updated media record with the new metadata' })
  @ApiBadRequestResponse({ type: ValidationErrorDto, description: 'Validation failed, or malformed id (`code: INVALID_IDENTIFIER`)' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No media record with that ID exists' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateMediaDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.mediaService.update(id, dto, user.id);
  }

  @Post(':id/regenerate-variants')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  @Auth('media:update')
  @ApiOperation({
    summary: 'Re-run sharp variant generation for an existing media row',
    description:
      'Useful when initial generation failed (network blip, large image), or when the variant width set is changed. ' +
      'Generates the standard 320 / 768 / 1280 / 1920 webp variants that are narrower than the original and upserts the ' +
      'corresponding `media_variants` rows; the stored `width` / `height` are corrected to the real, EXIF-oriented size, and ' +
      'an original that still carries EXIF / XMP / IPTC metadata is rewritten without it. It shares the upload pipeline\'s ' +
      'concurrency gate, so the call can wait behind other image work. **It answers 200 even when no variants can be made** — ' +
      'read `variants_status` and `variants_status_reason`: `unavailable` + `ORIGINAL_MISSING` (the file is not in storage, ' +
      'typical of legacy rows), `unavailable` + `TOO_SMALL` (under 321 px), `unavailable` + `UNREADABLE`, or `not_applicable` ' +
      '+ `ANIMATED` (animated GIFs keep the original as their only rendition). Requires permission: `media:update`.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: MediaDetailResponseDto, description: 'Media record with the current variants array, `planned_widths` and the definitive `variants_status`' })
  @ApiBadRequestResponse({ type: ValidationErrorDto, description: 'Malformed id (`code: INVALID_IDENTIFIER`)' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No media record with that ID exists' })
  @ApiTooManyRequestsResponse({ type: TooManyRequestsErrorDto, description: 'Rate limit exceeded — maximum 10 requests per minute per IP' })
  regenerateVariants(@Param('id') id: string, @CurrentUser() user: CurrentUserPayload) {
    return this.mediaService.regenerateVariants(id, user.id);
  }

  @Delete(':id')
  @Auth('media:delete')
  @ApiOperation({
    summary: 'Delete a media record and remove the file from R2',
    description:
      'Fails with `409 MEDIA_IN_USE` if the media is still referenced by a post, book, static page, gallery item or attachment — ' +
      'including one in the trash; the message names the first few, and `GET /media/:id/references` lists them all. ' +
      'The database row is the authoritative record: it is only deleted after a final check (inside the same transaction) ' +
      'confirms nothing references it any more, so a reference added at the last moment always wins and the row survives. ' +
      'The R2 file is removed only after that row deletion commits, on a best-effort basis — a storage failure at that point ' +
      'is logged for follow-up but does not fail the request, since the record the caller asked to delete is already gone. ' +
      'Requires permission: `media:delete`',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: MediaMessageResponseDto, description: 'Media record deleted from the database; the file is also removed from R2 storage unless that step failed (logged server-side) — this action is irreversible' })
  @ApiBadRequestResponse({ type: ValidationErrorDto, description: 'Malformed id (`code: INVALID_IDENTIFIER`)' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No media record with that ID exists' })
  @ApiConflictResponse({ type: ConflictErrorDto, description: 'Cannot delete (`code: MEDIA_IN_USE`): this media file is still referenced by one or more posts, books, static pages, gallery items or attachments — remove those references first' })
  remove(@Param('id') id: string, @CurrentUser() user: CurrentUserPayload) {
    return this.mediaService.delete(id, user.id);
  }
}
