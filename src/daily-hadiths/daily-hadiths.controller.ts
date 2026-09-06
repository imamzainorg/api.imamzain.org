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
import { PublicCache } from '../common/decorators/public-cache.decorator';
import {
  ConflictErrorDto,
  NotFoundErrorDto,
  ValidationErrorDto,
} from '../common/dto/api-response.dto';
import { DailyHadithsService } from './daily-hadiths.service';
import { CreateDailyHadithDto, DailyHadithQueryDto, UpdateDailyHadithDto } from './dto/daily-hadith.dto';
import {
  DailyHadithDetailResponseDto,
  DailyHadithListResponseDto,
  DailyHadithMessageResponseDto,
  PublicHadithListResponseDto,
  TodayHadithResponseDto,
} from './dto/daily-hadith-response.dto';
import { PaginationDto } from '../common/dto/pagination.dto';

@ApiTags('Daily Hadiths')
@ApiHeader({ name: 'Accept-Language', required: false, description: 'ISO 639-1 code for translated fields (e.g. ar, en, fa).' })
@Controller('daily-hadiths')
export class DailyHadithsController {
  constructor(private readonly service: DailyHadithsService) {}

  // ── Public ─────────────────────────────────────────────────────────────

  @Get('today')
  @PublicCache(900, 3600)
  @ApiOperation({
    summary: "Today's hadith (public)",
    description:
      "Returns the hadith deliberately scheduled to today's UTC calendar date, if an editor set one. Otherwise falls back to a hadith drawn uniformly at random from every unscheduled hadith. That draw is locked in the first time it happens each day, so every visitor sees the same hadith for the rest of the UTC day regardless of caching or which server instance answers — the draw itself never sets the winning hadith's own `display_date`, only an editor's deliberate action does that. A hadith that's already scheduled to some other date is never eligible as a random filler. Returns `data: null` only when the table is empty or every hadith is scheduled elsewhere. Response is CDN-cacheable (`public, max-age=900, s-maxage=3600`) and varies by `Accept-Language`.",
  })
  @ApiOkResponse({
    type: TodayHadithResponseDto,
    description: "Today's hadith for the requested language, or null when none is available",
  })
  getToday(@Lang() lang: string | null) {
    return this.service.getToday(lang);
  }

  @Get()
  @PublicCache(300, 1800)
  @ApiOperation({
    summary: 'Browse hadiths (public)',
    description:
      'A pure lookup — never falls back to a random pick, that only happens on `/today`. Pass `date` for the single hadith scheduled to that exact day (or nothing, if none is). Pass `from`+`to` for every hadith scheduled within that inclusive range, ordered by date. Pass neither for a plain paginated browse of every hadith, scheduled or not, newest first.',
  })
  @ApiQuery({ name: 'date', required: false, type: String, example: '2026-05-15', description: 'Exact scheduled date. Mutually exclusive with from/to.' })
  @ApiQuery({ name: 'from', required: false, type: String, example: '2026-05-01', description: 'Range start (inclusive). Requires `to`.' })
  @ApiQuery({ name: 'to', required: false, type: String, example: '2026-05-31', description: 'Range end (inclusive). Requires `from`.' })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20 })
  @ApiOkResponse({ type: PublicHadithListResponseDto, description: 'Paginated hadith results' })
  @ApiBadRequestResponse({
    type: ValidationErrorDto,
    description: 'Invalid query: malformed/impossible date, date combined with from/to, from without to (or vice versa), from after to, or invalid pagination',
  })
  findPublic(@Query() query: DailyHadithQueryDto, @Lang() lang: string | null) {
    return this.service.findPublic(query, lang);
  }

  // ── Admin (CMS) ────────────────────────────────────────────────────────

  @Get('admin')
  @Auth('daily-hadiths:read')
  @ApiOperation({
    summary: 'List hadiths (admin, paginated)',
    description: 'Returns the full hadith table for the CMS list view, newest first. Requires permission: `daily-hadiths:read`.',
  })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20 })
  @ApiOkResponse({ type: DailyHadithListResponseDto, description: 'Paginated hadith list' })
  @ApiBadRequestResponse({ type: ValidationErrorDto, description: 'Invalid query parameters (page < 1, limit out of 1–100, or non-integer values)' })
  findAll(@Query() query: PaginationDto, @Lang() lang: string | null) {
    return this.service.findAll(query, lang);
  }

  @Get('admin/:id')
  @Auth('daily-hadiths:read')
  @ApiOperation({
    summary: 'Get a single hadith (admin)',
    description: 'Returns one hadith with all translations. Requires permission: `daily-hadiths:read`.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: DailyHadithDetailResponseDto, description: 'Hadith detail with translations' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No hadith with that ID exists, or it has been deleted' })
  findOne(@Param('id') id: string, @Lang() lang: string | null) {
    return this.service.findOne(id, lang);
  }

  @Get('trash')
  @Auth('daily-hadiths:delete')
  @ApiOperation({
    summary: 'List soft-deleted hadiths (CMS trash view)',
    description: 'Paginated list of hadiths whose `deleted_at` is set. Requires permission: `daily-hadiths:delete`.',
  })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20 })
  @ApiOkResponse({ type: DailyHadithListResponseDto, description: 'Paginated list of trashed hadiths' })
  findTrash(@Query() query: PaginationDto, @Lang() lang: string | null) {
    return this.service.findTrash(query, lang);
  }

  @Post()
  @Auth('daily-hadiths:create')
  @ApiOperation({
    summary: 'Create a hadith (admin)',
    description:
      'Creates a new hadith with translations. `display_date` is optional — set it only when the hadith is deliberately tied to a calendar occasion; omit it to leave the hadith in the unscheduled pool the random daily fallback draws from. Requires permission: `daily-hadiths:create`.',
  })
  @ApiCreatedResponse({ type: DailyHadithDetailResponseDto, description: 'Hadith created' })
  @ApiBadRequestResponse({ type: ValidationErrorDto, description: 'Validation failed' })
  @ApiConflictResponse({ type: ConflictErrorDto, description: 'Another hadith is already scheduled to that display_date' })
  create(@Body() dto: CreateDailyHadithDto, @CurrentUser() user: CurrentUserPayload) {
    return this.service.create(dto, user.id);
  }

  @Patch(':id')
  @Auth('daily-hadiths:update')
  @ApiOperation({
    summary: 'Update a hadith (admin)',
    description:
      'Update `display_date` (set to schedule it to a date, or `null` to unschedule it) and/or upsert translations. Requires permission: `daily-hadiths:update`.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: DailyHadithMessageResponseDto, description: 'Hadith updated' })
  @ApiBadRequestResponse({ type: ValidationErrorDto, description: 'Validation failed' })
  @ApiConflictResponse({ type: ConflictErrorDto, description: 'Another hadith is already scheduled to that display_date' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No hadith with that ID exists, or it has been deleted' })
  update(@Param('id') id: string, @Body() dto: UpdateDailyHadithDto, @CurrentUser() user: CurrentUserPayload) {
    return this.service.update(id, dto, user.id);
  }

  @Delete(':id')
  @Auth('daily-hadiths:delete')
  @ApiOperation({
    summary: 'Soft-delete a hadith (admin)',
    description:
      'Sets `deleted_at`. If the hadith was scheduled to a date, that date immediately becomes available for another hadith to be scheduled to. Requires permission: `daily-hadiths:delete`.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: DailyHadithMessageResponseDto, description: 'Hadith soft-deleted' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No hadith with that ID exists, or it has already been deleted' })
  remove(@Param('id') id: string, @CurrentUser() user: CurrentUserPayload) {
    return this.service.softDelete(id, user.id);
  }

  @Post(':id/restore')
  @HttpCode(200)
  @Auth('daily-hadiths:delete')
  @ApiOperation({
    summary: 'Restore a soft-deleted hadith (admin)',
    description: 'Clears `deleted_at`. Requires permission: `daily-hadiths:delete`.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: DailyHadithMessageResponseDto, description: 'Hadith restored' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No soft-deleted hadith with that ID exists' })
  @ApiConflictResponse({ type: ConflictErrorDto, description: "Another hadith has since been scheduled to this one's display_date" })
  restore(@Param('id') id: string, @CurrentUser() user: CurrentUserPayload) {
    return this.service.restore(id, user.id);
  }
}
