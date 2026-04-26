import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser, CurrentUserPayload } from '../common/decorators/current-user.decorator';
import { Lang } from '../common/decorators/language.decorator';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { PermissionGuard } from '../common/guards/permission.guard';
import { AcademicPapersService } from './academic-papers.service';
import { AcademicPaperQueryDto, CreateAcademicPaperDto, UpdateAcademicPaperDto } from './dto/academic-paper.dto';

@Controller('academic-papers')
export class AcademicPapersController {
  constructor(private readonly service: AcademicPapersService) {}

  @Get()
  findAll(@Query() query: AcademicPaperQueryDto, @Lang() lang: string | null) {
    return this.service.findAll(query, lang);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Lang() lang: string | null) {
    return this.service.findOne(id, lang);
  }

  @Post()
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePermission('academic-papers:create')
  create(@Body() dto: CreateAcademicPaperDto, @CurrentUser() user: CurrentUserPayload) {
    return this.service.create(dto, user.id);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePermission('academic-papers:update')
  update(@Param('id') id: string, @Body() dto: UpdateAcademicPaperDto, @CurrentUser() user: CurrentUserPayload) {
    return this.service.update(id, dto, user.id);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePermission('academic-papers:delete')
  remove(@Param('id') id: string, @CurrentUser() user: CurrentUserPayload) {
    return this.service.softDelete(id, user.id);
  }
}
