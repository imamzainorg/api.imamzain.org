import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
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
import { ConflictErrorDto, ForbiddenErrorDto, NotFoundErrorDto, UnauthorizedErrorDto, ValidationErrorDto } from '../common/dto/api-response.dto';
import { PaginationDto } from '../common/dto/pagination.dto';
import { PermissionGuard } from '../common/guards/permission.guard';
import { AcademicPaperCategoriesService } from './academic-paper-categories.service';
import { CreateAcademicPaperCategoryDto, UpdateAcademicPaperCategoryDto } from './dto/academic-paper-category.dto';
import {
  AcademicPaperCategoryCreatedResponseDto,
  AcademicPaperCategoryDetailResponseDto,
  AcademicPaperCategoryListResponseDto,
  AcademicPaperCategoryMessageResponseDto,
} from './dto/academic-paper-category-response.dto';

@ApiTags('Academic Paper Categories')
@ApiHeader({ name: 'Accept-Language', required: false, description: 'ISO 639-1 code for translated fields (e.g. ar, en)' })
@Controller('academic-paper-categories')
export class AcademicPaperCategoriesController {
  constructor(private readonly service: AcademicPaperCategoriesService) {}

  @Get()
  @ApiOperation({ summary: 'List all academic paper categories (public, paginated)', description: 'Returns categories that have not been soft-deleted. Use Accept-Language to get translated title and slug.' })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1, description: 'Page number (default: 1)' })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 100, description: 'Items per page (default: 100, max: 100)' })
  @ApiOkResponse({ type: AcademicPaperCategoryListResponseDto, description: 'Paginated list of academic paper categories' })
  findAll(@Lang() lang: string | null, @Query() query: PaginationDto) {
    return this.service.findAll(lang, query.page ?? 1, query.limit ?? 100);
  }

  @Get('trash')
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiBearerAuth('jwt')
  @RequirePermission('academic-paper-categories:delete')
  @ApiOperation({ summary: 'List soft-deleted academic paper categories (CMS trash view)' })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20 })
  @ApiOkResponse({ type: AcademicPaperCategoryListResponseDto, description: 'Paginated list of trashed academic paper categories' })
  findTrash(@Query() query: PaginationDto) {
    return this.service.findTrash(query.page ?? 1, query.limit ?? 20);
  }

  @Post(':id/restore')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiBearerAuth('jwt')
  @RequirePermission('academic-paper-categories:delete')
  @ApiOperation({ summary: 'Restore a soft-deleted academic paper category' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: AcademicPaperCategoryMessageResponseDto, description: 'Category restored' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No soft-deleted category with that ID exists' })
  restore(@Param('id') id: string, @CurrentUser() user: CurrentUserPayload) {
    return this.service.restore(id, user.id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single academic paper category (public)', description: 'Returns the category with its translations. Falls back to the default language if no translation exists for the requested language.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: AcademicPaperCategoryDetailResponseDto, description: 'Academic paper category detail with translations' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No academic paper category with that ID exists, or it has been deleted' })
  findOne(@Param('id') id: string, @Lang() lang: string | null) {
    return this.service.findOne(id, lang);
  }

  @Post()
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiBearerAuth('jwt')
  @RequirePermission('academic-paper-categories:create')
  @ApiOperation({ summary: 'Create an academic paper category with translations', description: 'Requires permission: `academic-paper-categories:create`.' })
  @ApiCreatedResponse({ type: AcademicPaperCategoryCreatedResponseDto, description: 'Academic paper category created with all provided translations' })
  @ApiBadRequestResponse({ type: ValidationErrorDto, description: 'Validation failed' })
  @ApiUnauthorizedResponse({ type: UnauthorizedErrorDto, description: 'Missing or invalid JWT' })
  @ApiForbiddenResponse({ type: ForbiddenErrorDto, description: 'Insufficient permissions' })
  create(@Body() dto: CreateAcademicPaperCategoryDto, @CurrentUser() user: CurrentUserPayload) {
    return this.service.create(dto, user.id);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiBearerAuth('jwt')
  @RequirePermission('academic-paper-categories:update')
  @ApiOperation({ summary: 'Update academic paper category translations', description: 'Requires permission: `academic-paper-categories:update`.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: AcademicPaperCategoryDetailResponseDto, description: 'Updated academic paper category with all translations' })
  @ApiBadRequestResponse({ type: ValidationErrorDto, description: 'Validation failed' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No academic paper category with that ID exists, or it has been deleted' })
  @ApiUnauthorizedResponse({ type: UnauthorizedErrorDto, description: 'Missing or invalid JWT' })
  @ApiForbiddenResponse({ type: ForbiddenErrorDto, description: 'Insufficient permissions' })
  update(@Param('id') id: string, @Body() dto: UpdateAcademicPaperCategoryDto, @CurrentUser() user: CurrentUserPayload) {
    return this.service.update(id, dto, user.id);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiBearerAuth('jwt')
  @RequirePermission('academic-paper-categories:delete')
  @ApiOperation({
    summary: 'Soft-delete an academic paper category',
    description:
      'Fails with 409 if the category still contains academic papers — reassign or delete those first. Requires permission: `academic-paper-categories:delete`.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: AcademicPaperCategoryMessageResponseDto, description: 'Academic paper category soft-deleted' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No academic paper category with that ID exists, or it has already been deleted' })
  @ApiConflictResponse({ type: ConflictErrorDto, description: 'Cannot delete: this category still has live academic papers attached' })
  @ApiUnauthorizedResponse({ type: UnauthorizedErrorDto, description: 'Missing or invalid JWT' })
  @ApiForbiddenResponse({ type: ForbiddenErrorDto, description: 'Insufficient permissions' })
  remove(@Param('id') id: string, @CurrentUser() user: CurrentUserPayload) {
    return this.service.softDelete(id, user.id);
  }
}
