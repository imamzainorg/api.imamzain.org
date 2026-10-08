import type { Context } from 'hono';
import { getDb } from '../../lib/db';
import { loadActiveLanguages, resolveTranslation } from '../../lib/i18n';
import type { AppEnv } from '../../lib/types';
import {
  bookUrl,
  htmlToPlainExcerpt,
  postUrl,
  publicSiteBase,
  staticPageUrl,
  xmlEscape,
} from './xml';

type Ctx = Context<AppEnv>;

const PUBLIC = { deleted_at: null, is_published: true } as const;

function pushUrlEntry(lines: string[], loc: string, lastmod: string): void {
  lines.push(
    '  <url>',
    `    <loc>${xmlEscape(loc)}</loc>`,
    `    <lastmod>${xmlEscape(lastmod)}</lastmod>`,
    '  </url>',
  );
}

/** One <url> per published post, static page and slugged book, in that section order. */
export async function buildSitemap(c: Ctx): Promise<string> {
  const db = getDb(c);
  const [posts, pages, books] = await Promise.all([
    db.posts.findMany({
      where: PUBLIC,
      select: { slug: true, updated_at: true, published_at: true, created_at: true },
      orderBy: { published_at: 'desc' },
    }),
    db.static_pages.findMany({
      where: PUBLIC,
      select: { slug: true, updated_at: true, created_at: true },
      orderBy: [{ display_order: 'asc' }, { id: 'asc' }],
    }),
    // A book without a slug stays UUID-only and is omitted; parts are not separate pages.
    db.books.findMany({
      where: { ...PUBLIC, slug: { not: null }, parent_id: null },
      select: { slug: true, updated_at: true, created_at: true },
    }),
  ]);

  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  ];
  for (const post of posts) {
    if (!post.slug) continue;
    pushUrlEntry(
      lines,
      postUrl(c, post.slug),
      (post.updated_at ?? post.published_at ?? post.created_at).toISOString(),
    );
  }
  for (const page of pages) {
    if (!page.slug) continue;
    pushUrlEntry(
      lines,
      staticPageUrl(c, page.slug),
      (page.updated_at ?? page.created_at).toISOString(),
    );
  }
  for (const book of books) {
    if (!book.slug) continue;
    pushUrlEntry(lines, bookUrl(c, book.slug), (book.updated_at ?? book.created_at).toISOString());
  }
  lines.push('</urlset>');
  return lines.join('\n');
}

/** RSS 2.0 of the latest published posts, one item per post in its default translation. */
export async function buildPostsRss(c: Ctx, limit = 50): Promise<string> {
  const db = getDb(c);
  const [posts, active] = await Promise.all([
    db.posts.findMany({
      where: PUBLIC,
      // Only the default translation is emitted, so the other languages' bodies aren't fetched.
      include: { post_translations: { where: { is_default: true } } },
      orderBy: [{ published_at: 'desc' }, { created_at: 'desc' }, { id: 'asc' }],
      take: limit,
    }),
    loadActiveLanguages(db),
  ]);

  const channelTitle = c.env.PUBLIC_SITE_NAME ?? 'Imam Zain Foundation';
  const channelLink = publicSiteBase(c);
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    '  <channel>',
    `    <title>${xmlEscape(channelTitle)}</title>`,
    `    <link>${xmlEscape(channelLink)}</link>`,
    `    <description>${xmlEscape('Latest posts from imamzain.org')}</description>`,
    `    <lastBuildDate>${xmlEscape(new Date().toUTCString())}</lastBuildDate>`,
    `    <atom:link href="${xmlEscape(`${channelLink}/rss/posts.xml`)}" rel="self" type="application/rss+xml"/>`,
  ];

  for (const post of posts) {
    const translation = resolveTranslation(post.post_translations, null, { active });
    if (!translation || !post.slug) continue;

    const url = postUrl(c, post.slug);
    const description = translation.summary ?? htmlToPlainExcerpt(translation.body ?? '');
    lines.push(
      '    <item>',
      `      <title>${xmlEscape(translation.title)}</title>`,
      `      <link>${xmlEscape(url)}</link>`,
      // The canonical URL is a stable GUID: the slug is fixed once published.
      `      <guid>${xmlEscape(url)}</guid>`,
      `      <pubDate>${xmlEscape((post.published_at ?? post.created_at).toUTCString())}</pubDate>`,
      `      <description>${xmlEscape(description)}</description>`,
      '    </item>',
    );
  }

  lines.push('  </channel>', '</rss>');
  return lines.join('\n');
}
