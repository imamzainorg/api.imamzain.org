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
import { Auth } from '../common/decorators/auth.decorator';
import { CurrentUser, CurrentUserPayload } from '../common/decorators/current-user.decorator';
import { Lang } from '../common/decorators/language.decorator';
import { ConflictErrorDto, NotFoundErrorDto, ValidationErrorDto } from '../common/dto/api-response.dto';
import { PaginationDto } from '../common/dto/pagination.dto';
import { PublicCache } from '../common/decorators/public-cache.decorator';
import { CreateSpeakerDto, SpeakerQueryDto, UpdateSpeakerDto } from './dto/speaker.dto';
import {
  SpeakerCreatedResponseDto,
  SpeakerDetailResponseDto,
  SpeakerListResponseDto,
  SpeakerMessageResponseDto,
} from './dto/speaker-response.dto';
import { SpeakersService } from './speakers.service';

@ApiTags('Speakers')
@ApiHeader({ name: 'Accept-Language', required: false, description: 'ISO 639-1 code for translated fields (e.g. ar, en)' })
@Controller('speakers')
export class SpeakersController {
  constructor(private readonly service: SpeakersService) {}

  @Get()
  @PublicCache(60, 300)
  @ApiOperation({
    summary: 'List speakers (public, paginated)',
    description: 'Returns non-deleted speakers newest-first, each with the resolved translation and a count of their live published audios. Filter with `?search=`. CDN-cacheable and varies by `Accept-Language`.',
  })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20 })
  @ApiQuery({ name: 'search', required: false, type: String })
  @ApiOkResponse({ type: SpeakerListResponseDto })
  @ApiBadRequestResponse({ type: ValidationErrorDto, description: 'Invalid query parameters' })
  findAll(@Query() query: SpeakerQueryDto, @Lang() lang: string | null) {
    return this.service.findAll(query, lang);
  }

  @Get('trash')
  @Auth('audios:delete')
  @ApiOperation({
    summary: 'List soft-deleted speakers (CMS trash view)',
    description: 'Paginated list of speakers whose `deleted_at` is set. Per-translation slugs are returned with the `__del_<timestamp>` suffix stripped. Requires permission: `audios:delete`.',
  })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20 })
  @ApiOkResponse({ type: SpeakerListResponseDto })
  findTrash(@Query() query: PaginationDto, @Lang() lang: string | null) {
    return this.service.findTrash(query.page ?? 1, query.limit ?? 20, lang);
  }

  @Post()
  @Auth('audios:create')
  @ApiOperation({ summary: 'Create a speaker with translations', description: 'Requires permission: `audios:create`. Exactly one translation must have `is_default: true`.' })
  @ApiCreatedResponse({ type: SpeakerCreatedResponseDto })
  @ApiBadRequestResponse({ type: ValidationErrorDto, description: 'Validation failed' })
  @ApiConflictResponse({ type: ConflictErrorDto, description: 'Duplicate translation language for this speaker' })
  create(@Body() dto: CreateSpeakerDto, @CurrentUser() user: CurrentUserPayload, @Lang() lang: string | null) {
    return this.service.create(dto, user.id, lang);
  }

  @Post(':id/restore')
  @HttpCode(200)
  @Auth('audios:delete')
  @ApiOperation({
    summary: 'Restore a soft-deleted speaker',
    description: 'Clears `deleted_at`. Requires permission: `audios:delete`.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: SpeakerMessageResponseDto })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No soft-deleted speaker with that ID exists' })
  restore(@Param('id') id: string, @CurrentUser() user: CurrentUserPayload) {
    return this.service.restore(id, user.id);
  }

  @Get(':id')
  @PublicCache(60, 300)
  @ApiOperation({
    summary: 'Get a single speaker by ID (public)',
    description: 'Returns the speaker with all translations and a count of live published audios. CDN-cacheable and varies by `Accept-Language`.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: SpeakerDetailResponseDto })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No speaker with that ID exists, or it has been deleted' })
  findOne(@Param('id') id: string, @Lang() lang: string | null) {
    return this.service.findOne(id, lang);
  }

  @Patch(':id')
  @Auth('audios:update')
  @ApiOperation({ summary: 'Update a speaker and upsert translations', description: 'Requires permission: `audios:update`.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: SpeakerDetailResponseDto })
  @ApiBadRequestResponse({ type: ValidationErrorDto, description: 'Validation failed' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No speaker with that ID exists, or it has been deleted' })
  @ApiConflictResponse({ type: ConflictErrorDto, description: 'Duplicate translation language for this speaker' })
  update(@Param('id') id: string, @Body() dto: UpdateSpeakerDto, @CurrentUser() user: CurrentUserPayload, @Lang() lang: string | null) {
    return this.service.update(id, dto, user.id, lang);
  }

  @Delete(':id')
  @Auth('audios:delete')
  @ApiOperation({ summary: 'Soft-delete a speaker', description: 'Sets `deleted_at`. Refused with 409 if live audios still reference it (reassign them first). Requires permission: `audios:delete`.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: SpeakerMessageResponseDto })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No speaker with that ID exists, or it has already been deleted' })
  @ApiConflictResponse({ type: ConflictErrorDto, description: 'The speaker still has audios attributed to it' })
  remove(@Param('id') id: string, @CurrentUser() user: CurrentUserPayload) {
    return this.service.softDelete(id, user.id);
  }
}
