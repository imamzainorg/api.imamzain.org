import type { Context } from 'hono';
import { createApp } from '../../lib/create-app';
import { defineRoute } from '../../lib/define-route';
import { publicCache } from '../../lib/envelope';
import { publicCacheUntilSiteMidnight } from '../../lib/site-time';
import type { AppEnv } from '../../lib/types';
import { getHomepage } from './homepage';
import * as service from './service';

// Nest's ceilings per client IP per minute: three heavy public reads that had none of their own.
const HOMEPAGE_PER_MINUTE = 120;
const XML_FEED_PER_MINUTE = 20;

/** The XML endpoints send their own body (no JSON envelope) with fixed headers and no `Vary`. */
const xml = (c: Context<AppEnv>, body: string, contentType: string) =>
  c.body(body, 200, {
    'Content-Type': contentType,
    'Cache-Control': 'public, max-age=900, s-maxage=900',
  });

const homepageApp = createApp();
defineRoute(
  homepageApp,
  {
    method: 'get',
    path: '/',
    summary: 'Composite homepage payload (public)',
    limit: HOMEPAGE_PER_MINUTE,
  },
  async (c) => {
    const result = await getHomepage(c, c.get('lang'));
    publicCacheUntilSiteMidnight(c, 900, 3600);
    return result;
  },
);

const sitemapApp = createApp();
defineRoute(
  sitemapApp,
  {
    method: 'get',
    path: '/',
    summary: 'XML sitemap of published posts, static pages and books (public)',
    limit: XML_FEED_PER_MINUTE,
  },
  async (c) => xml(c, await service.buildSitemap(c), 'application/xml; charset=utf-8'),
);

const rssApp = createApp();
defineRoute(
  rssApp,
  {
    method: 'get',
    path: '/posts.xml',
    summary: 'RSS 2.0 feed of recent published posts (public)',
    limit: XML_FEED_PER_MINUTE,
  },
  async (c) => xml(c, await service.buildPostsRss(c, 50), 'application/rss+xml; charset=utf-8'),
);

export const homepage = homepageApp;
export const sitemap = sitemapApp;
export const rss = rssApp;
