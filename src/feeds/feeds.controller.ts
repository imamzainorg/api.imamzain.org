import { Controller, Get, Header, Res } from '@nestjs/common';
import { ApiHeader, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Lang } from '../common/decorators/language.decorator';
import { PublicCache } from '../common/decorators/public-cache.decorator';
import { HomepageResponseDto } from './dto/homepage.dto';
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
  @PublicCache(900, 3600)
  @ApiHeader({ name: 'Accept-Language', required: false, description: 'ISO 639-1 code for translated fields (e.g. ar, en, fa).' })
  @ApiOperation({
    summary: 'Composite homepage payload (public)',
    description:
      'Single-round-trip aggregator returning exactly what the public site\'s homepage components render. Buckets: `hadith_of_day` (rotated per UTC date, picked from `daily_hadiths`; null if empty), `news` (up to 4 featured posts, falling back to most-recent published when fewer featured exist), `publications` (latest 10 books), `videos` (most recent 7 YouTube videos from the local mirror — synced every 6h), and `gallery.slider` (latest 10 gallery images) + `gallery.categories` (all). Fields are stripped server-side to only what the front-end actually consumes; payload is much smaller than the per-resource list endpoints. Response is CDN-cacheable (`public, max-age=900, s-maxage=3600`) and varies by `Accept-Language` — the daily hadith and category names give a per-day per-language stable cache key.',
  })
  @ApiOkResponse({ type: HomepageResponseDto, description: 'Homepage payload' })
  getHomepage(@Lang() lang: string | null) {
    return this.homepage.getHomepage(lang);
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
