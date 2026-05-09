import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
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
import { GalleryCategoriesService } from './gallery-categories.service';
import { CreateGalleryCategoryDto, UpdateGalleryCategoryDto } from './dto/gallery-category.dto';
import {
  GalleryCategoryCreatedResponseDto,
  GalleryCategoryDetailResponseDto,
  GalleryCategoryListResponseDto,
  GalleryCategoryMessageResponseDto,
} from './dto/gallery-category-response.dto';

@ApiTags('Gallery Categories')
@ApiHeader({ name: 'Accept-Language', required: false, description: 'ISO 639-1 code for translated fields (e.g. ar, en)' })
@Controller('gallery-categories')
export class GalleryCategoriesController {
  constructor(private readonly service: GalleryCategoriesService) {}

  @Get()
  @ApiOperation({ summary: 'List all gallery categories (public, paginated)', description: 'Returns categories that have not been soft-deleted. Use Accept-Language to get translated title and slug.' })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1, description: 'Page number (default: 1)' })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 100, description: 'Items per page (default: 100, max: 100)' })
  @ApiOkResponse({ type: GalleryCategoryListResponseDto, description: 'Paginated list of gallery categories' })
  findAll(@Lang() lang: string | null, @Query() query: PaginationDto) {
    return this.service.findAll(lang, query.page ?? 1, query.limit ?? 100);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single gallery category (public)', description: 'Returns the category with its translations. Falls back to the default language if no translation exists for the requested language.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: GalleryCategoryDetailResponseDto, description: 'Gallery category detail with translations' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No gallery category with that ID exists, or it has been deleted' })
  findOne(@Param('id') id: string, @Lang() lang: string | null) {
    return this.service.findOne(id, lang);
  }

  @Post()
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiBearerAuth('jwt')
  @RequirePermission('gallery-categories:create')
  @ApiOperation({ summary: 'Create a gallery category with translations', description: 'Requires permission: `gallery-categories:create`.' })
  @ApiCreatedResponse({ type: GalleryCategoryCreatedResponseDto, description: 'Gallery category created with all provided translations' })
  @ApiBadRequestResponse({ type: ValidationErrorDto, description: 'Validation failed' })
  @ApiUnauthorizedResponse({ type: UnauthorizedErrorDto, description: 'Missing or invalid JWT' })
  @ApiForbiddenResponse({ type: ForbiddenErrorDto, description: 'Insufficient permissions' })
  create(@Body() dto: CreateGalleryCategoryDto, @CurrentUser() user: CurrentUserPayload) {
    return this.service.create(dto, user.id);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiBearerAuth('jwt')
  @RequirePermission('gallery-categories:update')
  @ApiOperation({ summary: 'Update gallery category translations', description: 'Requires permission: `gallery-categories:update`.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: GalleryCategoryDetailResponseDto, description: 'Updated gallery category with all translations' })
  @ApiBadRequestResponse({ type: ValidationErrorDto, description: 'Validation failed' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No gallery category with that ID exists, or it has been deleted' })
  @ApiUnauthorizedResponse({ type: UnauthorizedErrorDto, description: 'Missing or invalid JWT' })
  @ApiForbiddenResponse({ type: ForbiddenErrorDto, description: 'Insufficient permissions' })
  update(@Param('id') id: string, @Body() dto: UpdateGalleryCategoryDto, @CurrentUser() user: CurrentUserPayload) {
    return this.service.update(id, dto, user.id);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiBearerAuth('jwt')
  @RequirePermission('gallery-categories:delete')
  @ApiOperation({
    summary: 'Soft-delete a gallery category',
    description:
      'Fails with 409 if the category still contains gallery images — reassign or delete those first. Requires permission: `gallery-categories:delete`.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: GalleryCategoryMessageResponseDto, description: 'Gallery category soft-deleted' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No gallery category with that ID exists, or it has already been deleted' })
  @ApiConflictResponse({ type: ConflictErrorDto, description: 'Cannot delete: this gallery category still has live gallery images attached' })
  @ApiUnauthorizedResponse({ type: UnauthorizedErrorDto, description: 'Missing or invalid JWT' })
  @ApiForbiddenResponse({ type: ForbiddenErrorDto, description: 'Insufficient permissions' })
  remove(@Param('id') id: string, @CurrentUser() user: CurrentUserPayload) {
    return this.service.softDelete(id, user.id);
  }
}
