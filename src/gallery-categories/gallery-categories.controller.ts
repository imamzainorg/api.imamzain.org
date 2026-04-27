import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser, CurrentUserPayload } from '../common/decorators/current-user.decorator';
import { Lang } from '../common/decorators/language.decorator';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { PermissionGuard } from '../common/guards/permission.guard';
import { GalleryCategoriesService } from './gallery-categories.service';
import { CreateGalleryCategoryDto, UpdateGalleryCategoryDto } from './dto/gallery-category.dto';

@ApiTags('Gallery Categories')
@ApiHeader({ name: 'Accept-Language', required: false, description: 'ISO 639-1 code for translated fields (e.g. ar, en)' })
@Controller('gallery-categories')
export class GalleryCategoriesController {
  constructor(private readonly service: GalleryCategoriesService) {}

  @Get()
  @ApiOperation({ summary: 'List all gallery categories (public)' })
  findAll(@Lang() lang: string | null) {
    return this.service.findAll(lang);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single gallery category (public)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  findOne(@Param('id') id: string, @Lang() lang: string | null) {
    return this.service.findOne(id, lang);
  }

  @Post()
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiBearerAuth('jwt')
  @RequirePermission('gallery-categories:create')
  @ApiOperation({ summary: 'Create a gallery category with translations', description: 'Requires permission: `gallery-categories:create`.' })
  create(@Body() dto: CreateGalleryCategoryDto, @CurrentUser() user: CurrentUserPayload) {
    return this.service.create(dto, user.id);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiBearerAuth('jwt')
  @RequirePermission('gallery-categories:update')
  @ApiOperation({ summary: 'Update gallery category translations', description: 'Requires permission: `gallery-categories:update`.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  update(@Param('id') id: string, @Body() dto: UpdateGalleryCategoryDto, @CurrentUser() user: CurrentUserPayload) {
    return this.service.update(id, dto, user.id);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiBearerAuth('jwt')
  @RequirePermission('gallery-categories:delete')
  @ApiOperation({ summary: 'Soft-delete a gallery category', description: 'Requires permission: `gallery-categories:delete`.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  remove(@Param('id') id: string, @CurrentUser() user: CurrentUserPayload) {
    return this.service.softDelete(id, user.id);
  }
}
