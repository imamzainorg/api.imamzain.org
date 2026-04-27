import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser, CurrentUserPayload } from '../common/decorators/current-user.decorator';
import { Lang } from '../common/decorators/language.decorator';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { PermissionGuard } from '../common/guards/permission.guard';
import { BookQueryDto, CreateBookDto, UpdateBookDto } from './dto/book.dto';
import { BooksService } from './books.service';

@ApiTags('Books')
@ApiHeader({ name: 'Accept-Language', required: false, description: 'ISO 639-1 code for translated fields (e.g. ar, en)' })
@Controller('books')
export class BooksController {
  constructor(private readonly booksService: BooksService) {}

  @Get()
  @ApiOperation({ summary: 'List all books (public)', description: 'Supports filtering by category and full-text search.' })
  findAll(@Query() query: BookQueryDto, @Lang() lang: string | null) {
    return this.booksService.findAll(query, lang);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single book by ID (public)', description: 'Increments the view counter on every request.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  findOne(@Param('id') id: string, @Lang() lang: string | null) {
    return this.booksService.findOne(id, lang);
  }

  @Post()
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiBearerAuth('jwt')
  @RequirePermission('books:create')
  @ApiOperation({ summary: 'Create a new book with translations', description: 'Requires permission: `books:create`. Exactly one translation must have `is_default: true`.' })
  create(@Body() dto: CreateBookDto, @CurrentUser() user: CurrentUserPayload) {
    return this.booksService.create(dto, user.id);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiBearerAuth('jwt')
  @RequirePermission('books:update')
  @ApiOperation({ summary: 'Update a book and upsert translations', description: 'Requires permission: `books:update`.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  update(@Param('id') id: string, @Body() dto: UpdateBookDto, @CurrentUser() user: CurrentUserPayload) {
    return this.booksService.update(id, dto, user.id);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiBearerAuth('jwt')
  @RequirePermission('books:delete')
  @ApiOperation({ summary: 'Soft-delete a book', description: 'Requires permission: `books:delete`.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  remove(@Param('id') id: string, @CurrentUser() user: CurrentUserPayload) {
    return this.booksService.softDelete(id, user.id);
  }
}
