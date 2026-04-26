import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser, CurrentUserPayload } from '../common/decorators/current-user.decorator';
import { Lang } from '../common/decorators/language.decorator';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { PermissionGuard } from '../common/guards/permission.guard';
import { CreateGalleryImageDto, GalleryQueryDto, UpdateGalleryImageDto } from './dto/gallery.dto';
import { GalleryService } from './gallery.service';

@Controller('gallery')
export class GalleryController {
  constructor(private readonly galleryService: GalleryService) {}

  @Get()
  findAll(@Query() query: GalleryQueryDto, @Lang() lang: string | null) {
    return this.galleryService.findAll(query, lang);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Lang() lang: string | null) {
    return this.galleryService.findOne(id, lang);
  }

  @Post()
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePermission('gallery:create')
  create(@Body() dto: CreateGalleryImageDto, @CurrentUser() user: CurrentUserPayload) {
    return this.galleryService.create(dto, user.id);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePermission('gallery:update')
  update(@Param('id') id: string, @Body() dto: UpdateGalleryImageDto, @CurrentUser() user: CurrentUserPayload) {
    return this.galleryService.update(id, dto, user.id);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePermission('gallery:delete')
  remove(@Param('id') id: string, @CurrentUser() user: CurrentUserPayload) {
    return this.galleryService.softDelete(id, user.id);
  }
}
