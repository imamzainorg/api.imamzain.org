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
import { CreatePostCategoryDto, UpdatePostCategoryDto } from './dto/post-category.dto';
import {
  PostCategoryCreatedResponseDto,
  PostCategoryDetailResponseDto,
  PostCategoryListResponseDto,
  PostCategoryMessageResponseDto,
} from './dto/post-category-response.dto';
import { PostCategoriesService } from './post-categories.service';

@ApiTags('Post Categories')
@ApiHeader({ name: 'Accept-Language', required: false, description: 'ISO 639-1 code for translated fields (e.g. ar, en)' })
@Controller('post-categories')
export class PostCategoriesController {
  constructor(private readonly service: PostCategoriesService) {}

  @Get()
  @PublicCache(300, 1800)
  @ApiOperation({ summary: 'List all post categories (public, paginated)', description: 'Returns categories that have not been soft-deleted. Use Accept-Language to get translated title and slug. Response is CDN-cacheable (`public, max-age=300, s-maxage=1800`) and varies by `Accept-Language` — categories change rarely, so the longer TTL is safe.' })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1, description: 'Page number (default: 1)' })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 100, description: 'Items per page (default: 100, max: 100)' })
  @ApiOkResponse({ type: PostCategoryListResponseDto, description: 'Paginated list of post categories' })
  @ApiBadRequestResponse({ type: ValidationErrorDto, description: 'Invalid query parameters (page < 1, limit out of 1–100, or non-integer values)' })
  findAll(@Lang() lang: string | null, @Query() query: PaginationDto) {
    return this.service.findAll(lang, query.page ?? 1, query.limit ?? 100);
  }

  @Get('trash')
  @Auth('post-categories:delete')
  @ApiOperation({
    summary: 'List soft-deleted post categories (CMS trash view)',
    description:
      'Paginated list of categories whose `deleted_at` is set. Translation slugs come back with the `__del_<timestamp>` suffix already stripped so the CMS can show the original slug. Requires permission: `post-categories:delete`.',
  })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20 })
  @ApiOkResponse({ type: PostCategoryListResponseDto, description: 'Paginated list of trashed post categories' })
  @ApiBadRequestResponse({ type: ValidationErrorDto, description: 'Invalid query parameters (page < 1, limit out of 1–100, or non-integer values)' })
  findTrash(@Query() query: PaginationDto) {
    return this.service.findTrash(query.page ?? 1, query.limit ?? 20);
  }

  @Post(':id/restore')
  @HttpCode(200)
  @Auth('post-categories:delete')
  @ApiOperation({
    summary: 'Restore a soft-deleted post category',
    description:
      'Sets `deleted_at` back to null and unsuffixes each translation slug. Fails with 409 if any of the original `(lang, slug)` pairs has been claimed by another category in the meantime — rename the conflicting one first. Requires permission: `post-categories:delete`.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: PostCategoryMessageResponseDto, description: 'Category restored' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No soft-deleted category with that ID exists' })
  @ApiConflictResponse({ type: ConflictErrorDto, description: 'A live category has taken one of the restored translation slugs' })
  restore(@Param('id') id: string, @CurrentUser() user: CurrentUserPayload) {
    return this.service.restore(id, user.id);
  }

  @Get(':id')
  @PublicCache(300, 1800)
  @ApiOperation({ summary: 'Get a single post category (public)', description: 'Returns the category with its translations. Falls back to the default language if no translation exists for the requested language. Response is CDN-cacheable (`public, max-age=300, s-maxage=1800`) and varies by `Accept-Language`.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: PostCategoryDetailResponseDto, description: 'Post category detail with translations' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No post category with that ID exists, or it has been deleted' })
  findOne(@Param('id') id: string, @Lang() lang: string | null) {
    return this.service.findOne(id, lang);
  }

  @Post()
  @Auth('post-categories:create')
  @ApiOperation({ summary: 'Create a post category with translations', description: 'Requires permission: `post-categories:create`.' })
  @ApiCreatedResponse({ type: PostCategoryCreatedResponseDto, description: 'Post category created with all provided translations; returns the new category record' })
  @ApiBadRequestResponse({ type: ValidationErrorDto, description: 'Validation failed' })
  create(@Body() dto: CreatePostCategoryDto, @CurrentUser() user: CurrentUserPayload) {
    return this.service.create(dto, user.id);
  }

  @Patch(':id')
  @Auth('post-categories:update')
  @ApiOperation({ summary: 'Update post category translations', description: 'Requires permission: `post-categories:update`.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: PostCategoryDetailResponseDto, description: 'Updated post category with all translations' })
  @ApiBadRequestResponse({ type: ValidationErrorDto, description: 'Validation failed' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No post category with that ID exists, or it has been deleted' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdatePostCategoryDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.service.update(id, dto, user.id);
  }

  @Delete(':id')
  @Auth('post-categories:delete')
  @ApiOperation({ summary: 'Soft-delete a post category', description: 'Fails with 409 if the category still contains posts. Requires permission: `post-categories:delete`.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: PostCategoryMessageResponseDto, description: 'Post category soft-deleted; existing posts that referenced this category retain their category_id' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No post category with that ID exists, or it has already been deleted' })
  @ApiConflictResponse({ type: ConflictErrorDto, description: 'Cannot delete a post category that still has posts assigned to it — reassign or delete the posts first' })
  remove(@Param('id') id: string, @CurrentUser() user: CurrentUserPayload) {
    return this.service.softDelete(id, user.id);
  }
}
