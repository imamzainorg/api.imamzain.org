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
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser, CurrentUserPayload } from '../common/decorators/current-user.decorator';
import { Lang } from '../common/decorators/language.decorator';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { ConflictErrorDto, ForbiddenErrorDto, NotFoundErrorDto, UnauthorizedErrorDto, ValidationErrorDto } from '../common/dto/api-response.dto';
import { PaginationDto } from '../common/dto/pagination.dto';
import { PermissionGuard } from '../common/guards/permission.guard';
import { BookQueryDto, CreateBookDto, UpdateBookDto } from './dto/book.dto';
import {
  BookCreatedResponseDto,
  BookDetailResponseDto,
  BookListResponseDto,
  BookMessageResponseDto,
} from './dto/book-response.dto';
import { BooksService } from './books.service';

@ApiTags('Books')
@ApiHeader({ name: 'Accept-Language', required: false, description: 'ISO 639-1 code for translated fields (e.g. ar, en)' })
@Controller('books')
export class BooksController {
  constructor(private readonly booksService: BooksService) {}

  @Get()
  @ApiOperation({ summary: 'List all books (public)', description: 'Supports filtering by category and full-text search.' })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1, description: 'Page number (default: 1)' })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20, description: 'Items per page (default: 20, max: 100)' })
  @ApiQuery({ name: 'category_id', required: false, type: String, description: 'Filter by book category UUID' })
  @ApiQuery({ name: 'search', required: false, type: String, example: 'الصحيفة', description: 'Search across book titles' })
  @ApiOkResponse({ type: BookListResponseDto, description: 'Paginated list of books' })
  findAll(@Query() query: BookQueryDto, @Lang() lang: string | null) {
    return this.booksService.findAll(query, lang);
  }

  @Get('trash')
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiBearerAuth('jwt')
  @RequirePermission('books:delete')
  @ApiOperation({
    summary: 'List soft-deleted books (CMS trash view)',
    description:
      'Returns books with `deleted_at` set, paginated. ISBN is returned with the `__del_<timestamp>` suffix already stripped, so the CMS can show the original ISBN. Requires permission: `books:delete`.',
  })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20 })
  @ApiOkResponse({ type: BookListResponseDto, description: 'Paginated list of trashed books' })
  findTrash(@Query() query: PaginationDto) {
    return this.booksService.findTrash(query.page ?? 1, query.limit ?? 20);
  }

  @Post(':id/restore')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiBearerAuth('jwt')
  @RequirePermission('books:delete')
  @ApiOperation({
    summary: 'Restore a soft-deleted book',
    description:
      'Sets `deleted_at` back to null and unsuffixes the ISBN. Fails with 409 if the original ISBN is now used by another book. Requires permission: `books:delete`.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: BookMessageResponseDto, description: 'Book restored' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No soft-deleted book with that ID exists' })
  @ApiConflictResponse({ type: ConflictErrorDto, description: 'A live book has taken the restored ISBN' })
  restore(@Param('id') id: string, @CurrentUser() user: CurrentUserPayload) {
    return this.booksService.restore(id, user.id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single book by ID (public)', description: 'Returns the book with its translations. Falls back to the default translation if no translation exists for the requested language.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: BookDetailResponseDto, description: 'Book detail with all translations' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No book with that ID exists, or it has been deleted' })
  findOne(@Param('id') id: string, @Lang() lang: string | null) {
    return this.booksService.findOne(id, lang);
  }

  @Post(':id/view')
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @ApiOperation({ summary: 'Record a view for a book (public)', description: 'Increments the view counter. Rate-limited to 30 calls per minute per IP.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: BookMessageResponseDto, description: 'Book view counter incremented by 1' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No book with that ID exists, or it has been deleted' })
  trackView(@Param('id') id: string) {
    return this.booksService.trackView(id);
  }

  @Post()
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiBearerAuth('jwt')
  @RequirePermission('books:create')
  @ApiOperation({ summary: 'Create a new book with translations', description: 'Requires permission: `books:create`. Exactly one translation must have `is_default: true`.' })
  @ApiCreatedResponse({ type: BookCreatedResponseDto, description: 'Book created with all provided translations; returns the full book object' })
  @ApiBadRequestResponse({ type: ValidationErrorDto, description: 'Validation failed' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No book category with that category_id exists, or the cover_image_id does not match any media record' })
  @ApiConflictResponse({ type: ConflictErrorDto, description: 'A book with that ISBN already exists' })
  @ApiUnauthorizedResponse({ type: UnauthorizedErrorDto, description: 'Missing or invalid JWT' })
  @ApiForbiddenResponse({ type: ForbiddenErrorDto, description: 'Insufficient permissions' })
  create(@Body() dto: CreateBookDto, @CurrentUser() user: CurrentUserPayload) {
    return this.booksService.create(dto, user.id);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiBearerAuth('jwt')
  @RequirePermission('books:update')
  @ApiOperation({ summary: 'Update a book and upsert translations', description: 'Requires permission: `books:update`.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: BookDetailResponseDto, description: 'Updated book with all translations' })
  @ApiBadRequestResponse({ type: ValidationErrorDto, description: 'Validation failed, or the resulting translations did not contain exactly one is_default entry' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No book with that ID exists, or the new category_id / cover_image_id does not exist or has been soft-deleted' })
  @ApiConflictResponse({ type: ConflictErrorDto, description: 'A book with that ISBN already exists' })
  @ApiUnauthorizedResponse({ type: UnauthorizedErrorDto, description: 'Missing or invalid JWT' })
  @ApiForbiddenResponse({ type: ForbiddenErrorDto, description: 'Insufficient permissions' })
  update(@Param('id') id: string, @Body() dto: UpdateBookDto, @CurrentUser() user: CurrentUserPayload) {
    return this.booksService.update(id, dto, user.id);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiBearerAuth('jwt')
  @RequirePermission('books:delete')
  @ApiOperation({ summary: 'Soft-delete a book', description: 'Requires permission: `books:delete`.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: BookMessageResponseDto, description: 'Book soft-deleted; immediately hidden from all queries — data is preserved in the database' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No book with that ID exists, or it has already been deleted' })
  @ApiUnauthorizedResponse({ type: UnauthorizedErrorDto, description: 'Missing or invalid JWT' })
  @ApiForbiddenResponse({ type: ForbiddenErrorDto, description: 'Insufficient permissions' })
  remove(@Param('id') id: string, @CurrentUser() user: CurrentUserPayload) {
    return this.booksService.softDelete(id, user.id);
  }
}
