import { Controller, Get, Header, Res } from '@nestjs/common';
import { ApiHeader, ApiOkResponse, ApiOperation, ApiTags, ApiTooManyRequestsResponse } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { Lang } from '../common/decorators/language.decorator';
import { PublicCache } from '../common/decorators/public-cache.decorator';
import { TooManyRequestsErrorDto } from '../common/dto/api-response.dto';
import { HomepageResponseDto } from './dto/homepage.dto';
import { FeedsService } from './feeds.service';
import { HomepageService } from './homepage.service';

// Ceilings per client IP per minute. These are the API's three heaviest public
// reads (several queries each, or every published post) and, unlike the list
// endpoints, they had NO ceiling of their own: the "1000 / 15 min" default is
// per route and per IP, so it bounded nothing that mattered. They sit far above
// what a CDN, a crawler or the public site's server legitimately sends — all
// three responses are cacheable — and far below a flood.
const HOMEPAGE_PER_MINUTE = 120;
const XML_FEED_PER_MINUTE = 20;

@ApiTags('Feeds')
@Controller()
export class FeedsController {
  constructor(
    private readonly service: FeedsService,
    private readonly homepage: HomepageService,
  ) {}

  @Get('homepage')
  @PublicCache(900, 3600, { untilSiteMidnight: true })
  @Throttle({ default: { limit: HOMEPAGE_PER_MINUTE, ttl: 60_000 } })
  @ApiTooManyRequestsResponse({ type: TooManyRequestsErrorDto, description: `Rate limit exceeded — maximum ${HOMEPAGE_PER_MINUTE} requests per minute per IP` })
  @ApiHeader({ name: 'Accept-Language', required: false, description: 'ISO 639-1 code for translated fields (e.g. ar, en, fa).' })
  @ApiOperation({
    summary: 'Composite homepage payload (public)',
    description:
      'Single-round-trip aggregator returning exactly what the public site\'s homepage components render. Buckets: `hadith_of_day` (the hadith scheduled to today\'s date in the site time zone, else a random pick locked in for that day — the same answer as `GET /daily-hadiths/today`; null if none is available), `news` (up to 4 featured posts, falling back to most-recent published when fewer featured exist), `publications` (latest 10 books), `videos` (most recent 7 YouTube videos from the local mirror — synced every 6h), and `gallery.slider` (latest 10 gallery images) + `gallery.categories` (all). Fields are stripped server-side to only what the front-end actually consumes; payload is much smaller than the per-resource list endpoints. Response is CDN-cacheable (`public, max-age=900, s-maxage=3600`, both cut short so the response never outlives site midnight, when the hadith of the day changes) and varies by `Accept-Language` — the daily hadith and category names give a per-day per-language stable cache key.',
  })
  @ApiOkResponse({ type: HomepageResponseDto, description: 'Homepage payload' })
  getHomepage(@Lang() lang: string | null) {
    return this.homepage.getHomepage(lang);
  }

  @Get('sitemap.xml')
  @Header('Content-Type', 'application/xml; charset=utf-8')
  @Header('Cache-Control', 'public, max-age=900, s-maxage=900')
  @Throttle({ default: { limit: XML_FEED_PER_MINUTE, ttl: 60_000 } })
  @ApiTooManyRequestsResponse({ type: TooManyRequestsErrorDto, description: `Rate limit exceeded — maximum ${XML_FEED_PER_MINUTE} requests per minute per IP` })
  @ApiOperation({
    summary: 'XML sitemap of published posts, static pages, and books (public)',
    description:
      'Returns a urlset with one canonical URL per row — published posts, static pages, and books that have a slug (a book without one is omitted; none have been assigned in production yet). The public site is single-language with no `{lang}` route segment, so there are no per-language URLs and no `xhtml:link` hreflang alternates. Academic papers and audios have no public detail route and are never included. URL patterns: `${PUBLIC_SITE_URL:-https://imamzain.org}/news/{slug}` (posts), `/his-life/{slug}` (static pages), `/library/books/{slug}` (books). Cached for 15 minutes by upstream CDN headers.',
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
  @Throttle({ default: { limit: XML_FEED_PER_MINUTE, ttl: 60_000 } })
  @ApiTooManyRequestsResponse({ type: TooManyRequestsErrorDto, description: `Rate limit exceeded — maximum ${XML_FEED_PER_MINUTE} requests per minute per IP` })
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
