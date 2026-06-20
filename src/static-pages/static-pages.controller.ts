import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
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
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { ConflictErrorDto, ForbiddenErrorDto, NotFoundErrorDto, UnauthorizedErrorDto, ValidationErrorDto } from '../common/dto/api-response.dto';
import { PaginationDto } from '../common/dto/pagination.dto';
import { PublicCache } from '../common/decorators/public-cache.decorator';
import { PermissionGuard } from '../common/guards/permission.guard';
import { CreateStaticPageDto, StaticPageQueryDto, TogglePublishStaticPageDto, UpdateStaticPageDto } from './dto/static-page.dto';
import {
  StaticPageCreatedResponseDto,
  StaticPageDetailResponseDto,
  StaticPageListResponseDto,
  StaticPageMessageResponseDto,
} from './dto/static-page-response.dto';
import { StaticPagesService } from './static-pages.service';

@ApiTags('Static Pages')
@ApiHeader({ name: 'Accept-Language', required: false, description: 'ISO 639-1 code for translated fields (e.g. ar, en)' })
@Controller('static-pages')
export class StaticPagesController {
  constructor(private readonly service: StaticPagesService) {}

  @Get()
  @PublicCache(300, 1800)
  @ApiOperation({
    summary: 'List published static pages (public, paginated)',
    description:
      'Returns pages that are published and not soft-deleted, ordered by `display_order`. Use Accept-Language to get translated title/slug/body. Response is CDN-cacheable (`public, max-age=300, s-maxage=1800`) and varies by `Accept-Language`.',
  })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20 })
  @ApiOkResponse({ type: StaticPageListResponseDto, description: 'Paginated list of static pages' })
  @ApiBadRequestResponse({ type: ValidationErrorDto, description: 'Invalid query parameters' })
  findAllPublic(@Lang() lang: string | null, @Query() query: PaginationDto) {
    return this.service.findAllPublic(lang, query.page ?? 1, query.limit ?? 20);
  }

  @Get('admin')
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiBearerAuth('jwt')
  @RequirePermission('static-pages:read')
  @ApiOperation({
    summary: 'List static pages (CMS — includes drafts)',
    description: 'Admin list that returns both published and unpublished pages. Optional `is_published` filter narrows the set. Requires permission: `static-pages:read`.',
  })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20 })
  @ApiQuery({ name: 'is_published', required: false, type: Boolean })
  @ApiOkResponse({ type: StaticPageListResponseDto, description: 'Paginated list of static pages' })
  @ApiBadRequestResponse({ type: ValidationErrorDto, description: 'Invalid query parameters' })
  @ApiUnauthorizedResponse({ type: UnauthorizedErrorDto, description: 'Missing or invalid JWT' })
  @ApiForbiddenResponse({ type: ForbiddenErrorDto, description: 'Insufficient permissions' })
  findAllAdmin(@Lang() lang: string | null, @Query() query: StaticPageQueryDto) {
    return this.service.findAllAdmin(lang, query);
  }

  @Get('admin/:id')
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiBearerAuth('jwt')
  @RequirePermission('static-pages:read')
  @ApiOperation({
    summary: 'Get a single static page by ID (CMS — includes drafts)',
    description:
      'Admin detail that returns the page regardless of its published state, so the CMS can open an unpublished draft for editing. Requires permission: `static-pages:read`.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: StaticPageDetailResponseDto, description: 'Static page detail with translations' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No static page with that ID exists, or it has been deleted' })
  @ApiUnauthorizedResponse({ type: UnauthorizedErrorDto, description: 'Missing or invalid JWT' })
  @ApiForbiddenResponse({ type: ForbiddenErrorDto, description: 'Insufficient permissions' })
  findOneAdmin(@Param('id') id: string, @Lang() lang: string | null) {
    return this.service.findOne(id, lang, { allowUnpublished: true });
  }

  @Get('trash')
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiBearerAuth('jwt')
  @RequirePermission('static-pages:delete')
  @ApiOperation({
    summary: 'List soft-deleted static pages (CMS trash view)',
    description:
      'Paginated list of pages whose `deleted_at` is set. Translation slugs come back with the `__del_<timestamp>` suffix already stripped so the CMS can show the original slug. Requires permission: `static-pages:delete`.',
  })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20 })
  @ApiOkResponse({ type: StaticPageListResponseDto, description: 'Paginated list of trashed static pages' })
  @ApiUnauthorizedResponse({ type: UnauthorizedErrorDto, description: 'Missing or invalid JWT' })
  @ApiForbiddenResponse({ type: ForbiddenErrorDto, description: 'Insufficient permissions' })
  findTrash(@Query() query: PaginationDto) {
    return this.service.findTrash(query.page ?? 1, query.limit ?? 20);
  }

  @Get('by-slug/:slug')
  @PublicCache(300, 1800)
  @ApiOperation({
    summary: 'Get a single static page by slug (public)',
    description:
      'Slug is unique per language. The page resolves regardless of the visitor\'s Accept-Language — the canonical page must always be reachable; the display translation still respects Accept-Language. Response is CDN-cacheable.',
  })
  @ApiParam({ name: 'slug', example: 'imam-zain-biography' })
  @ApiOkResponse({ type: StaticPageDetailResponseDto, description: 'Static page detail with translations' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No published page owns that slug' })
  findBySlug(@Param('slug') slug: string, @Lang() lang: string | null) {
    return this.service.findBySlug(slug, lang);
  }

  @Post(':id/restore')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiBearerAuth('jwt')
  @RequirePermission('static-pages:delete')
  @ApiOperation({
    summary: 'Restore a soft-deleted static page',
    description:
      'Sets `deleted_at` back to null and unsuffixes each translation slug. Fails with 409 if any of the original `(lang, slug)` pairs has been claimed by another page in the meantime — rename the conflicting one first. Requires permission: `static-pages:delete`.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: StaticPageMessageResponseDto, description: 'Static page restored' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No soft-deleted page with that ID exists' })
  @ApiConflictResponse({ type: ConflictErrorDto, description: 'A live page has taken one of the restored translation slugs' })
  @ApiUnauthorizedResponse({ type: UnauthorizedErrorDto, description: 'Missing or invalid JWT' })
  @ApiForbiddenResponse({ type: ForbiddenErrorDto, description: 'Insufficient permissions' })
  restore(@Param('id') id: string, @CurrentUser() user: CurrentUserPayload) {
    return this.service.restore(id, user.id);
  }

  @Patch(':id/publish')
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiBearerAuth('jwt')
  @RequirePermission('static-pages:update')
  @ApiOperation({ summary: 'Publish or unpublish a static page', description: 'Requires permission: `static-pages:update`.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: StaticPageDetailResponseDto, description: 'Updated static page' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No page with that ID exists, or it has been deleted' })
  @ApiUnauthorizedResponse({ type: UnauthorizedErrorDto, description: 'Missing or invalid JWT' })
  @ApiForbiddenResponse({ type: ForbiddenErrorDto, description: 'Insufficient permissions' })
  togglePublish(
    @Param('id') id: string,
    @Body() dto: TogglePublishStaticPageDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.service.togglePublish(id, dto, user.id);
  }

  @Get(':id')
  @PublicCache(300, 1800)
  @ApiOperation({
    summary: 'Get a single static page by ID (public)',
    description: 'Returns the page with its translations. Falls back to the default translation if the requested language has no row. Response is CDN-cacheable.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: StaticPageDetailResponseDto, description: 'Static page detail with translations' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No static page with that ID exists, or it has been deleted' })
  findOne(@Param('id') id: string, @Lang() lang: string | null) {
    return this.service.findOne(id, lang);
  }

  @Post()
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiBearerAuth('jwt')
  @RequirePermission('static-pages:create')
  @ApiOperation({
    summary: 'Create a static page with translations',
    description: 'Requires permission: `static-pages:create`. Bodies are HTML-sanitised server-side.',
  })
  @ApiCreatedResponse({ type: StaticPageCreatedResponseDto, description: 'Static page created with all translations' })
  @ApiBadRequestResponse({ type: ValidationErrorDto, description: 'Validation failed' })
  @ApiUnauthorizedResponse({ type: UnauthorizedErrorDto, description: 'Missing or invalid JWT' })
  @ApiForbiddenResponse({ type: ForbiddenErrorDto, description: 'Insufficient permissions' })
  create(@Body() dto: CreateStaticPageDto, @CurrentUser() user: CurrentUserPayload) {
    return this.service.create(dto, user.id);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiBearerAuth('jwt')
  @RequirePermission('static-pages:update')
  @ApiOperation({
    summary: 'Update a static page (scalar fields and/or translations)',
    description: 'Updates `display_order`, `is_published`, and any provided translations. Requires permission: `static-pages:update`.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: StaticPageDetailResponseDto, description: 'Updated static page' })
  @ApiBadRequestResponse({ type: ValidationErrorDto, description: 'Validation failed' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No page with that ID exists, or it has been deleted' })
  @ApiUnauthorizedResponse({ type: UnauthorizedErrorDto, description: 'Missing or invalid JWT' })
  @ApiForbiddenResponse({ type: ForbiddenErrorDto, description: 'Insufficient permissions' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateStaticPageDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.service.update(id, dto, user.id);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiBearerAuth('jwt')
  @RequirePermission('static-pages:delete')
  @ApiOperation({
    summary: 'Soft-delete a static page',
    description:
      'Sets `deleted_at` and suffixes each translation slug so the `(lang, slug)` unique constraint is freed for another page. Restore is reversible. Requires permission: `static-pages:delete`.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: StaticPageMessageResponseDto, description: 'Static page soft-deleted' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No page with that ID exists, or it has already been deleted' })
  @ApiUnauthorizedResponse({ type: UnauthorizedErrorDto, description: 'Missing or invalid JWT' })
  @ApiForbiddenResponse({ type: ForbiddenErrorDto, description: 'Insufficient permissions' })
  remove(@Param('id') id: string, @CurrentUser() user: CurrentUserPayload) {
    return this.service.softDelete(id, user.id);
  }
}
