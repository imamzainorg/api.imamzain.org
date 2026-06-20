import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
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
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { ForbiddenErrorDto, NotFoundErrorDto, UnauthorizedErrorDto, ValidationErrorDto } from '../common/dto/api-response.dto';
import { PaginationDto } from '../common/dto/pagination.dto';
import { PublicCache } from '../common/decorators/public-cache.decorator';
import { PermissionGuard } from '../common/guards/permission.guard';
import {
  CreateStoreDto,
  CreateStoreLocationDto,
  UpdateStoreDto,
  UpdateStoreLocationDto,
} from './dto/store.dto';
import { StoreDetailResponseDto, StoreListResponseDto, StoreMessageResponseDto } from './dto/store-response.dto';
import { StoresService } from './stores.service';

@ApiTags('Stores')
@ApiHeader({ name: 'Accept-Language', required: false, description: 'ISO 639-1 code for translated fields (e.g. ar, en)' })
@Controller('stores')
export class StoresController {
  constructor(private readonly service: StoresService) {}

  @Get()
  @PublicCache(300, 1800)
  @ApiOperation({
    summary: 'List stores with their sale-points (public, paginated)',
    description:
      'Returns non-deleted cities ordered by `display_order`, each with its live `store_locations`. Use Accept-Language for translated city name / location name / address. CDN-cacheable (`public, max-age=300, s-maxage=1800`), varies by `Accept-Language`.',
  })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20 })
  @ApiOkResponse({ type: StoreListResponseDto, description: 'Paginated list of stores' })
  @ApiBadRequestResponse({ type: ValidationErrorDto, description: 'Invalid query parameters' })
  findAllPublic(@Lang() lang: string | null, @Query() query: PaginationDto) {
    return this.service.findAllPublic(lang, query.page ?? 1, query.limit ?? 20);
  }

  @Get('trash')
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiBearerAuth('jwt')
  @RequirePermission('stores:delete')
  @ApiOperation({
    summary: 'List soft-deleted stores (CMS trash view)',
    description: 'Paginated list of stores whose `deleted_at` is set. Requires permission: `stores:delete`.',
  })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20 })
  @ApiOkResponse({ type: StoreListResponseDto, description: 'Paginated list of trashed stores' })
  @ApiUnauthorizedResponse({ type: UnauthorizedErrorDto, description: 'Missing or invalid JWT' })
  @ApiForbiddenResponse({ type: ForbiddenErrorDto, description: 'Insufficient permissions' })
  findTrash(@Query() query: PaginationDto) {
    return this.service.findTrash(query.page ?? 1, query.limit ?? 20);
  }

  @Get(':id')
  @PublicCache(300, 1800)
  @ApiOperation({
    summary: 'Get a single store by ID (public)',
    description: 'Returns the city with its live sale-points. CDN-cacheable.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: StoreDetailResponseDto, description: 'Store detail with locations and translations' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No store with that ID exists, or it has been deleted' })
  findOne(@Param('id') id: string, @Lang() lang: string | null) {
    return this.service.findOne(id, lang);
  }

  @Post()
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiBearerAuth('jwt')
  @RequirePermission('stores:create')
  @ApiOperation({
    summary: 'Create a store (city) with translations and optional sale-points',
    description: 'Requires permission: `stores:create`. Pass `locations[]` to create sale-points in the same call.',
  })
  @ApiCreatedResponse({ type: StoreDetailResponseDto, description: 'Store created with translations and locations' })
  @ApiBadRequestResponse({ type: ValidationErrorDto, description: 'Validation failed' })
  @ApiUnauthorizedResponse({ type: UnauthorizedErrorDto, description: 'Missing or invalid JWT' })
  @ApiForbiddenResponse({ type: ForbiddenErrorDto, description: 'Insufficient permissions' })
  create(@Body() dto: CreateStoreDto, @CurrentUser() user: CurrentUserPayload) {
    return this.service.create(dto, user.id);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiBearerAuth('jwt')
  @RequirePermission('stores:update')
  @ApiOperation({
    summary: 'Update a store (display order and/or city-name translations)',
    description: 'Manage sale-points via the nested `/stores/:id/locations` routes. Requires permission: `stores:update`.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: StoreDetailResponseDto, description: 'Updated store' })
  @ApiBadRequestResponse({ type: ValidationErrorDto, description: 'Validation failed' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No store with that ID exists, or it has been deleted' })
  @ApiUnauthorizedResponse({ type: UnauthorizedErrorDto, description: 'Missing or invalid JWT' })
  @ApiForbiddenResponse({ type: ForbiddenErrorDto, description: 'Insufficient permissions' })
  update(@Param('id') id: string, @Body() dto: UpdateStoreDto, @CurrentUser() user: CurrentUserPayload) {
    return this.service.update(id, dto, user.id);
  }

  @Post(':id/restore')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiBearerAuth('jwt')
  @RequirePermission('stores:delete')
  @ApiOperation({ summary: 'Restore a soft-deleted store', description: 'Requires permission: `stores:delete`.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: StoreMessageResponseDto, description: 'Store restored' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No soft-deleted store with that ID exists' })
  @ApiUnauthorizedResponse({ type: UnauthorizedErrorDto, description: 'Missing or invalid JWT' })
  @ApiForbiddenResponse({ type: ForbiddenErrorDto, description: 'Insufficient permissions' })
  restore(@Param('id') id: string, @CurrentUser() user: CurrentUserPayload) {
    return this.service.restore(id, user.id);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiBearerAuth('jwt')
  @RequirePermission('stores:delete')
  @ApiOperation({
    summary: 'Soft-delete a store',
    description: 'Sets `deleted_at`; the store and its sale-points drop out of public reads. Restore is reversible. Requires permission: `stores:delete`.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: StoreMessageResponseDto, description: 'Store soft-deleted' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No store with that ID exists, or it has already been deleted' })
  @ApiUnauthorizedResponse({ type: UnauthorizedErrorDto, description: 'Missing or invalid JWT' })
  @ApiForbiddenResponse({ type: ForbiddenErrorDto, description: 'Insufficient permissions' })
  remove(@Param('id') id: string, @CurrentUser() user: CurrentUserPayload) {
    return this.service.softDelete(id, user.id);
  }

  // ── Nested sale-point (location) management ─────────────────────────────────

  @Post(':id/locations')
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiBearerAuth('jwt')
  @RequirePermission('stores:update')
  @ApiOperation({ summary: 'Add a sale-point to a store', description: 'Requires permission: `stores:update`.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiCreatedResponse({ type: StoreDetailResponseDto, description: 'Store with the new location' })
  @ApiBadRequestResponse({ type: ValidationErrorDto, description: 'Validation failed' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No store with that ID exists, or it has been deleted' })
  @ApiUnauthorizedResponse({ type: UnauthorizedErrorDto, description: 'Missing or invalid JWT' })
  @ApiForbiddenResponse({ type: ForbiddenErrorDto, description: 'Insufficient permissions' })
  addLocation(@Param('id') id: string, @Body() dto: CreateStoreLocationDto, @CurrentUser() user: CurrentUserPayload) {
    return this.service.addLocation(id, dto, user.id);
  }

  @Patch(':id/locations/:locationId')
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiBearerAuth('jwt')
  @RequirePermission('stores:update')
  @ApiOperation({ summary: 'Update a sale-point', description: 'Requires permission: `stores:update`.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiParam({ name: 'locationId', format: 'uuid' })
  @ApiOkResponse({ type: StoreDetailResponseDto, description: 'Store with the updated location' })
  @ApiBadRequestResponse({ type: ValidationErrorDto, description: 'Validation failed' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No matching location exists for that store' })
  @ApiUnauthorizedResponse({ type: UnauthorizedErrorDto, description: 'Missing or invalid JWT' })
  @ApiForbiddenResponse({ type: ForbiddenErrorDto, description: 'Insufficient permissions' })
  updateLocation(
    @Param('id') id: string,
    @Param('locationId') locationId: string,
    @Body() dto: UpdateStoreLocationDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.service.updateLocation(id, locationId, dto, user.id);
  }

  @Delete(':id/locations/:locationId')
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiBearerAuth('jwt')
  @RequirePermission('stores:delete')
  @ApiOperation({ summary: 'Soft-delete a sale-point', description: 'Requires permission: `stores:delete`.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiParam({ name: 'locationId', format: 'uuid' })
  @ApiOkResponse({ type: StoreDetailResponseDto, description: 'Store with the location removed' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No matching location exists for that store' })
  @ApiUnauthorizedResponse({ type: UnauthorizedErrorDto, description: 'Missing or invalid JWT' })
  @ApiForbiddenResponse({ type: ForbiddenErrorDto, description: 'Insufficient permissions' })
  removeLocation(
    @Param('id') id: string,
    @Param('locationId') locationId: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.service.removeLocation(id, locationId, user.id);
  }
}
