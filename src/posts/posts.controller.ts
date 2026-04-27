import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser, CurrentUserPayload } from '../common/decorators/current-user.decorator';
import { Lang } from '../common/decorators/language.decorator';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { PermissionGuard } from '../common/guards/permission.guard';
import { CreatePostDto, PostQueryDto, TogglePublishDto, UpdatePostDto } from './dto/post.dto';
import { PostsService } from './posts.service';

@ApiTags('Posts')
@ApiHeader({ name: 'Accept-Language', required: false, description: 'ISO 639-1 code for translated fields (e.g. ar, en). Falls back to default translation.' })
@Controller('posts')
export class PostsController {
  constructor(private readonly postsService: PostsService) {}

  @Get()
  @ApiOperation({ summary: 'List published posts (public)', description: 'Returns only published posts. Increments view count on each fetch of a single post.' })
  findAll(@Query() query: PostQueryDto, @Lang() lang: string | null) {
    return this.postsService.findAll(query, lang, false);
  }

  @Get('by-slug/:slug')
  @ApiOperation({ summary: 'Get a published post by its translated slug (public)' })
  @ApiParam({ name: 'slug', example: 'hayat-al-imam-zain', description: 'URL slug from a post translation' })
  findBySlug(@Param('slug') slug: string, @Lang() lang: string | null) {
    return this.postsService.findBySlug(slug, lang);
  }

  @Get('admin')
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiBearerAuth('jwt')
  @RequirePermission('posts:read')
  @ApiOperation({ summary: 'List all posts including unpublished (admin)', description: 'Requires permission: `posts:read`' })
  findAdmin(@Query() query: PostQueryDto, @Lang() lang: string | null) {
    return this.postsService.findAll(query, lang, true);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single post by ID (public)', description: 'Increments the view counter on every request.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  findOne(@Param('id') id: string, @Lang() lang: string | null) {
    return this.postsService.findOne(id, lang);
  }

  @Post()
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiBearerAuth('jwt')
  @RequirePermission('posts:create')
  @ApiOperation({ summary: 'Create a new post with translations and optional attachments', description: 'Requires permission: `posts:create`. Exactly one translation must have `is_default: true`.' })
  create(@Body() dto: CreatePostDto, @CurrentUser() user: CurrentUserPayload) {
    return this.postsService.create(dto, user.id);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiBearerAuth('jwt')
  @RequirePermission('posts:update')
  @ApiOperation({ summary: 'Update a post and upsert translations', description: 'Requires permission: `posts:update`. Providing `attachment_ids` replaces all existing attachments.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdatePostDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.postsService.update(id, dto, user.id);
  }

  @Patch(':id/publish')
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiBearerAuth('jwt')
  @RequirePermission('posts:update')
  @ApiOperation({ summary: 'Publish or unpublish a post', description: 'Sets `published_at` automatically on first publish. Requires permission: `posts:update`.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  togglePublish(
    @Param('id') id: string,
    @Body() dto: TogglePublishDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.postsService.togglePublish(id, dto, user.id);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiBearerAuth('jwt')
  @RequirePermission('posts:delete')
  @ApiOperation({ summary: 'Soft-delete a post', description: 'Sets `deleted_at` — the post is hidden from all queries. Requires permission: `posts:delete`.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  remove(@Param('id') id: string, @CurrentUser() user: CurrentUserPayload) {
    return this.postsService.softDelete(id, user.id);
  }
}
