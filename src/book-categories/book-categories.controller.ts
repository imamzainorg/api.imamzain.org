import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser, CurrentUserPayload } from '../common/decorators/current-user.decorator';
import { Lang } from '../common/decorators/language.decorator';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { PermissionGuard } from '../common/guards/permission.guard';
import { BookCategoriesService } from './book-categories.service';
import { CreateBookCategoryDto, UpdateBookCategoryDto } from './dto/book-category.dto';

@ApiTags('Book Categories')
@ApiHeader({ name: 'Accept-Language', required: false, description: 'ISO 639-1 code for translated fields (e.g. ar, en)' })
@Controller('book-categories')
export class BookCategoriesController {
  constructor(private readonly service: BookCategoriesService) {}

  @Get()
  @ApiOperation({ summary: 'List all book categories (public)' })
  findAll(@Lang() lang: string | null) {
    return this.service.findAll(lang);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single book category (public)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  findOne(@Param('id') id: string, @Lang() lang: string | null) {
    return this.service.findOne(id, lang);
  }

  @Post()
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiBearerAuth('jwt')
  @RequirePermission('book-categories:create')
  @ApiOperation({ summary: 'Create a book category with translations', description: 'Requires permission: `book-categories:create`.' })
  create(@Body() dto: CreateBookCategoryDto, @CurrentUser() user: CurrentUserPayload) {
    return this.service.create(dto, user.id);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiBearerAuth('jwt')
  @RequirePermission('book-categories:update')
  @ApiOperation({ summary: 'Update book category translations', description: 'Requires permission: `book-categories:update`.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  update(@Param('id') id: string, @Body() dto: UpdateBookCategoryDto, @CurrentUser() user: CurrentUserPayload) {
    return this.service.update(id, dto, user.id);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiBearerAuth('jwt')
  @RequirePermission('book-categories:delete')
  @ApiOperation({ summary: 'Soft-delete a book category', description: 'Requires permission: `book-categories:delete`.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  remove(@Param('id') id: string, @CurrentUser() user: CurrentUserPayload) {
    return this.service.softDelete(id, user.id);
  }
}
