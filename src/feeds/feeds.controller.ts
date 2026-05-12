import { Controller, Get, Header, Query, Res } from '@nestjs/common';
import { ApiHeader, ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Lang } from '../common/decorators/language.decorator';
import { PublicCache } from '../common/decorators/public-cache.decorator';
import { HomepageQueryDto, HomepageResponseDto } from './dto/homepage.dto';
import { FeedsService } from './feeds.service';
import { HomepageService } from './homepage.service';

@ApiTags('Feeds')
@Controller()
export class FeedsController {
  constructor(
    private readonly service: FeedsService,
    private readonly homepage: HomepageService,
  ) {}

  @Get('homepage')
  @PublicCache(60)
  @ApiHeader({ name: 'Accept-Language', required: false, description: 'ISO 639-1 code for translated fields (e.g. ar, en).' })
  @ApiOperation({
    summary: 'Composite homepage payload (public, slim post cards)',
    description:
      'Single-round-trip aggregator for the public homepage. Returns three buckets of post cards in one response — `featured` (is_featured=true, newest first), `popular` (highest view count), and `recent` (newest published). Replaces three separate /posts calls. Cards are slim — no body, no attachments — because homepage tiles never render the body. Response is CDN-cacheable (`public, max-age=60, s-maxage=300`) and varies by `Accept-Language`.',
  })
  @ApiQuery({ name: 'featured_limit', required: false, type: Number, example: 5, description: '0–20, default 5. Pass 0 to skip the bucket entirely.' })
  @ApiQuery({ name: 'popular_limit', required: false, type: Number, example: 5, description: '0–20, default 5.' })
  @ApiQuery({ name: 'recent_limit', required: false, type: Number, example: 10, description: '0–20, default 10.' })
  @ApiOkResponse({ type: HomepageResponseDto, description: 'Three buckets of slim post cards' })
  getHomepage(@Query() query: HomepageQueryDto, @Lang() lang: string | null) {
    return this.homepage.getHomepage(query, lang);
  }

  @Get('sitemap.xml')
  @Header('Content-Type', 'application/xml; charset=utf-8')
  @Header('Cache-Control', 'public, max-age=900, s-maxage=900')
  @ApiOperation({
    summary: 'XML sitemap of published posts (public)',
    description:
      'Returns a urlset of every published post in every language, with `xhtml:link` hreflang alternates. URL pattern: `${PUBLIC_SITE_URL:-https://imamzain.org}/{lang}/posts/{slug}`. Cached for 15 minutes by upstream CDN headers.',
  })
  @ApiOkResponse({
    description: 'XML sitemap (application/xml)',
    content: { 'application/xml': { schema: { type: 'string' } } },
  })
  async sitemap(@Res() res: Response) {
    const xml = await this.service.buildSitemap();
    res.send(xml);
  }

  @Get('rss/posts.xml')
  @Header('Content-Type', 'application/rss+xml; charset=utf-8')
  @Header('Cache-Control', 'public, max-age=900, s-maxage=900')
  @ApiOperation({
    summary: 'RSS 2.0 feed of recent published posts (public)',
    description:
      'Returns the most recent 50 published posts as an RSS 2.0 feed, resolved to each post\'s default translation. Cached for 15 minutes by upstream CDN headers.',
  })
  @ApiOkResponse({
    description: 'RSS 2.0 feed (application/rss+xml)',
    content: { 'application/rss+xml': { schema: { type: 'string' } } },
  })
  async postsRss(@Res() res: Response) {
    const xml = await this.service.buildPostsRss(50);
    res.send(xml);
  }
}
