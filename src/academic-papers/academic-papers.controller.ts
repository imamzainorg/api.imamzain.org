import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCreatedResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { Auth } from '../common/decorators/auth.decorator';
import { CurrentUser, CurrentUserPayload } from '../common/decorators/current-user.decorator';
import { Lang } from '../common/decorators/language.decorator';
import { NotFoundErrorDto, ValidationErrorDto } from '../common/dto/api-response.dto';
import { PaginationDto } from '../common/dto/pagination.dto';
import { PublicCache } from '../common/decorators/public-cache.decorator';
import { AcademicPapersService } from './academic-papers.service';
import { AcademicPaperQueryDto, CreateAcademicPaperDto, UpdateAcademicPaperDto } from './dto/academic-paper.dto';
import {
  AcademicPaperCreatedResponseDto,
  AcademicPaperDetailResponseDto,
  AcademicPaperListResponseDto,
  AcademicPaperMessageResponseDto,
} from './dto/academic-paper-response.dto';

@ApiTags('Academic Papers')
@ApiHeader({ name: 'Accept-Language', required: false, description: 'ISO 639-1 code for translated fields (e.g. ar, en)' })
@Controller('academic-papers')
export class AcademicPapersController {
  constructor(private readonly service: AcademicPapersService) {}

  @Get()
  @PublicCache(60)
  @ApiOperation({ summary: 'List academic papers (public)', description: 'Supports filtering by category and full-text search. Response is CDN-cacheable (`public, max-age=60, s-maxage=300`) and varies by `Accept-Language`. **List payload is slim** — each translation drops the `abstract` field. Call `GET /academic-papers/:id` for the full abstract.' })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1, description: 'Page number (default: 1)' })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20, description: 'Items per page (default: 20, max: 100)' })
  @ApiQuery({ name: 'category_id', required: false, type: String, description: 'Filter by academic paper category UUID' })
  @ApiQuery({ name: 'search', required: false, type: String, example: 'فقه', description: 'Search across paper titles and abstracts' })
  @ApiOkResponse({ type: AcademicPaperListResponseDto, description: 'Paginated list of academic papers' })
  @ApiBadRequestResponse({ type: ValidationErrorDto, description: 'Invalid query parameters (page < 1, limit out of 1–100, or non-integer values)' })
  findAll(@Query() query: AcademicPaperQueryDto, @Lang() lang: string | null) {
    return this.service.findAll(query, lang);
  }

  @Get('trash')
  @Auth('academic-papers:delete')
  @ApiOperation({
    summary: 'List soft-deleted academic papers (CMS trash view)',
    description:
      'Paginated list of academic papers whose `deleted_at` is set. Requires permission: `academic-papers:delete`.',
  })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20 })
  @ApiOkResponse({ type: AcademicPaperListResponseDto, description: 'Paginated list of trashed academic papers' })
  @ApiBadRequestResponse({ type: ValidationErrorDto, description: 'Invalid query parameters (page < 1, limit out of 1–100, or non-integer values)' })
  findTrash(@Query() query: PaginationDto) {
    return this.service.findTrash(query.page ?? 1, query.limit ?? 20);
  }

  @Post(':id/restore')
  @HttpCode(200)
  @Auth('academic-papers:delete')
  @ApiOperation({
    summary: 'Restore a soft-deleted academic paper',
    description:
      'Sets `deleted_at` back to null and reverses any per-translation slug suffix. Fails with 409 if the original slug was claimed by another paper meanwhile. Requires permission: `academic-papers:delete`.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: AcademicPaperMessageResponseDto, description: 'Academic paper restored' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No soft-deleted paper with that ID exists' })
  restore(@Param('id') id: string, @CurrentUser() user: CurrentUserPayload) {
    return this.service.restore(id, user.id);
  }

  @Get('by-slug/:slug')
  @PublicCache(60, 300)
  @ApiOperation({
    summary: 'Get a single academic paper by slug (public)',
    description:
      'Resolves a paper by an editor-assigned translation slug, regardless of the visitor\'s Accept-Language. 404 if no live paper owns that slug. CDN-cacheable.',
  })
  @ApiParam({ name: 'slug', example: 'fiqh-al-imam-sajjad' })
  @ApiOkResponse({ type: AcademicPaperDetailResponseDto, description: 'Academic paper detail with all translations' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No live paper owns that slug' })
  findBySlug(@Param('slug') slug: string, @Lang() lang: string | null) {
    return this.service.findBySlug(slug, lang);
  }

  @Get(':id')
  @PublicCache(60)
  @ApiOperation({ summary: 'Get a single academic paper by ID (public)', description: 'Returns the paper with its translations. Falls back to the default translation if no translation exists for the requested language. Response is CDN-cacheable (`public, max-age=60, s-maxage=300`) and varies by `Accept-Language`.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: AcademicPaperDetailResponseDto, description: 'Academic paper detail with all translations' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No academic paper with that ID exists, or it has been deleted' })
  findOne(@Param('id') id: string, @Lang() lang: string | null) {
    return this.service.findOne(id, lang);
  }

  @Post()
  @Auth('academic-papers:create')
  @ApiOperation({ summary: 'Create an academic paper with translations', description: 'Requires permission: `academic-papers:create`. Exactly one translation must have `is_default: true`.' })
  @ApiCreatedResponse({ type: AcademicPaperCreatedResponseDto, description: 'Academic paper created with all provided translations; returns the full paper object' })
  @ApiBadRequestResponse({ type: ValidationErrorDto, description: 'Validation failed, or translations did not contain exactly one is_default entry' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No academic paper category with that category_id exists' })
  create(@Body() dto: CreateAcademicPaperDto, @CurrentUser() user: CurrentUserPayload, @Lang() lang: string | null) {
    return this.service.create(dto, user.id, lang);
  }

  @Patch(':id')
  @Auth('academic-papers:update')
  @ApiOperation({ summary: 'Update an academic paper and upsert translations', description: 'Requires permission: `academic-papers:update`.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: AcademicPaperDetailResponseDto, description: 'Updated academic paper with all translations' })
  @ApiBadRequestResponse({ type: ValidationErrorDto, description: 'Validation failed, or the resulting translations did not contain exactly one is_default entry' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No academic paper with that ID exists, or the new category_id does not exist or has been soft-deleted' })
  update(@Param('id') id: string, @Body() dto: UpdateAcademicPaperDto, @CurrentUser() user: CurrentUserPayload, @Lang() lang: string | null) {
    return this.service.update(id, dto, user.id, lang);
  }

  @Delete(':id')
  @Auth('academic-papers:delete')
  @ApiOperation({ summary: 'Soft-delete an academic paper', description: 'Requires permission: `academic-papers:delete`.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: AcademicPaperMessageResponseDto, description: 'Academic paper soft-deleted; immediately hidden from all queries — data is preserved in the database' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No academic paper with that ID exists, or it has already been deleted' })
  remove(@Param('id') id: string, @CurrentUser() user: CurrentUserPayload) {
    return this.service.softDelete(id, user.id);
  }
}
