import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Auth } from '../common/decorators/auth.decorator';
import { CurrentUser, CurrentUserPayload } from '../common/decorators/current-user.decorator';
import { Lang } from '../common/decorators/language.decorator';
import { ConflictErrorDto, NotFoundErrorDto, ValidationErrorDto } from '../common/dto/api-response.dto';
import { PaginationDto } from '../common/dto/pagination.dto';
import { PublicCache } from '../common/decorators/public-cache.decorator';
import {
  AudioAdminQueryDto,
  AudioQueryDto,
  CreateAudioDto,
  RequestAudioUploadUrlDto,
  ToggleAudioPublishDto,
  UpdateAudioDto,
} from './dto/audio.dto';
import {
  AudioCreatedResponseDto,
  AudioDetailResponseDto,
  AudioListResponseDto,
  AudioMessageResponseDto,
  AudioUploadUrlResponseDto,
} from './dto/audio-response.dto';
import { AudiosService } from './audios.service';

@ApiTags('Audios')
@ApiHeader({ name: 'Accept-Language', required: false, description: 'ISO 639-1 code for translated fields (e.g. ar, en)' })
@Controller('audios')
export class AudiosController {
  constructor(private readonly service: AudiosService) {}

  @Get()
  @PublicCache(60)
  @ApiOperation({
    summary: 'List published audios (public, paginated)',
    description:
      'Returns published, non-deleted audios newest-first. Filter with `?speaker_id=` and `?search=` (title + speaker name). **List payload drops `peaks`** — call the detail endpoint for the waveform. CDN-cacheable and varies by `Accept-Language`.',
  })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20 })
  @ApiQuery({ name: 'speaker_id', required: false, type: String })
  @ApiQuery({ name: 'search', required: false, type: String })
  @ApiOkResponse({ type: AudioListResponseDto })
  @ApiBadRequestResponse({ type: ValidationErrorDto, description: 'Invalid query parameters' })
  findAllPublic(@Query() query: AudioQueryDto, @Lang() lang: string | null) {
    return this.service.findAllPublic(query, lang);
  }

  @Get('admin')
  @Auth('audios:read')
  @ApiOperation({
    summary: 'List audios (CMS — includes drafts)',
    description: 'Admin list returning published and unpublished audios. Optional `is_published`, `speaker_id`, `search` filters. Requires permission: `audios:read`.',
  })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20 })
  @ApiQuery({ name: 'speaker_id', required: false, type: String })
  @ApiQuery({ name: 'search', required: false, type: String })
  @ApiQuery({ name: 'is_published', required: false, type: Boolean })
  @ApiOkResponse({ type: AudioListResponseDto })
  findAllAdmin(@Query() query: AudioAdminQueryDto, @Lang() lang: string | null) {
    return this.service.findAllAdmin(query, lang);
  }

  @Get('admin/:id')
  @Auth('audios:read')
  @ApiOperation({
    summary: 'Get a single audio by ID (CMS — includes drafts)',
    description: 'Admin detail that returns the audio regardless of its published state. Requires permission: `audios:read`.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: AudioDetailResponseDto })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No audio with that ID exists, or it has been deleted' })
  findOneAdmin(@Param('id') id: string, @Lang() lang: string | null) {
    return this.service.findOne(id, lang, { allowUnpublished: true });
  }

  @Get('trash')
  @Auth('audios:delete')
  @ApiOperation({
    summary: 'List soft-deleted audios (CMS trash view)',
    description: 'Paginated list of audios whose `deleted_at` is set. Per-translation slugs are returned with the `__del_<timestamp>` suffix stripped. Requires permission: `audios:delete`.',
  })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20 })
  @ApiOkResponse({ type: AudioListResponseDto })
  findTrash(@Query() query: PaginationDto, @Lang() lang: string | null) {
    return this.service.findTrash(query.page ?? 1, query.limit ?? 20, lang);
  }

  @Get('by-slug/:slug')
  @PublicCache(60, 300)
  @ApiOperation({
    summary: 'Get a single audio by slug (public)',
    description: 'Resolves a published audio by an editor-assigned translation slug, regardless of the visitor\'s Accept-Language — the display translation still respects Accept-Language. 404 if no live audio owns that slug. CDN-cacheable.',
  })
  @ApiParam({ name: 'slug', example: 'lecture-imam-sajjad' })
  @ApiOkResponse({ type: AudioDetailResponseDto })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No published audio owns that slug' })
  findBySlug(@Param('slug') slug: string, @Lang() lang: string | null) {
    return this.service.findBySlug(slug, lang);
  }

  @Post('upload-url')
  @Auth('audios:create')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Request a pre-signed R2 upload URL for an audio file or PDF',
    description:
      'PUT the file directly to R2 with the returned `uploadUrl`, then save `publicUrl` onto the audio record (no confirm step). ' +
      'You MUST send the same `Content-Type` header on the PUT as declared here, or R2 rejects it with 403. ' +
      'Allowed: audio/mpeg, audio/mp4, audio/x-m4a (≤ 300 MB), application/pdf (≤ 50 MB). `maxBytes` is advisory (validate before PUT). Requires permission: `audios:create`.',
  })
  @ApiOkResponse({ type: AudioUploadUrlResponseDto })
  @ApiBadRequestResponse({ type: ValidationErrorDto, description: 'Disallowed MIME type or missing fields' })
  requestUploadUrl(@Body() dto: RequestAudioUploadUrlDto) {
    return this.service.requestAudioUploadUrl(dto);
  }

  @Post()
  @Auth('audios:create')
  @ApiOperation({ summary: 'Create an audio record', description: 'Requires permission: `audios:create`. Exactly one translation must have `is_default: true`.' })
  @ApiCreatedResponse({ type: AudioCreatedResponseDto })
  @ApiBadRequestResponse({ type: ValidationErrorDto, description: 'Validation failed' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'The provided speaker_id does not match a live speaker' })
  @ApiConflictResponse({ type: ConflictErrorDto, description: 'An audio translation slug is already in use' })
  create(@Body() dto: CreateAudioDto, @CurrentUser() user: CurrentUserPayload, @Lang() lang: string | null) {
    return this.service.create(dto, user.id, lang);
  }

  @Post(':id/restore')
  @HttpCode(200)
  @Auth('audios:delete')
  @ApiOperation({
    summary: 'Restore a soft-deleted audio',
    description: 'Clears `deleted_at` and reverses each translation slug suffix. 409 if an original slug was claimed meanwhile. Requires permission: `audios:delete`.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: AudioMessageResponseDto })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No soft-deleted audio with that ID exists' })
  @ApiConflictResponse({ type: ConflictErrorDto, description: 'A live audio has taken the restored slug' })
  restore(@Param('id') id: string, @CurrentUser() user: CurrentUserPayload) {
    return this.service.restore(id, user.id);
  }

  @Get(':id')
  @PublicCache(60)
  @ApiOperation({
    summary: 'Get a single published audio by ID (public)',
    description: 'Returns the full audio record including the `peaks` waveform. Published rows only. CDN-cacheable and varies by `Accept-Language`.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: AudioDetailResponseDto })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No published audio with that ID exists' })
  findOne(@Param('id') id: string, @Lang() lang: string | null) {
    return this.service.findOne(id, lang);
  }

  @Patch(':id')
  @Auth('audios:update')
  @ApiOperation({ summary: 'Update an audio record and upsert translations', description: 'Requires permission: `audios:update`.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: AudioDetailResponseDto })
  @ApiBadRequestResponse({ type: ValidationErrorDto, description: 'Validation failed' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No audio with that ID exists, the speaker_id is unknown, or it has been deleted' })
  @ApiConflictResponse({ type: ConflictErrorDto, description: 'An audio translation slug is already in use' })
  update(@Param('id') id: string, @Body() dto: UpdateAudioDto, @CurrentUser() user: CurrentUserPayload, @Lang() lang: string | null) {
    return this.service.update(id, dto, user.id, lang);
  }

  @Patch(':id/publish')
  @Auth('audios:update')
  @ApiOperation({ summary: 'Publish or unpublish an audio', description: 'Requires permission: `audios:update`.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: AudioDetailResponseDto })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No audio with that ID exists, or it has been deleted' })
  togglePublish(@Param('id') id: string, @Body() dto: ToggleAudioPublishDto, @CurrentUser() user: CurrentUserPayload, @Lang() lang: string | null) {
    return this.service.togglePublish(id, dto, user.id, lang);
  }

  @Delete(':id')
  @Auth('audios:delete')
  @ApiOperation({ summary: 'Soft-delete an audio', description: 'Sets `deleted_at` and suffixes each translation slug so it can be reused. Restore is reversible. Requires permission: `audios:delete`.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: AudioMessageResponseDto })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No audio with that ID exists, or it has already been deleted' })
  remove(@Param('id') id: string, @CurrentUser() user: CurrentUserPayload) {
    return this.service.softDelete(id, user.id);
  }
}
