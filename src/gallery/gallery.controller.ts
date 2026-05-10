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
import { PermissionGuard } from '../common/guards/permission.guard';
import { CreateGalleryImageDto, GalleryQueryDto, UpdateGalleryImageDto } from './dto/gallery.dto';
import {
  GalleryCreatedResponseDto,
  GalleryDetailResponseDto,
  GalleryListResponseDto,
  GalleryMessageResponseDto,
} from './dto/gallery-response.dto';
import { GalleryService } from './gallery.service';

@ApiTags('Gallery')
@ApiHeader({ name: 'Accept-Language', required: false, description: 'ISO 639-1 code for translated fields (e.g. ar, en)' })
@Controller('gallery')
export class GalleryController {
  constructor(private readonly galleryService: GalleryService) {}

  @Get()
  @ApiOperation({ summary: 'List gallery images (public)', description: 'Supports filtering by category, tags, and locations. All tag/location filters use AND logic.' })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1, description: 'Page number (default: 1)' })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20, description: 'Items per page (default: 20, max: 100)' })
  @ApiQuery({ name: 'category_id', required: false, type: String, description: 'Filter by gallery category UUID' })
  @ApiQuery({ name: 'tags', required: false, isArray: true, type: String, example: ['shrine'], description: 'Filter by tags — images must have ALL specified tags' })
  @ApiQuery({ name: 'locations', required: false, isArray: true, type: String, example: ['Karbala'], description: 'Filter by locations — images must have ALL specified locations' })
  @ApiOkResponse({ type: GalleryListResponseDto, description: 'Paginated list of gallery images' })
  findAll(@Query() query: GalleryQueryDto, @Lang() lang: string | null) {
    return this.galleryService.findAll(query, lang);
  }

  @Get('trash')
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiBearerAuth('jwt')
  @RequirePermission('gallery:delete')
  @ApiOperation({
    summary: 'List soft-deleted gallery images (CMS trash view)',
    description: 'Returns images with `deleted_at` set, paginated. Requires permission: `gallery:delete`.',
  })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20 })
  @ApiOkResponse({ type: GalleryListResponseDto, description: 'Paginated list of trashed gallery images' })
  findTrash(@Query() query: PaginationDto) {
    return this.galleryService.findTrash(query.page ?? 1, query.limit ?? 20);
  }

  @Post(':id/restore')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiBearerAuth('jwt')
  @RequirePermission('gallery:delete')
  @ApiOperation({
    summary: 'Restore a soft-deleted gallery image',
    description: 'Sets `deleted_at` back to null. Requires permission: `gallery:delete`.',
  })
  @ApiParam({ name: 'id', format: 'uuid', description: 'Media ID (serves as the gallery image primary key)' })
  @ApiOkResponse({ type: GalleryMessageResponseDto, description: 'Gallery image restored' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No soft-deleted gallery image with that media ID exists' })
  restore(@Param('id') id: string, @CurrentUser() user: CurrentUserPayload) {
    return this.galleryService.restore(id, user.id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single gallery image by its media ID (public)', description: 'The `id` parameter is the media record UUID (gallery images use media_id as their primary key).' })
  @ApiParam({ name: 'id', format: 'uuid', description: 'Media ID (serves as the gallery image primary key)' })
  @ApiOkResponse({ type: GalleryDetailResponseDto, description: 'Gallery image detail including linked media record and all translations' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No gallery image with that media ID exists, or it has been deleted' })
  findOne(@Param('id') id: string, @Lang() lang: string | null) {
    return this.galleryService.findOne(id, lang);
  }

  @Post()
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiBearerAuth('jwt')
  @RequirePermission('gallery:create')
  @ApiOperation({ summary: 'Add an image to the gallery', description: 'The `media_id` must reference an existing media record. Requires permission: `gallery:create`.' })
  @ApiCreatedResponse({ type: GalleryCreatedResponseDto, description: 'Gallery image entry created; returns the full record including the linked media details and translations' })
  @ApiBadRequestResponse({ type: ValidationErrorDto, description: 'Validation failed' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No media record with that media_id exists' })
  @ApiUnauthorizedResponse({ type: UnauthorizedErrorDto, description: 'Missing or invalid JWT' })
  @ApiForbiddenResponse({ type: ForbiddenErrorDto, description: 'Insufficient permissions' })
  create(@Body() dto: CreateGalleryImageDto, @CurrentUser() user: CurrentUserPayload) {
    return this.galleryService.create(dto, user.id);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiBearerAuth('jwt')
  @RequirePermission('gallery:update')
  @ApiOperation({ summary: 'Update a gallery image and upsert translations', description: 'Requires permission: `gallery:update`.' })
  @ApiParam({ name: 'id', format: 'uuid', description: 'Media ID' })
  @ApiOkResponse({ type: GalleryDetailResponseDto, description: 'Updated gallery image with all translations' })
  @ApiBadRequestResponse({ type: ValidationErrorDto, description: 'Validation failed' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No gallery image with that media ID exists, or it has been deleted' })
  @ApiUnauthorizedResponse({ type: UnauthorizedErrorDto, description: 'Missing or invalid JWT' })
  @ApiForbiddenResponse({ type: ForbiddenErrorDto, description: 'Insufficient permissions' })
  update(@Param('id') id: string, @Body() dto: UpdateGalleryImageDto, @CurrentUser() user: CurrentUserPayload) {
    return this.galleryService.update(id, dto, user.id);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiBearerAuth('jwt')
  @RequirePermission('gallery:delete')
  @ApiOperation({ summary: 'Soft-delete a gallery image', description: 'Requires permission: `gallery:delete`.' })
  @ApiParam({ name: 'id', format: 'uuid', description: 'Media ID' })
  @ApiOkResponse({ type: GalleryMessageResponseDto, description: 'Gallery image soft-deleted; immediately hidden from the public gallery — the underlying media record in R2 is NOT deleted' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No gallery image with that media ID exists, or it has already been deleted' })
  @ApiUnauthorizedResponse({ type: UnauthorizedErrorDto, description: 'Missing or invalid JWT' })
  @ApiForbiddenResponse({ type: ForbiddenErrorDto, description: 'Insufficient permissions' })
  remove(@Param('id') id: string, @CurrentUser() user: CurrentUserPayload) {
    return this.galleryService.softDelete(id, user.id);
  }
}
