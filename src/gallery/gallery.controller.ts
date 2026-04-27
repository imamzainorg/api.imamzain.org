import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser, CurrentUserPayload } from '../common/decorators/current-user.decorator';
import { Lang } from '../common/decorators/language.decorator';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { PermissionGuard } from '../common/guards/permission.guard';
import { CreateGalleryImageDto, GalleryQueryDto, UpdateGalleryImageDto } from './dto/gallery.dto';
import { GalleryService } from './gallery.service';

@ApiTags('Gallery')
@ApiHeader({ name: 'Accept-Language', required: false, description: 'ISO 639-1 code for translated fields (e.g. ar, en)' })
@Controller('gallery')
export class GalleryController {
  constructor(private readonly galleryService: GalleryService) {}

  @Get()
  @ApiOperation({ summary: 'List gallery images (public)', description: 'Supports filtering by category, tags, and locations. All tag/location filters use AND logic.' })
  findAll(@Query() query: GalleryQueryDto, @Lang() lang: string | null) {
    return this.galleryService.findAll(query, lang);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single gallery image by its media ID (public)', description: 'The `id` parameter is the media record UUID (gallery images use media_id as their primary key).' })
  @ApiParam({ name: 'id', format: 'uuid', description: 'Media ID (serves as the gallery image primary key)' })
  findOne(@Param('id') id: string, @Lang() lang: string | null) {
    return this.galleryService.findOne(id, lang);
  }

  @Post()
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiBearerAuth('jwt')
  @RequirePermission('gallery:create')
  @ApiOperation({ summary: 'Add an image to the gallery', description: 'The `media_id` must reference an existing media record. Requires permission: `gallery:create`.' })
  create(@Body() dto: CreateGalleryImageDto, @CurrentUser() user: CurrentUserPayload) {
    return this.galleryService.create(dto, user.id);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiBearerAuth('jwt')
  @RequirePermission('gallery:update')
  @ApiOperation({ summary: 'Update a gallery image and upsert translations', description: 'Requires permission: `gallery:update`.' })
  @ApiParam({ name: 'id', format: 'uuid', description: 'Media ID' })
  update(@Param('id') id: string, @Body() dto: UpdateGalleryImageDto, @CurrentUser() user: CurrentUserPayload) {
    return this.galleryService.update(id, dto, user.id);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiBearerAuth('jwt')
  @RequirePermission('gallery:delete')
  @ApiOperation({ summary: 'Soft-delete a gallery image', description: 'Requires permission: `gallery:delete`.' })
  @ApiParam({ name: 'id', format: 'uuid', description: 'Media ID' })
  remove(@Param('id') id: string, @CurrentUser() user: CurrentUserPayload) {
    return this.galleryService.softDelete(id, user.id);
  }
}
