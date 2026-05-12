import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
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
import { PublicCache } from '../common/decorators/public-cache.decorator';
import { PermissionGuard } from '../common/guards/permission.guard';
import { BulkIdsDto, BulkPublishDto, CreatePostDto, PostQueryDto, TogglePublishDto, UpdatePostDto } from './dto/post.dto';
import {
  PostBulkResponseDto,
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
  @PublicCache(60)
  @ApiOperation({ summary: 'List published posts (public)', description: 'Returns only published posts. Increments view count on each fetch of a single post. Response is `Cache-Control: public, max-age=60, s-maxage=300` and varies by `Accept-Language`; the CDN absorbs the bulk of public traffic.' })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1, description: 'Page number (default: 1)' })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20, description: 'Items per page (default: 20, max: 100)' })
  @ApiQuery({ name: 'category_id', required: false, type: String, description: 'Filter by post category UUID' })
  @ApiQuery({ name: 'search', required: false, type: String, example: 'الإمام', description: 'Full-text search across post titles and body content' })
  @ApiQuery({ name: 'featured', required: false, type: Boolean, description: 'Limit to is_featured posts (homepage / hero rail)' })
  @ApiQuery({ name: 'sort', required: false, enum: ['newest', 'views'], description: '`newest` (default) or `views` (most-viewed first)' })
  @ApiOkResponse({ type: PostListResponseDto, description: 'Paginated list of published posts' })
  @ApiBadRequestResponse({ type: ValidationErrorDto, description: 'Invalid query parameters (page < 1, limit out of 1–100, or non-integer values)' })
  findAll(@Query() query: PostQueryDto, @Lang() lang: string | null) {
    return this.postsService.findAll(query, lang, false);
  }

  @Get('by-slug/:slug')
  @PublicCache(60)
  @ApiOperation({ summary: 'Get a published post by its translated slug (public)', description: 'Response is CDN-cacheable (`public, max-age=60, s-maxage=300`) and varies by `Accept-Language`.' })
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
  @ApiOperation({
    summary: 'List all posts including unpublished (admin)',
    description:
      'Admin list view. Returns drafts, scheduled, and published posts by default. Use `?status=draft|scheduled|published|all` to scope to one CMS tab. Requires permission: `posts:read`.',
  })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1, description: 'Page number (default: 1)' })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20, description: 'Items per page (default: 20, max: 100)' })
  @ApiQuery({ name: 'category_id', required: false, type: String, description: 'Filter by post category UUID' })
  @ApiQuery({ name: 'search', required: false, type: String, example: 'الإمام', description: 'Full-text search across post titles and body content' })
  @ApiQuery({ name: 'featured', required: false, type: Boolean })
  @ApiQuery({ name: 'sort', required: false, enum: ['newest', 'views'] })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ['draft', 'scheduled', 'published', 'all'],
    description:
      'Admin tab filter. `draft` = is_published=false AND (no published_at OR published_at in the past); `scheduled` = is_published=false AND published_at in the future; `published` = is_published=true; `all` (default) = everything.',
  })
  @ApiOkResponse({ type: PostListResponseDto, description: 'Paginated list of all posts' })
  @ApiBadRequestResponse({ type: ValidationErrorDto, description: 'Invalid query parameters (page < 1, limit out of 1–100, or non-integer values)' })
  @ApiUnauthorizedResponse({ type: UnauthorizedErrorDto, description: 'Missing or invalid JWT' })
  @ApiForbiddenResponse({ type: ForbiddenErrorDto, description: 'Insufficient permissions' })
  findAdmin(@Query() query: PostQueryDto, @Lang() lang: string | null) {
    return this.postsService.findAll(query, lang, true);
  }

  @Get('admin/:id')
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiBearerAuth('jwt')
  @RequirePermission('posts:read')
  @ApiOperation({ summary: 'Get a single post by ID including unpublished (admin)', description: 'Requires permission: `posts:read`. Returns drafts and unpublished posts.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: PostDetailResponseDto, description: 'Post detail with all translations and attached media records (regardless of publish state)' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No post with that ID exists, or it has been deleted' })
  @ApiUnauthorizedResponse({ type: UnauthorizedErrorDto, description: 'Missing or invalid JWT' })
  @ApiForbiddenResponse({ type: ForbiddenErrorDto, description: 'Insufficient permissions' })
  findAdminOne(@Param('id') id: string, @Lang() lang: string | null) {
    return this.postsService.findOne(id, lang, true);
  }

  @Get('trash')
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiBearerAuth('jwt')
  @RequirePermission('posts:delete')
  @ApiOperation({
    summary: 'List soft-deleted posts (CMS trash view)',
    description:
      'Returns posts whose `deleted_at` is set, paginated. Translation slugs are returned with the `__del_<timestamp>` suffix already stripped, so the CMS can show the original slug. Requires permission: `posts:delete`.',
  })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20 })
  @ApiOkResponse({ type: PostListResponseDto, description: 'Paginated list of trashed posts' })
  @ApiBadRequestResponse({ type: ValidationErrorDto, description: 'Invalid query parameters (page < 1, limit out of 1–100, or non-integer values)' })
  @ApiUnauthorizedResponse({ type: UnauthorizedErrorDto, description: 'Missing or invalid JWT' })
  @ApiForbiddenResponse({ type: ForbiddenErrorDto, description: 'Insufficient permissions' })
  findTrash(@Query() query: PaginationDto) {
    return this.postsService.findTrash(query.page ?? 1, query.limit ?? 20);
  }

  @Post(':id/restore')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiBearerAuth('jwt')
  @RequirePermission('posts:delete')
  @ApiOperation({
    summary: 'Restore a soft-deleted post',
    description:
      'Sets `deleted_at` back to null and unsuffixes each translation slug. Fails with 409 if any of the original slugs has been taken by another post in the meantime — rename the conflicting one first. Requires permission: `posts:delete`.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: PostMessageResponseDto, description: 'Post restored' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No soft-deleted post with that ID exists' })
  @ApiConflictResponse({ type: ConflictErrorDto, description: 'A live post has taken one of the restored slugs' })
  @ApiUnauthorizedResponse({ type: UnauthorizedErrorDto, description: 'Missing or invalid JWT' })
  @ApiForbiddenResponse({ type: ForbiddenErrorDto, description: 'Insufficient permissions' })
  restore(@Param('id') id: string, @CurrentUser() user: CurrentUserPayload) {
    return this.postsService.restore(id, user.id);
  }

  @Get(':id')
  @PublicCache(60)
  @ApiOperation({ summary: 'Get a single published post by ID (public)', description: 'Response is CDN-cacheable (`public, max-age=60, s-maxage=300`) and varies by `Accept-Language`.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: PostDetailResponseDto, description: 'Post detail with all translations and attached media records (published only)' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No published post with that ID exists, or it has been deleted/unpublished' })
  findOne(@Param('id') id: string, @Lang() lang: string | null) {
    return this.postsService.findOne(id, lang, false);
  }

  @Post(':id/view')
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @ApiOperation({ summary: 'Record a view for a published post (public)', description: 'Increments the view counter. Rate-limited to 30 calls per minute per IP.' })
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
  @ApiBadRequestResponse({ type: ValidationErrorDto, description: 'Validation failed, or translations did not contain exactly one is_default entry' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No post category with that category_id exists, or the cover_image_id does not match any media record' })
  @ApiConflictResponse({ type: ConflictErrorDto, description: 'A translation slug is already used by another post in the same language' })
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
  @ApiBadRequestResponse({ type: ValidationErrorDto, description: 'Validation failed, or the resulting translations did not contain exactly one is_default entry' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No post with that ID exists, or the new category_id / cover_image_id does not exist or has been soft-deleted' })
  @ApiConflictResponse({ type: ConflictErrorDto, description: 'A translation slug is already used by another post in the same language' })
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

  @Post('bulk/publish')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiBearerAuth('jwt')
  @RequirePermission('posts:update')
  @ApiOperation({
    summary: 'Bulk publish / unpublish posts',
    description:
      'Sets `is_published` on every post in `ids` whose current state differs. `published_at` is auto-filled on first publish (per row). Posts that are missing, already deleted, or already in the requested state are returned in `skipped`. Requires permission: `posts:update`. Max 200 ids per call.',
  })
  @ApiOkResponse({ type: PostBulkResponseDto, description: 'Counts of updated and skipped posts' })
  @ApiBadRequestResponse({ type: ValidationErrorDto, description: 'Validation failed (empty ids, more than 200 ids, etc.)' })
  @ApiUnauthorizedResponse({ type: UnauthorizedErrorDto, description: 'Missing or invalid JWT' })
  @ApiForbiddenResponse({ type: ForbiddenErrorDto, description: 'Insufficient permissions' })
  bulkPublish(@Body() dto: BulkPublishDto, @CurrentUser() user: CurrentUserPayload) {
    return this.postsService.bulkSetPublish(dto, user.id);
  }

  @Post('bulk/delete')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiBearerAuth('jwt')
  @RequirePermission('posts:delete')
  @ApiOperation({
    summary: 'Bulk soft-delete posts',
    description:
      'Soft-deletes every post in `ids` that is still live. Translation slugs are suffixed with `__del_<timestamp>` exactly like single-row delete, so the slugs become reusable. Missing / already-deleted ids are returned in `skipped`. Requires permission: `posts:delete`. Max 200 ids per call.',
  })
  @ApiOkResponse({ type: PostBulkResponseDto, description: 'Counts of deleted and skipped posts' })
  @ApiBadRequestResponse({ type: ValidationErrorDto, description: 'Validation failed (empty ids, more than 200 ids, etc.)' })
  @ApiUnauthorizedResponse({ type: UnauthorizedErrorDto, description: 'Missing or invalid JWT' })
  @ApiForbiddenResponse({ type: ForbiddenErrorDto, description: 'Insufficient permissions' })
  bulkDelete(@Body() dto: BulkIdsDto, @CurrentUser() user: CurrentUserPayload) {
    return this.postsService.bulkDelete(dto, user.id);
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
