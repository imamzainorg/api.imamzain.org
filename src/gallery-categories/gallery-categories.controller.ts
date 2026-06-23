import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { Auth } from '../common/decorators/auth.decorator';
import { CurrentUser, CurrentUserPayload } from '../common/decorators/current-user.decorator';
import { Lang } from '../common/decorators/language.decorator';
import { ConflictErrorDto, NotFoundErrorDto, ValidationErrorDto } from '../common/dto/api-response.dto';
import { PaginationDto } from '../common/dto/pagination.dto';
import { PublicCache } from '../common/decorators/public-cache.decorator';
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
  @PublicCache(300, 1800)
  @ApiOperation({ summary: 'List all gallery categories (public, paginated)', description: 'Returns categories that have not been soft-deleted. Use Accept-Language to get translated title and slug. Response is CDN-cacheable (`public, max-age=300, s-maxage=1800`) and varies by `Accept-Language`.' })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1, description: 'Page number (default: 1)' })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 100, description: 'Items per page (default: 100, max: 100)' })
  @ApiOkResponse({ type: GalleryCategoryListResponseDto, description: 'Paginated list of gallery categories' })
  @ApiBadRequestResponse({ type: ValidationErrorDto, description: 'Invalid query parameters (page < 1, limit out of 1–100, or non-integer values)' })
  findAll(@Lang() lang: string | null, @Query() query: PaginationDto) {
    return this.service.findAll(lang, query.page ?? 1, query.limit ?? 100);
  }

  @Get('trash')
  @Auth('gallery-categories:delete')
  @ApiOperation({
    summary: 'List soft-deleted gallery categories (CMS trash view)',
    description:
      'Paginated list of categories whose `deleted_at` is set. Translation slugs come back with the `__del_<timestamp>` suffix already stripped so the CMS can show the original slug. Requires permission: `gallery-categories:delete`.',
  })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20 })
  @ApiOkResponse({ type: GalleryCategoryListResponseDto, description: 'Paginated list of trashed gallery categories' })
  @ApiBadRequestResponse({ type: ValidationErrorDto, description: 'Invalid query parameters (page < 1, limit out of 1–100, or non-integer values)' })
  findTrash(@Query() query: PaginationDto) {
    return this.service.findTrash(query.page ?? 1, query.limit ?? 20);
  }

  @Post(':id/restore')
  @HttpCode(200)
  @Auth('gallery-categories:delete')
  @ApiOperation({
    summary: 'Restore a soft-deleted gallery category',
    description:
      'Sets `deleted_at` back to null and unsuffixes each translation slug. Fails with 409 if any of the original `(lang, slug)` pairs has been claimed by another category in the meantime — rename the conflicting one first. Requires permission: `gallery-categories:delete`.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: GalleryCategoryMessageResponseDto, description: 'Category restored' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No soft-deleted category with that ID exists' })
  @ApiConflictResponse({ type: ConflictErrorDto, description: 'A live category has taken one of the restored translation slugs' })
  restore(@Param('id') id: string, @CurrentUser() user: CurrentUserPayload) {
    return this.service.restore(id, user.id);
  }

  @Get(':id')
  @PublicCache(300, 1800)
  @ApiOperation({ summary: 'Get a single gallery category (public)', description: 'Returns the category with its translations. Falls back to the default language if no translation exists for the requested language. Response is CDN-cacheable (`public, max-age=300, s-maxage=1800`) and varies by `Accept-Language`.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: GalleryCategoryDetailResponseDto, description: 'Gallery category detail with translations' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No gallery category with that ID exists, or it has been deleted' })
  findOne(@Param('id') id: string, @Lang() lang: string | null) {
    return this.service.findOne(id, lang);
  }

  @Post()
  @Auth('gallery-categories:create')
  @ApiOperation({ summary: 'Create a gallery category with translations', description: 'Requires permission: `gallery-categories:create`.' })
  @ApiCreatedResponse({ type: GalleryCategoryCreatedResponseDto, description: 'Gallery category created with all provided translations' })
  @ApiBadRequestResponse({ type: ValidationErrorDto, description: 'Validation failed' })
  create(@Body() dto: CreateGalleryCategoryDto, @CurrentUser() user: CurrentUserPayload) {
    return this.service.create(dto, user.id);
  }

  @Patch(':id')
  @Auth('gallery-categories:update')
  @ApiOperation({ summary: 'Update gallery category translations', description: 'Requires permission: `gallery-categories:update`.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: GalleryCategoryDetailResponseDto, description: 'Updated gallery category with all translations' })
  @ApiBadRequestResponse({ type: ValidationErrorDto, description: 'Validation failed' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No gallery category with that ID exists, or it has been deleted' })
  update(@Param('id') id: string, @Body() dto: UpdateGalleryCategoryDto, @CurrentUser() user: CurrentUserPayload) {
    return this.service.update(id, dto, user.id);
  }

  @Delete(':id')
  @Auth('gallery-categories:delete')
  @ApiOperation({
    summary: 'Soft-delete a gallery category',
    description:
      'Fails with 409 if the category still contains gallery images — reassign or delete those first. Requires permission: `gallery-categories:delete`.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: GalleryCategoryMessageResponseDto, description: 'Gallery category soft-deleted' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No gallery category with that ID exists, or it has already been deleted' })
  @ApiConflictResponse({ type: ConflictErrorDto, description: 'Cannot delete: this gallery category still has live gallery images attached' })
  remove(@Param('id') id: string, @CurrentUser() user: CurrentUserPayload) {
    return this.service.softDelete(id, user.id);
  }
}
