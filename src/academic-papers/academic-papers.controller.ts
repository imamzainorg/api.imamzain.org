import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser, CurrentUserPayload } from '../common/decorators/current-user.decorator';
import { Lang } from '../common/decorators/language.decorator';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { PermissionGuard } from '../common/guards/permission.guard';
import { AcademicPapersService } from './academic-papers.service';
import { AcademicPaperQueryDto, CreateAcademicPaperDto, UpdateAcademicPaperDto } from './dto/academic-paper.dto';

@ApiTags('Academic Papers')
@ApiHeader({ name: 'Accept-Language', required: false, description: 'ISO 639-1 code for translated fields (e.g. ar, en)' })
@Controller('academic-papers')
export class AcademicPapersController {
  constructor(private readonly service: AcademicPapersService) {}

  @Get()
  @ApiOperation({ summary: 'List academic papers (public)', description: 'Supports filtering by category and full-text search.' })
  findAll(@Query() query: AcademicPaperQueryDto, @Lang() lang: string | null) {
    return this.service.findAll(query, lang);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single academic paper by ID (public)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  findOne(@Param('id') id: string, @Lang() lang: string | null) {
    return this.service.findOne(id, lang);
  }

  @Post()
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiBearerAuth('jwt')
  @RequirePermission('academic-papers:create')
  @ApiOperation({ summary: 'Create an academic paper with translations', description: 'Requires permission: `academic-papers:create`. Exactly one translation must have `is_default: true`.' })
  create(@Body() dto: CreateAcademicPaperDto, @CurrentUser() user: CurrentUserPayload) {
    return this.service.create(dto, user.id);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiBearerAuth('jwt')
  @RequirePermission('academic-papers:update')
  @ApiOperation({ summary: 'Update an academic paper and upsert translations', description: 'Requires permission: `academic-papers:update`.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  update(@Param('id') id: string, @Body() dto: UpdateAcademicPaperDto, @CurrentUser() user: CurrentUserPayload) {
    return this.service.update(id, dto, user.id);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiBearerAuth('jwt')
  @RequirePermission('academic-papers:delete')
  @ApiOperation({ summary: 'Soft-delete an academic paper', description: 'Requires permission: `academic-papers:delete`.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  remove(@Param('id') id: string, @CurrentUser() user: CurrentUserPayload) {
    return this.service.softDelete(id, user.id);
  }
}
