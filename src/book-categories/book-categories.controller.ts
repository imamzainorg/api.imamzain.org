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
import { BookCategoriesService } from './book-categories.service';
import { CreateBookCategoryDto, UpdateBookCategoryDto } from './dto/book-category.dto';
import {
  BookCategoryCreatedResponseDto,
  BookCategoryDetailResponseDto,
  BookCategoryListResponseDto,
  BookCategoryMessageResponseDto,
} from './dto/book-category-response.dto';

@ApiTags('Book Categories')
@ApiHeader({ name: 'Accept-Language', required: false, description: 'ISO 639-1 code for translated fields (e.g. ar, en)' })
@Controller('book-categories')
export class BookCategoriesController {
  constructor(private readonly service: BookCategoriesService) {}

  @Get()
  @ApiOperation({ summary: 'List all book categories (public, paginated)', description: 'Returns categories that have not been soft-deleted. Use Accept-Language to get translated title and slug.' })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1, description: 'Page number (default: 1)' })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 100, description: 'Items per page (default: 100, max: 100)' })
  @ApiOkResponse({ type: BookCategoryListResponseDto, description: 'Paginated list of book categories' })
  findAll(@Lang() lang: string | null, @Query() query: PaginationDto) {
    return this.service.findAll(lang, query.page ?? 1, query.limit ?? 100);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single book category (public)', description: 'Returns the category with its translations. Falls back to the default language if the requested language translation does not exist.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: BookCategoryDetailResponseDto, description: 'Book category detail with translations' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No book category with that ID exists, or it has been deleted' })
  findOne(@Param('id') id: string, @Lang() lang: string | null) {
    return this.service.findOne(id, lang);
  }

  @Post()
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiBearerAuth('jwt')
  @RequirePermission('book-categories:create')
  @ApiOperation({ summary: 'Create a book category with translations', description: 'Requires permission: `book-categories:create`.' })
  @ApiCreatedResponse({ type: BookCategoryCreatedResponseDto, description: 'Book category created with all provided translations' })
  @ApiBadRequestResponse({ type: ValidationErrorDto, description: 'Validation failed' })
  @ApiUnauthorizedResponse({ type: UnauthorizedErrorDto, description: 'Missing or invalid JWT' })
  @ApiForbiddenResponse({ type: ForbiddenErrorDto, description: 'Insufficient permissions' })
  create(@Body() dto: CreateBookCategoryDto, @CurrentUser() user: CurrentUserPayload) {
    return this.service.create(dto, user.id);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiBearerAuth('jwt')
  @RequirePermission('book-categories:update')
  @ApiOperation({ summary: 'Update book category translations', description: 'Requires permission: `book-categories:update`.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: BookCategoryDetailResponseDto, description: 'Updated book category with all translations' })
  @ApiBadRequestResponse({ type: ValidationErrorDto, description: 'Validation failed' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No book category with that ID exists, or it has been deleted' })
  @ApiUnauthorizedResponse({ type: UnauthorizedErrorDto, description: 'Missing or invalid JWT' })
  @ApiForbiddenResponse({ type: ForbiddenErrorDto, description: 'Insufficient permissions' })
  update(@Param('id') id: string, @Body() dto: UpdateBookCategoryDto, @CurrentUser() user: CurrentUserPayload) {
    return this.service.update(id, dto, user.id);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiBearerAuth('jwt')
  @RequirePermission('book-categories:delete')
  @ApiOperation({ summary: 'Soft-delete a book category', description: 'Fails with 409 if the category still has books assigned to it — reassign or delete the books first. Requires permission: `book-categories:delete`.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: BookCategoryMessageResponseDto, description: 'Book category soft-deleted; existing books that referenced this category retain their category_id' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No book category with that ID exists, or it has been deleted' })
  @ApiConflictResponse({ type: ConflictErrorDto, description: 'Cannot delete a book category that still has books assigned to it — reassign or delete the books first' })
  @ApiUnauthorizedResponse({ type: UnauthorizedErrorDto, description: 'Missing or invalid JWT' })
  @ApiForbiddenResponse({ type: ForbiddenErrorDto, description: 'Insufficient permissions' })
  remove(@Param('id') id: string, @CurrentUser() user: CurrentUserPayload) {
    return this.service.softDelete(id, user.id);
  }
}
