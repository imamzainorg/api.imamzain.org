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
import { Throttle } from '@nestjs/throttler';
import { Auth } from '../common/decorators/auth.decorator';
import { CurrentUser, CurrentUserPayload } from '../common/decorators/current-user.decorator';
import { Lang } from '../common/decorators/language.decorator';
import { ConflictErrorDto, NotFoundErrorDto, ValidationErrorDto } from '../common/dto/api-response.dto';
import { PaginationDto } from '../common/dto/pagination.dto';
import { PublicCache } from '../common/decorators/public-cache.decorator';
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
  @PublicCache(60)
  @ApiOperation({ summary: 'List all books (public)', description: 'Supports filtering by category and full-text search. Response is CDN-cacheable (`public, max-age=60, s-maxage=300`) and varies by `Accept-Language`. **List payload is slim** — each translation drops the `description` field. Call `GET /books/:id` for the full description.' })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1, description: 'Page number (default: 1)' })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20, description: 'Items per page (default: 20, max: 100)' })
  @ApiQuery({ name: 'category_id', required: false, type: String, description: 'Filter by book category UUID' })
  @ApiQuery({ name: 'search', required: false, type: String, example: 'الصحيفة', description: 'Search across book titles' })
  @ApiOkResponse({ type: BookListResponseDto, description: 'Paginated list of books' })
  @ApiBadRequestResponse({ type: ValidationErrorDto, description: 'Invalid query parameters (page < 1, limit out of 1–100, or non-integer values)' })
  findAll(@Query() query: BookQueryDto, @Lang() lang: string | null) {
    return this.booksService.findAll(query, lang);
  }

  @Get('trash')
  @Auth('books:delete')
  @ApiOperation({
    summary: 'List soft-deleted books (CMS trash view)',
    description:
      'Returns books with `deleted_at` set, paginated. ISBN is returned with the `__del_<timestamp>` suffix already stripped, so the CMS can show the original ISBN. Requires permission: `books:delete`.',
  })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20 })
  @ApiOkResponse({ type: BookListResponseDto, description: 'Paginated list of trashed books' })
  @ApiBadRequestResponse({ type: ValidationErrorDto, description: 'Invalid query parameters (page < 1, limit out of 1–100, or non-integer values)' })
  findTrash(@Query() query: PaginationDto) {
    return this.booksService.findTrash(query.page ?? 1, query.limit ?? 20);
  }

  @Post(':id/restore')
  @HttpCode(200)
  @Auth('books:delete')
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

  @Get('by-slug/:slug')
  @PublicCache(60, 300)
  @ApiOperation({
    summary: 'Get a single book by slug (public)',
    description:
      'Resolves a book by an editor-assigned translation slug, regardless of the visitor\'s Accept-Language — the display translation still respects Accept-Language. 404 if no live book owns that slug. CDN-cacheable.',
  })
  @ApiParam({ name: 'slug', example: 'al-sahifa-al-sajjadiyya' })
  @ApiOkResponse({ type: BookDetailResponseDto, description: 'Book detail with all translations' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No live book owns that slug' })
  findBySlug(@Param('slug') slug: string, @Lang() lang: string | null) {
    return this.booksService.findBySlug(slug, lang);
  }

  @Get(':id')
  @PublicCache(60)
  @ApiOperation({ summary: 'Get a single book by ID (public)', description: 'Returns the book with its translations. Falls back to the default translation if no translation exists for the requested language. Response is CDN-cacheable (`public, max-age=60, s-maxage=300`) and varies by `Accept-Language`.' })
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
  @Auth('books:create')
  @ApiOperation({ summary: 'Create a new book with translations', description: 'Requires permission: `books:create`. Exactly one translation must have `is_default: true`.' })
  @ApiCreatedResponse({ type: BookCreatedResponseDto, description: 'Book created with all provided translations; returns the full book object' })
  @ApiBadRequestResponse({ type: ValidationErrorDto, description: 'Validation failed' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No book category with that category_id exists, or the cover_image_id does not match any media record' })
  @ApiConflictResponse({ type: ConflictErrorDto, description: 'A book with that ISBN already exists' })
  create(@Body() dto: CreateBookDto, @CurrentUser() user: CurrentUserPayload, @Lang() lang: string | null) {
    return this.booksService.create(dto, user.id, lang);
  }

  @Patch(':id')
  @Auth('books:update')
  @ApiOperation({ summary: 'Update a book and upsert translations', description: 'Requires permission: `books:update`.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: BookDetailResponseDto, description: 'Updated book with all translations' })
  @ApiBadRequestResponse({ type: ValidationErrorDto, description: 'Validation failed, or the resulting translations did not contain exactly one is_default entry' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No book with that ID exists, or the new category_id / cover_image_id does not exist or has been soft-deleted' })
  @ApiConflictResponse({ type: ConflictErrorDto, description: 'A book with that ISBN already exists' })
  update(@Param('id') id: string, @Body() dto: UpdateBookDto, @CurrentUser() user: CurrentUserPayload, @Lang() lang: string | null) {
    return this.booksService.update(id, dto, user.id, lang);
  }

  @Delete(':id')
  @Auth('books:delete')
  @ApiOperation({ summary: 'Soft-delete a book', description: 'Requires permission: `books:delete`.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: BookMessageResponseDto, description: 'Book soft-deleted; immediately hidden from all queries — data is preserved in the database' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No book with that ID exists, or it has already been deleted' })
  remove(@Param('id') id: string, @CurrentUser() user: CurrentUserPayload) {
    return this.booksService.softDelete(id, user.id);
  }
}
