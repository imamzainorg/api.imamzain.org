import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
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
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Auth } from '../common/decorators/auth.decorator';
import { CurrentUser, CurrentUserPayload } from '../common/decorators/current-user.decorator';
import { ConflictErrorDto, ForbiddenErrorDto, NotFoundErrorDto, PayloadTooLargeErrorDto, ValidationErrorDto } from '../common/dto/api-response.dto';
import { ConfirmUploadDto, MediaQueryDto, RequestUploadUrlDto, UpdateMediaDto } from './dto/media.dto';
import {
  MediaCreatedResponseDto,
  MediaDetailResponseDto,
  MediaListResponseDto,
  MediaMessageResponseDto,
  UploadUrlResponseDto,
} from './dto/media-response.dto';
import { MediaService } from './media.service';

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
      'at `media/variants/<mediaId>/w<width>.webp`. Requires permission: `media:create`.',
  })
  @ApiOkResponse({ type: UploadUrlResponseDto, description: 'Returns a pre-signed PUT URL (valid for 15 minutes), the storage key, the planned mediaId, and the per-MIME byte cap' })
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
      'and both originals and variants share the `<mediaId>` folder segment in R2.\n\n' +
      '**Variants are generated in the background.** The response returns immediately with `variants: []`; ' +
      'EXIF-oriented WebP variants (320/768/1280/1920 px) finish populating ~1–3 seconds later. ' +
      'Poll `GET /media/:id` until `variants.length === 4`, or fall back to the original `url` until they land. ' +
      'If they stay empty past ~10 s, call `POST /media/:id/regenerate-variants`. ' +
      'Requires permission: `media:create`.',
  })
  @ApiCreatedResponse({ type: MediaCreatedResponseDto, description: 'Media record registered in the database. Returns the media object with `variants: []` — variants populate asynchronously and become visible on subsequent `GET /media/:id` calls.' })
  @ApiBadRequestResponse({ type: ValidationErrorDto, description: 'Validation failed, the key is not under the managed prefix, or the file was not uploaded to R2' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No pending upload exists for that key — request a new upload URL first' })
  @ApiPayloadTooLargeResponse({ type: PayloadTooLargeErrorDto, description: 'Uploaded file exceeds the per-MIME byte cap (`maxBytes` from the upload-url response); R2 object is purged' })
  confirmUpload(@Body() dto: ConfirmUploadDto, @CurrentUser() user: CurrentUserPayload) {
    return this.mediaService.confirmUpload(dto, user.id);
  }

  @Get()
  @Auth('media:read')
  @ApiOperation({
    summary: 'List all media records (paginated, searchable, filterable)',
    description:
      'CMS media-picker / library view. Supports substring search on `filename` + `alt_text` (case-insensitive, backed by GIN trigram indexes) and exact `mime_type` filter. Requires permission: `media:read`.',
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
  @ApiOkResponse({ type: MediaDetailResponseDto, description: 'Media record detail including filename, MIME type, dimensions, and public CDN URL' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No media record with that ID exists' })
  findOne(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.mediaService.findOne(id);
  }

  @Patch(':id')
  @Auth('media:update')
  @ApiOperation({ summary: 'Update media metadata (filename, alt text, dimensions)', description: 'Requires permission: `media:update`' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: MediaDetailResponseDto, description: 'Updated media record with the new metadata' })
  @ApiBadRequestResponse({ type: ValidationErrorDto, description: 'Validation failed' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No media record with that ID exists' })
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateMediaDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.mediaService.update(id, dto, user.id);
  }

  @Post(':id/regenerate-variants')
  @HttpCode(200)
  @Auth('media:update')
  @ApiOperation({
    summary: 'Re-run sharp variant generation for an existing media row',
    description:
      'Useful when initial generation failed (network blip, large image), or when the variant width set is changed. ' +
      'Generates the standard 320 / 768 / 1280 / 1920 webp variants and upserts the corresponding `media_variants` rows. ' +
      'Requires permission: `media:update`.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: MediaDetailResponseDto, description: 'Media record with the regenerated variants array' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No media record with that ID exists' })
  regenerateVariants(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() user: CurrentUserPayload) {
    return this.mediaService.regenerateVariants(id, user.id);
  }

  @Delete(':id')
  @Auth('media:delete')
  @ApiOperation({
    summary: 'Delete a media record and remove the file from R2',
    description:
      'Fails with 409 if the media is still referenced by a post, book, gallery image, or attachment. ' +
      'Requires permission: `media:delete`',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: MediaMessageResponseDto, description: 'Media record deleted from the database and the file permanently removed from R2 storage — this action is irreversible' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No media record with that ID exists' })
  @ApiConflictResponse({ type: ConflictErrorDto, description: 'Cannot delete: this media file is still referenced by one or more posts, books, gallery images, or attachments — remove those references first' })
  remove(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() user: CurrentUserPayload) {
    return this.mediaService.delete(id, user.id);
  }
}
