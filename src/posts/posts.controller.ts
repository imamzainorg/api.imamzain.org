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
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser, CurrentUserPayload } from '../common/decorators/current-user.decorator';
import { Lang } from '../common/decorators/language.decorator';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { PermissionGuard } from '../common/guards/permission.guard';
import { CreatePostDto, PostQueryDto, TogglePublishDto, UpdatePostDto } from './dto/post.dto';
import { PostsService } from './posts.service';

@Controller('posts')
export class PostsController {
  constructor(private readonly postsService: PostsService) {}

  @Get()
  findAll(@Query() query: PostQueryDto, @Lang() lang: string | null) {
    return this.postsService.findAll(query, lang, false);
  }

  @Get('by-slug/:slug')
  findBySlug(@Param('slug') slug: string, @Lang() lang: string | null) {
    return this.postsService.findBySlug(slug, lang);
  }

  @Get('admin')
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePermission('posts:read')
  findAdmin(@Query() query: PostQueryDto, @Lang() lang: string | null) {
    return this.postsService.findAll(query, lang, true);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Lang() lang: string | null) {
    return this.postsService.findOne(id, lang);
  }

  @Post()
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePermission('posts:create')
  create(@Body() dto: CreatePostDto, @CurrentUser() user: CurrentUserPayload) {
    return this.postsService.create(dto, user.id);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePermission('posts:update')
  update(
    @Param('id') id: string,
    @Body() dto: UpdatePostDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.postsService.update(id, dto, user.id);
  }

  @Patch(':id/publish')
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePermission('posts:update')
  togglePublish(
    @Param('id') id: string,
    @Body() dto: TogglePublishDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.postsService.togglePublish(id, dto, user.id);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePermission('posts:delete')
  remove(@Param('id') id: string, @CurrentUser() user: CurrentUserPayload) {
    return this.postsService.softDelete(id, user.id);
  }
}
