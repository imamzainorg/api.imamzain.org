import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser, CurrentUserPayload } from '../common/decorators/current-user.decorator';
import { Lang } from '../common/decorators/language.decorator';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { PermissionGuard } from '../common/guards/permission.guard';
import { CreatePostCategoryDto, UpdatePostCategoryDto } from './dto/post-category.dto';
import { PostCategoriesService } from './post-categories.service';

@ApiTags('Post Categories')
@ApiHeader({ name: 'Accept-Language', required: false, description: 'ISO 639-1 code for translated fields (e.g. ar, en)' })
@Controller('post-categories')
export class PostCategoriesController {
  constructor(private readonly service: PostCategoriesService) {}

  @Get()
  @ApiOperation({ summary: 'List all post categories (public)' })
  findAll(@Lang() lang: string | null) {
    return this.service.findAll(lang);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single post category (public)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  findOne(@Param('id') id: string, @Lang() lang: string | null) {
    return this.service.findOne(id, lang);
  }

  @Post()
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiBearerAuth('jwt')
  @RequirePermission('post-categories:create')
  @ApiOperation({ summary: 'Create a post category with translations', description: 'Requires permission: `post-categories:create`.' })
  create(@Body() dto: CreatePostCategoryDto, @CurrentUser() user: CurrentUserPayload) {
    return this.service.create(dto, user.id);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiBearerAuth('jwt')
  @RequirePermission('post-categories:update')
  @ApiOperation({ summary: 'Update post category translations', description: 'Requires permission: `post-categories:update`.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdatePostCategoryDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.service.update(id, dto, user.id);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiBearerAuth('jwt')
  @RequirePermission('post-categories:delete')
  @ApiOperation({ summary: 'Soft-delete a post category', description: 'Fails with 409 if the category still contains posts. Requires permission: `post-categories:delete`.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  remove(@Param('id') id: string, @CurrentUser() user: CurrentUserPayload) {
    return this.service.softDelete(id, user.id);
  }
}
