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
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser, CurrentUserPayload } from '../common/decorators/current-user.decorator';
import { Lang } from '../common/decorators/language.decorator';
import { PublicCache } from '../common/decorators/public-cache.decorator';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import {
  ForbiddenErrorDto,
  NotFoundErrorDto,
  UnauthorizedErrorDto,
  ValidationErrorDto,
} from '../common/dto/api-response.dto';
import { PermissionGuard } from '../common/guards/permission.guard';
import { DailyHadithsService } from './daily-hadiths.service';
import {
  CreateDailyHadithDto,
  DailyHadithQueryDto,
  PinDailyHadithDto,
  UpdateDailyHadithDto,
} from './dto/daily-hadith.dto';
import {
  DailyHadithDetailResponseDto,
  DailyHadithListResponseDto,
  DailyHadithMessageResponseDto,
  DailyHadithPinListResponseDto,
  TodayHadithResponseDto,
} from './dto/daily-hadith-response.dto';

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
      'Picks one hadith per UTC calendar day so every visitor sees the same hadith all day. Rotation cycles through active hadiths ordered by `(display_order asc, id asc)` indexed by `daysSinceEpoch % count`. An editor pin for today (via `POST /daily-hadiths/pins`) overrides the rotation for that one day. Returns `data: null` when the table is empty. Response is CDN-cacheable (`public, max-age=900, s-maxage=3600`) and varies by `Accept-Language` — the per-day stable key means a single edge cache serves the whole day.',
  })
  @ApiOkResponse({
    type: TodayHadithResponseDto,
    description: "Today's hadith for the requested language, or null when no active hadiths exist",
  })
  getToday(@Lang() lang: string | null) {
    return this.service.getToday(lang);
  }

  // ── Admin (CMS) ────────────────────────────────────────────────────────

  @Get()
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiBearerAuth('jwt')
  @RequirePermission('daily-hadiths:read')
  @ApiOperation({
    summary: 'List hadiths (admin, paginated)',
    description: 'Returns the full hadith table for the CMS list view. Requires permission: `daily-hadiths:read`.',
  })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20 })
  @ApiQuery({ name: 'is_active', required: false, type: Boolean })
  @ApiOkResponse({ type: DailyHadithListResponseDto, description: 'Paginated hadith list' })
  @ApiBadRequestResponse({ type: ValidationErrorDto, description: 'Invalid query parameters (page < 1, limit out of 1–100, or non-integer values)' })
  @ApiUnauthorizedResponse({ type: UnauthorizedErrorDto, description: 'Missing or invalid JWT' })
  @ApiForbiddenResponse({ type: ForbiddenErrorDto, description: 'Insufficient permissions' })
  findAll(@Query() query: DailyHadithQueryDto, @Lang() lang: string | null) {
    return this.service.findAll(query, lang);
  }

  @Get('pins')
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiBearerAuth('jwt')
  @RequirePermission('daily-hadiths:read')
  @ApiOperation({
    summary: 'List all hadith pins (admin)',
    description: 'Returns every (pin_date, hadith_id) pair currently set. Requires permission: `daily-hadiths:read`.',
  })
  @ApiOkResponse({ type: DailyHadithPinListResponseDto, description: 'All pin entries' })
  @ApiUnauthorizedResponse({ type: UnauthorizedErrorDto, description: 'Missing or invalid JWT' })
  @ApiForbiddenResponse({ type: ForbiddenErrorDto, description: 'Insufficient permissions' })
  listPins() {
    return this.service.listPins();
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiBearerAuth('jwt')
  @RequirePermission('daily-hadiths:read')
  @ApiOperation({
    summary: 'Get a single hadith (admin)',
    description: 'Returns one hadith with all translations. Requires permission: `daily-hadiths:read`.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: DailyHadithDetailResponseDto, description: 'Hadith detail with translations' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No hadith with that ID exists, or it has been deleted' })
  @ApiUnauthorizedResponse({ type: UnauthorizedErrorDto, description: 'Missing or invalid JWT' })
  @ApiForbiddenResponse({ type: ForbiddenErrorDto, description: 'Insufficient permissions' })
  findOne(@Param('id') id: string, @Lang() lang: string | null) {
    return this.service.findOne(id, lang);
  }

  @Post()
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiBearerAuth('jwt')
  @RequirePermission('daily-hadiths:create')
  @ApiOperation({
    summary: 'Create a hadith (admin)',
    description:
      'Creates a new hadith with translations. Exactly one translation must have `is_default: true`. If `display_order` is omitted the server appends to the end so new hadiths land at the tail of the rotation. Requires permission: `daily-hadiths:create`.',
  })
  @ApiCreatedResponse({ type: DailyHadithDetailResponseDto, description: 'Hadith created' })
  @ApiBadRequestResponse({ type: ValidationErrorDto, description: 'Validation failed, or translations did not contain exactly one is_default entry' })
  @ApiUnauthorizedResponse({ type: UnauthorizedErrorDto, description: 'Missing or invalid JWT' })
  @ApiForbiddenResponse({ type: ForbiddenErrorDto, description: 'Insufficient permissions' })
  create(@Body() dto: CreateDailyHadithDto, @CurrentUser() user: CurrentUserPayload) {
    return this.service.create(dto, user.id);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiBearerAuth('jwt')
  @RequirePermission('daily-hadiths:update')
  @ApiOperation({
    summary: 'Update a hadith (admin)',
    description:
      'Update any combination of `display_order`, `is_active`, or upsert translations. If `translations` is provided the single-default invariant is re-asserted after upserts. Requires permission: `daily-hadiths:update`.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: DailyHadithMessageResponseDto, description: 'Hadith updated' })
  @ApiBadRequestResponse({ type: ValidationErrorDto, description: 'Validation failed, or the resulting translations did not contain exactly one is_default entry' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No hadith with that ID exists, or it has been deleted' })
  @ApiUnauthorizedResponse({ type: UnauthorizedErrorDto, description: 'Missing or invalid JWT' })
  @ApiForbiddenResponse({ type: ForbiddenErrorDto, description: 'Insufficient permissions' })
  update(@Param('id') id: string, @Body() dto: UpdateDailyHadithDto, @CurrentUser() user: CurrentUserPayload) {
    return this.service.update(id, dto, user.id);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiBearerAuth('jwt')
  @RequirePermission('daily-hadiths:delete')
  @ApiOperation({
    summary: 'Soft-delete a hadith (admin)',
    description: 'Sets `deleted_at`; the hadith is dropped from rotation immediately. Pins referencing it become inert (cascade FK does not delete pins, but the pin path checks `deleted_at`). Requires permission: `daily-hadiths:delete`.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: DailyHadithMessageResponseDto, description: 'Hadith soft-deleted' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No hadith with that ID exists, or it has already been deleted' })
  @ApiUnauthorizedResponse({ type: UnauthorizedErrorDto, description: 'Missing or invalid JWT' })
  @ApiForbiddenResponse({ type: ForbiddenErrorDto, description: 'Insufficient permissions' })
  remove(@Param('id') id: string, @CurrentUser() user: CurrentUserPayload) {
    return this.service.softDelete(id, user.id);
  }

  // ── Pins (admin) ───────────────────────────────────────────────────────

  @Post('pins')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiBearerAuth('jwt')
  @RequirePermission('daily-hadiths:update')
  @ApiOperation({
    summary: 'Pin a hadith to a specific date (admin)',
    description:
      'Forces a specific hadith to be picked for a specific calendar date, overriding the natural rotation for that one day. Upsert semantics: re-pinning the same date replaces the previous mapping. Pinning an inactive hadith is allowed — the pin overrides `is_active` for that day. Requires permission: `daily-hadiths:update`.',
  })
  @ApiOkResponse({ description: 'Pin created or updated' })
  @ApiBadRequestResponse({ type: ValidationErrorDto, description: 'Validation failed (pin_date must be YYYY-MM-DD)' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No hadith with that ID exists' })
  @ApiUnauthorizedResponse({ type: UnauthorizedErrorDto, description: 'Missing or invalid JWT' })
  @ApiForbiddenResponse({ type: ForbiddenErrorDto, description: 'Insufficient permissions' })
  pin(@Body() dto: PinDailyHadithDto, @CurrentUser() user: CurrentUserPayload) {
    return this.service.createPin(dto, user.id);
  }

  @Delete('pins/:pin_date')
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiBearerAuth('jwt')
  @RequirePermission('daily-hadiths:update')
  @ApiOperation({
    summary: 'Remove a hadith pin (admin)',
    description: 'After removal the natural rotation resumes for that date. Requires permission: `daily-hadiths:update`.',
  })
  @ApiParam({ name: 'pin_date', example: '2026-05-15', description: 'Calendar date (YYYY-MM-DD).' })
  @ApiOkResponse({ type: DailyHadithMessageResponseDto, description: 'Pin removed' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No pin exists for that date' })
  @ApiBadRequestResponse({ type: ValidationErrorDto, description: 'pin_date is not YYYY-MM-DD' })
  @ApiUnauthorizedResponse({ type: UnauthorizedErrorDto, description: 'Missing or invalid JWT' })
  @ApiForbiddenResponse({ type: ForbiddenErrorDto, description: 'Insufficient permissions' })
  unpin(@Param('pin_date') pinDate: string, @CurrentUser() user: CurrentUserPayload) {
    return this.service.deletePin(pinDate, user.id);
  }
}
