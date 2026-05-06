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
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
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
import { ForbiddenErrorDto, NotFoundErrorDto, UnauthorizedErrorDto, ValidationErrorDto } from '../common/dto/api-response.dto';
import { PermissionGuard } from '../common/guards/permission.guard';
import { CreatePostDto, PostQueryDto, TogglePublishDto, UpdatePostDto } from './dto/post.dto';
import {
  PostCreatedResponseDto,
  PostDetailResponseDto,
  PostListResponseDto,
  PostMessageResponseDto,
} from './dto/post-response.dto';
import { PostsService } from './posts.service';

@ApiTags('Posts')
@ApiHeader({ name: 'Accept-Language', required: false, description: 'ISO 639-1 code for translated fields (e.g. ar, en). Falls back to default translation.' })
@Controller('posts')
export class PostsController {
  constructor(private readonly postsService: PostsService) {}

  @Get()
  @ApiOperation({ summary: 'List published posts (public)', description: 'Returns only published posts. Increments view count on each fetch of a single post.' })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1, description: 'Page number (default: 1)' })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20, description: 'Items per page (default: 20, max: 100)' })
  @ApiQuery({ name: 'category_id', required: false, type: String, description: 'Filter by post category UUID' })
  @ApiQuery({ name: 'search', required: false, type: String, example: 'الإمام', description: 'Full-text search across post titles and body content' })
  @ApiOkResponse({ type: PostListResponseDto, description: 'Paginated list of published posts' })
  findAll(@Query() query: PostQueryDto, @Lang() lang: string | null) {
    return this.postsService.findAll(query, lang, false);
  }

  @Get('by-slug/:slug')
  @ApiOperation({ summary: 'Get a published post by its translated slug (public)' })
  @ApiParam({ name: 'slug', example: 'hayat-al-imam-zain', description: 'URL slug from a post translation' })
  @ApiOkResponse({ type: PostDetailResponseDto, description: 'Post detail with all translations and attached media records' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No published post with that slug exists in any language' })
  findBySlug(@Param('slug') slug: string, @Lang() lang: string | null) {
    return this.postsService.findBySlug(slug, lang);
  }

  @Get('admin')
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiBearerAuth('jwt')
  @RequirePermission('posts:read')
  @ApiOperation({ summary: 'List all posts including unpublished (admin)', description: 'Requires permission: `posts:read`' })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1, description: 'Page number (default: 1)' })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20, description: 'Items per page (default: 20, max: 100)' })
  @ApiQuery({ name: 'category_id', required: false, type: String, description: 'Filter by post category UUID' })
  @ApiQuery({ name: 'search', required: false, type: String, example: 'الإمام', description: 'Full-text search across post titles and body content' })
  @ApiOkResponse({ type: PostListResponseDto, description: 'Paginated list of all posts' })
  @ApiUnauthorizedResponse({ type: UnauthorizedErrorDto, description: 'Missing or invalid JWT' })
  @ApiForbiddenResponse({ type: ForbiddenErrorDto, description: 'Insufficient permissions' })
  findAdmin(@Query() query: PostQueryDto, @Lang() lang: string | null) {
    return this.postsService.findAll(query, lang, true);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single post by ID (public)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: PostDetailResponseDto, description: 'Post detail with all translations and attached media records' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No post with that ID exists, or it has been deleted' })
  findOne(@Param('id') id: string, @Lang() lang: string | null) {
    return this.postsService.findOne(id, lang);
  }

  @Post(':id/view')
  @ApiOperation({ summary: 'Record a view for a published post (public)', description: 'Increments the view counter. Call this explicitly when a reader views the post content.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: PostMessageResponseDto, description: 'View counter incremented by 1; only applies to currently published posts' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No post with that ID exists, it has been deleted, or it is not currently published' })
  trackView(@Param('id') id: string) {
    return this.postsService.trackView(id);
  }

  @Post()
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiBearerAuth('jwt')
  @RequirePermission('posts:create')
  @ApiOperation({ summary: 'Create a new post with translations and optional attachments', description: 'Requires permission: `posts:create`. Exactly one translation must have `is_default: true`.' })
  @ApiCreatedResponse({ type: PostCreatedResponseDto, description: 'Post created with all provided translations; returns the full post object including translation records and attachment list' })
  @ApiBadRequestResponse({ type: ValidationErrorDto, description: 'Validation failed' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No post category with that category_id exists, or the cover_image_id does not match any media record' })
  @ApiUnauthorizedResponse({ type: UnauthorizedErrorDto, description: 'Missing or invalid JWT' })
  @ApiForbiddenResponse({ type: ForbiddenErrorDto, description: 'Insufficient permissions' })
  create(@Body() dto: CreatePostDto, @CurrentUser() user: CurrentUserPayload) {
    return this.postsService.create(dto, user.id);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiBearerAuth('jwt')
  @RequirePermission('posts:update')
  @ApiOperation({ summary: 'Update a post and upsert translations', description: 'Requires permission: `posts:update`. Providing `attachment_ids` replaces all existing attachments.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: PostDetailResponseDto, description: 'Updated post with all translations; if attachment_ids was provided the attachment list reflects the replacement' })
  @ApiBadRequestResponse({ type: ValidationErrorDto, description: 'Validation failed' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No post with that ID exists, or it has been deleted' })
  @ApiUnauthorizedResponse({ type: UnauthorizedErrorDto, description: 'Missing or invalid JWT' })
  @ApiForbiddenResponse({ type: ForbiddenErrorDto, description: 'Insufficient permissions' })
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
  @ApiOkResponse({ type: PostDetailResponseDto, description: 'Post publish state updated; published_at is set automatically on the first publish and is never overwritten on subsequent publishes' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No post with that ID exists, or it has been deleted' })
  @ApiUnauthorizedResponse({ type: UnauthorizedErrorDto, description: 'Missing or invalid JWT' })
  @ApiForbiddenResponse({ type: ForbiddenErrorDto, description: 'Insufficient permissions' })
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
  @ApiOkResponse({ type: PostMessageResponseDto, description: 'Post soft-deleted; immediately hidden from all public and admin list queries — data is preserved in the database' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No post with that ID exists, or it has already been deleted' })
  @ApiUnauthorizedResponse({ type: UnauthorizedErrorDto, description: 'Missing or invalid JWT' })
  @ApiForbiddenResponse({ type: ForbiddenErrorDto, description: 'Insufficient permissions' })
  remove(@Param('id') id: string, @CurrentUser() user: CurrentUserPayload) {
    return this.postsService.softDelete(id, user.id);
  }
}
