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
import { AcademicPapersService } from './academic-papers.service';
import { AcademicPaperQueryDto, CreateAcademicPaperDto, UpdateAcademicPaperDto } from './dto/academic-paper.dto';
import {
  AcademicPaperCreatedResponseDto,
  AcademicPaperDetailResponseDto,
  AcademicPaperListResponseDto,
  AcademicPaperMessageResponseDto,
} from './dto/academic-paper-response.dto';

@ApiTags('Academic Papers')
@ApiHeader({ name: 'Accept-Language', required: false, description: 'ISO 639-1 code for translated fields (e.g. ar, en)' })
@Controller('academic-papers')
export class AcademicPapersController {
  constructor(private readonly service: AcademicPapersService) {}

  @Get()
  @ApiOperation({ summary: 'List academic papers (public)', description: 'Supports filtering by category and full-text search.' })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1, description: 'Page number (default: 1)' })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20, description: 'Items per page (default: 20, max: 100)' })
  @ApiQuery({ name: 'category_id', required: false, type: String, description: 'Filter by academic paper category UUID' })
  @ApiQuery({ name: 'search', required: false, type: String, example: 'فقه', description: 'Search across paper titles and abstracts' })
  @ApiOkResponse({ type: AcademicPaperListResponseDto, description: 'Paginated list of academic papers' })
  findAll(@Query() query: AcademicPaperQueryDto, @Lang() lang: string | null) {
    return this.service.findAll(query, lang);
  }

  @Get('trash')
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiBearerAuth('jwt')
  @RequirePermission('academic-papers:delete')
  @ApiOperation({
    summary: 'List soft-deleted academic papers (CMS trash view)',
    description:
      'Paginated list of academic papers whose `deleted_at` is set. Requires permission: `academic-papers:delete`.',
  })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20 })
  @ApiOkResponse({ type: AcademicPaperListResponseDto, description: 'Paginated list of trashed academic papers' })
  @ApiUnauthorizedResponse({ type: UnauthorizedErrorDto, description: 'Missing or invalid JWT' })
  @ApiForbiddenResponse({ type: ForbiddenErrorDto, description: 'Insufficient permissions' })
  findTrash(@Query() query: PaginationDto) {
    return this.service.findTrash(query.page ?? 1, query.limit ?? 20);
  }

  @Post(':id/restore')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiBearerAuth('jwt')
  @RequirePermission('academic-papers:delete')
  @ApiOperation({
    summary: 'Restore a soft-deleted academic paper',
    description:
      'Sets `deleted_at` back to null so the paper reappears in public listings. Academic paper translations have no unique slug constraints so restore cannot conflict. Requires permission: `academic-papers:delete`.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: AcademicPaperMessageResponseDto, description: 'Academic paper restored' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No soft-deleted paper with that ID exists' })
  @ApiUnauthorizedResponse({ type: UnauthorizedErrorDto, description: 'Missing or invalid JWT' })
  @ApiForbiddenResponse({ type: ForbiddenErrorDto, description: 'Insufficient permissions' })
  restore(@Param('id') id: string, @CurrentUser() user: CurrentUserPayload) {
    return this.service.restore(id, user.id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single academic paper by ID (public)', description: 'Returns the paper with its translations. Falls back to the default translation if no translation exists for the requested language.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: AcademicPaperDetailResponseDto, description: 'Academic paper detail with all translations' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No academic paper with that ID exists, or it has been deleted' })
  findOne(@Param('id') id: string, @Lang() lang: string | null) {
    return this.service.findOne(id, lang);
  }

  @Post()
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiBearerAuth('jwt')
  @RequirePermission('academic-papers:create')
  @ApiOperation({ summary: 'Create an academic paper with translations', description: 'Requires permission: `academic-papers:create`. Exactly one translation must have `is_default: true`.' })
  @ApiCreatedResponse({ type: AcademicPaperCreatedResponseDto, description: 'Academic paper created with all provided translations; returns the full paper object' })
  @ApiBadRequestResponse({ type: ValidationErrorDto, description: 'Validation failed, or translations did not contain exactly one is_default entry' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No academic paper category with that category_id exists' })
  @ApiUnauthorizedResponse({ type: UnauthorizedErrorDto, description: 'Missing or invalid JWT' })
  @ApiForbiddenResponse({ type: ForbiddenErrorDto, description: 'Insufficient permissions' })
  create(@Body() dto: CreateAcademicPaperDto, @CurrentUser() user: CurrentUserPayload) {
    return this.service.create(dto, user.id);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiBearerAuth('jwt')
  @RequirePermission('academic-papers:update')
  @ApiOperation({ summary: 'Update an academic paper and upsert translations', description: 'Requires permission: `academic-papers:update`.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: AcademicPaperDetailResponseDto, description: 'Updated academic paper with all translations' })
  @ApiBadRequestResponse({ type: ValidationErrorDto, description: 'Validation failed, or the resulting translations did not contain exactly one is_default entry' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No academic paper with that ID exists, or the new category_id does not exist or has been soft-deleted' })
  @ApiUnauthorizedResponse({ type: UnauthorizedErrorDto, description: 'Missing or invalid JWT' })
  @ApiForbiddenResponse({ type: ForbiddenErrorDto, description: 'Insufficient permissions' })
  update(@Param('id') id: string, @Body() dto: UpdateAcademicPaperDto, @CurrentUser() user: CurrentUserPayload) {
    return this.service.update(id, dto, user.id);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiBearerAuth('jwt')
  @RequirePermission('academic-papers:delete')
  @ApiOperation({ summary: 'Soft-delete an academic paper', description: 'Requires permission: `academic-papers:delete`.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: AcademicPaperMessageResponseDto, description: 'Academic paper soft-deleted; immediately hidden from all queries — data is preserved in the database' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No academic paper with that ID exists, or it has already been deleted' })
  @ApiUnauthorizedResponse({ type: UnauthorizedErrorDto, description: 'Missing or invalid JWT' })
  @ApiForbiddenResponse({ type: ForbiddenErrorDto, description: 'Insufficient permissions' })
  remove(@Param('id') id: string, @CurrentUser() user: CurrentUserPayload) {
    return this.service.softDelete(id, user.id);
  }
}
