import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser, CurrentUserPayload } from '../common/decorators/current-user.decorator';
import { Lang } from '../common/decorators/language.decorator';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { PermissionGuard } from '../common/guards/permission.guard';
import { GalleryCategoriesService } from './gallery-categories.service';
import { CreateGalleryCategoryDto, UpdateGalleryCategoryDto } from './dto/gallery-category.dto';

@Controller('gallery-categories')
export class GalleryCategoriesController {
  constructor(private readonly service: GalleryCategoriesService) {}

  @Get()
  findAll(@Lang() lang: string | null) {
    return this.service.findAll(lang);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Lang() lang: string | null) {
    return this.service.findOne(id, lang);
  }

  @Post()
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePermission('gallery-categories:create')
  create(@Body() dto: CreateGalleryCategoryDto, @CurrentUser() user: CurrentUserPayload) {
    return this.service.create(dto, user.id);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePermission('gallery-categories:update')
  update(@Param('id') id: string, @Body() dto: UpdateGalleryCategoryDto, @CurrentUser() user: CurrentUserPayload) {
    return this.service.update(id, dto, user.id);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePermission('gallery-categories:delete')
  remove(@Param('id') id: string, @CurrentUser() user: CurrentUserPayload) {
    return this.service.softDelete(id, user.id);
  }
}
