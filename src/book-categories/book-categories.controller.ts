import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser, CurrentUserPayload } from '../common/decorators/current-user.decorator';
import { Lang } from '../common/decorators/language.decorator';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { PermissionGuard } from '../common/guards/permission.guard';
import { BookCategoriesService } from './book-categories.service';
import { CreateBookCategoryDto, UpdateBookCategoryDto } from './dto/book-category.dto';

@Controller('book-categories')
export class BookCategoriesController {
  constructor(private readonly service: BookCategoriesService) {}

  @Get()
  findAll(@Lang() lang: string | null) {
    return this.service.findAll(lang);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Lang() lang: string | null) {
    return this.service.findOne(id, lang);
  }

  @Post()
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePermission('book-categories:create')
  create(@Body() dto: CreateBookCategoryDto, @CurrentUser() user: CurrentUserPayload) {
    return this.service.create(dto, user.id);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePermission('book-categories:update')
  update(@Param('id') id: string, @Body() dto: UpdateBookCategoryDto, @CurrentUser() user: CurrentUserPayload) {
    return this.service.update(id, dto, user.id);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePermission('book-categories:delete')
  remove(@Param('id') id: string, @CurrentUser() user: CurrentUserPayload) {
    return this.service.softDelete(id, user.id);
  }
}
