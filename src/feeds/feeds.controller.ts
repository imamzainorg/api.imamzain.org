import { Controller, Get, Header, Res } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { FeedsService } from './feeds.service';

@ApiTags('Feeds')
@Controller()
export class FeedsController {
  constructor(private readonly service: FeedsService) {}

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
