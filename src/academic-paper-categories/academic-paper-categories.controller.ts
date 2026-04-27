import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser, CurrentUserPayload } from '../common/decorators/current-user.decorator';
import { Lang } from '../common/decorators/language.decorator';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { PermissionGuard } from '../common/guards/permission.guard';
import { AcademicPaperCategoriesService } from './academic-paper-categories.service';
import { CreateAcademicPaperCategoryDto, UpdateAcademicPaperCategoryDto } from './dto/academic-paper-category.dto';

@ApiTags('Academic Paper Categories')
@ApiHeader({ name: 'Accept-Language', required: false, description: 'ISO 639-1 code for translated fields (e.g. ar, en)' })
@Controller('academic-paper-categories')
export class AcademicPaperCategoriesController {
  constructor(private readonly service: AcademicPaperCategoriesService) {}

  @Get()
  @ApiOperation({ summary: 'List all academic paper categories (public)' })
  findAll(@Lang() lang: string | null) {
    return this.service.findAll(lang);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single academic paper category (public)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  findOne(@Param('id') id: string, @Lang() lang: string | null) {
    return this.service.findOne(id, lang);
  }

  @Post()
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiBearerAuth('jwt')
  @RequirePermission('academic-paper-categories:create')
  @ApiOperation({ summary: 'Create an academic paper category with translations', description: 'Requires permission: `academic-paper-categories:create`.' })
  create(@Body() dto: CreateAcademicPaperCategoryDto, @CurrentUser() user: CurrentUserPayload) {
    return this.service.create(dto, user.id);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiBearerAuth('jwt')
  @RequirePermission('academic-paper-categories:update')
  @ApiOperation({ summary: 'Update academic paper category translations', description: 'Requires permission: `academic-paper-categories:update`.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  update(@Param('id') id: string, @Body() dto: UpdateAcademicPaperCategoryDto, @CurrentUser() user: CurrentUserPayload) {
    return this.service.update(id, dto, user.id);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiBearerAuth('jwt')
  @RequirePermission('academic-paper-categories:delete')
  @ApiOperation({ summary: 'Soft-delete an academic paper category', description: 'Requires permission: `academic-paper-categories:delete`.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  remove(@Param('id') id: string, @CurrentUser() user: CurrentUserPayload) {
    return this.service.softDelete(id, user.id);
  }
}
