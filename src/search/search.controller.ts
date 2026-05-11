import { Controller, Get, Query } from '@nestjs/common';
import { ApiBadRequestResponse, ApiHeader, ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Lang } from '../common/decorators/language.decorator';
import { ValidationErrorDto } from '../common/dto/api-response.dto';
import { SearchQueryDto, SearchResourceType } from './dto/search.dto';
import { SearchResponseDto } from './dto/search-response.dto';
import { SearchService } from './search.service';

@ApiTags('Search')
@ApiHeader({
  name: 'Accept-Language',
  required: false,
  description:
    'ISO 639-1 code. When provided, prefer same-language translations among the hits. The matched translation is always the one that actually contained the query string.',
})
@Controller('search')
export class SearchController {
  constructor(private readonly service: SearchService) {}

  @Get()
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  @ApiOperation({
    summary: 'Cross-resource search (public)',
    description:
      'Searches published posts, books, academic papers and gallery image captions. Results are grouped by resource type. Public — only returns content that is visible to anonymous users (published posts; non-deleted everything else). Rate-limited to 60 calls/minute/IP.',
  })
  @ApiQuery({ name: 'q', required: true, type: String, example: 'الإمام', description: 'Query string (2–200 chars)' })
  @ApiQuery({
    name: 'types',
    required: false,
    enum: SearchResourceType,
    isArray: true,
    example: 'post,book',
    description: 'Comma-separated subset; defaults to all types',
  })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 10, description: 'Per-type max hits (1–50, default 10)' })
  @ApiOkResponse({ type: SearchResponseDto, description: 'Search results bucketed by resource type' })
  @ApiBadRequestResponse({ type: ValidationErrorDto, description: 'Missing or invalid query parameters' })
  search(@Query() query: SearchQueryDto, @Lang() lang: string | null) {
    return this.service.search(query, lang);
  }
}
