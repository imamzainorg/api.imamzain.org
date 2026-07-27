import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { resolveTranslation } from '../common/utils/translation.util';

/** Strip rich-text HTML to a plain summary for feed `<description>` tags. */
function htmlToPlainExcerpt(html: string, maxChars = 280): string {
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars - 1).trimEnd() + '…';
}

/** XML attribute / text escape — &, <, >, ", '. */
function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function publicSiteBase(): string {
  return (process.env.PUBLIC_SITE_URL ?? 'https://imamzain.org').replace(/\/$/, '');
}

// ── Public site route table ──────────────────────────────────────────────────
// These MUST mirror the front-end's actual routes. imamzain.org is served as a
// single Arabic site: `<html lang="ar" dir="rtl">` is hardcoded in
// src/app/layout.tsx and there is no [lang] route segment, so none of these
// carry a language prefix. Emitting one previously made every URL in
// sitemap.xml a 404.
//
// Because there is no per-language URL, a row with several translations has one
// canonical URL, not one per language. We emit the default translation's slug
// and no hreflang alternates.
//
// Two resources are deliberately absent:
//   - academic papers: the site has no detail route (the scientific platform is
//     one page at /research/scientific-platform that opens papers in a modal).
//   - audios: same, /media/audio is a single page with ?id= deep links.
// Add builders back here when those routes exist.

function postUrl(slug: string): string {
  return `${publicSiteBase()}/news/${slug}`;
}

function staticPageUrl(slug: string): string {
  return `${publicSiteBase()}/his-life/${slug}`;
}

// The site exposes books at both /library/books/{slug} and /publications/{slug}
// with no rel=canonical on either. /library/books is the dedicated detail view,
// so it is the one we advertise; the duplication itself still needs resolving
// on the front-end.
function bookUrl(slug: string): string {
  return `${publicSiteBase()}/library/books/${slug}`;
}

/**
 * Sitemap + RSS feed generation for the public main site.
 *
 * Both endpoints read directly from the live posts table — no caching layer.
 * At current corpus size (low thousands of posts) this is well under the
 * 50k-URL-per-sitemap and 500-item-per-feed practical caps, and the read is a
 * couple of indexed scans. Revisit if the corpus grows.
 *
 * URL shapes are defined by the route table above. Set `PUBLIC_SITE_URL` to
 * override the default origin `https://imamzain.org`.
 */
@Injectable()
export class FeedsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Build a urlset sitemap with one <url> entry per published post, static page
   * and slugged book.
   *
   * No hreflang alternates: the public site has no per-language URL, so a row's
   * translations all share one canonical URL. Emitting one <url> per translation
   * would advertise the same page several times over.
   */
  async buildSitemap(): Promise<string> {
    // Independent reads, so fetch in parallel, then format in a fixed section
    // order (posts, pages, books).
    const [posts, pages, books] = await Promise.all([
      this.prisma.posts.findMany({
        where: { deleted_at: null, is_published: true },
        include: { post_translations: { select: { lang: true, slug: true, is_default: true } } },
        orderBy: { published_at: 'desc' },
      }),
      this.prisma.static_pages.findMany({
        where: { deleted_at: null, is_published: true },
        include: { static_page_translations: { select: { lang: true, slug: true, is_default: true } } },
        orderBy: [{ display_order: 'asc' }, { id: 'asc' }],
      }),
      this.prisma.books.findMany({
        where: { deleted_at: null, book_translations: { some: { slug: { not: null } } } },
        select: {
          updated_at: true,
          created_at: true,
          book_translations: { select: { lang: true, slug: true, is_default: true } },
        },
      }),
    ]);

    const lines: string[] = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ];

    for (const post of posts) {
      const t = resolveTranslation(post.post_translations, null);
      if (!t) continue;
      const lastmod = (post.updated_at ?? post.published_at ?? post.created_at).toISOString();
      this.pushUrlEntry(lines, postUrl(t.slug), lastmod);
    }

    // Static pages (biography, …) are public, indexable URLs too.
    for (const page of pages) {
      const t = resolveTranslation(page.static_page_translations, null);
      if (!t) continue;
      const lastmod = (page.updated_at ?? page.created_at).toISOString();
      this.pushUrlEntry(lines, staticPageUrl(t.slug), lastmod);
    }

    // Books with an editor slug get an indexable URL. Rows with no slug stay
    // UUID-only and are intentionally omitted (nothing SEO-friendly to
    // advertise). Prefer the default translation, but fall back to any slugged
    // one so a book whose default translation lacks a slug is still listed.
    for (const book of books) {
      const slugged = book.book_translations.filter(
        (t): t is (typeof book.book_translations)[number] & { slug: string } => !!t.slug,
      );
      if (slugged.length === 0) continue;
      const t = resolveTranslation(slugged, null) ?? slugged[0];
      const lastmod = (book.updated_at ?? book.created_at).toISOString();
      this.pushUrlEntry(lines, bookUrl(t.slug), lastmod);
    }

    lines.push('</urlset>');
    return lines.join('\n');
  }

  /** Emit one <url> block. */
  private pushUrlEntry(lines: string[], loc: string, lastmod: string): void {
    lines.push('  <url>');
    lines.push(`    <loc>${xmlEscape(loc)}</loc>`);
    lines.push(`    <lastmod>${xmlEscape(lastmod)}</lastmod>`);
    lines.push('  </url>');
  }

  /**
   * Build an RSS 2.0 feed of the most recent published posts. One entry per
   * post (resolved to the post's default translation) — RSS readers don't
   * have a great story for per-item language alternates, so we keep the
   * feed shape simple and emit one item per post in its default language.
   * For a per-language feed (Arabic-only, English-only) we'd add a query
   * parameter; not needed today.
   */
  async buildPostsRss(limit = 50): Promise<string> {
    const posts = await this.prisma.posts.findMany({
      where: { deleted_at: null, is_published: true },
      include: {
        // The feed only ever emits the default translation (resolveTranslation
        // with lang=null below) — don't ship the other languages' bodies.
        post_translations: { where: { is_default: true } },
      },
      orderBy: [{ published_at: 'desc' }, { created_at: 'desc' }],
      take: limit,
    });

    const channelTitle = process.env.PUBLIC_SITE_NAME ?? 'Imam Zain Foundation';
    const channelLink = publicSiteBase();
    const channelDesc = 'Latest posts from imamzain.org';
    const lastBuildDate = new Date().toUTCString();

    const lines: string[] = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
      '  <channel>',
      `    <title>${xmlEscape(channelTitle)}</title>`,
      `    <link>${xmlEscape(channelLink)}</link>`,
      `    <description>${xmlEscape(channelDesc)}</description>`,
      `    <lastBuildDate>${xmlEscape(lastBuildDate)}</lastBuildDate>`,
      `    <atom:link href="${xmlEscape(`${channelLink}/rss/posts.xml`)}" rel="self" type="application/rss+xml"/>`,
    ];

    for (const post of posts) {
      const translation = resolveTranslation(post.post_translations, null);
      if (!translation) continue;

      const url = postUrl(translation.slug);
      const title = translation.title;
      const description = translation.summary ?? htmlToPlainExcerpt(translation.body ?? '');
      const pubDate = (post.published_at ?? post.created_at).toUTCString();

      lines.push('    <item>');
      lines.push(`      <title>${xmlEscape(title)}</title>`);
      lines.push(`      <link>${xmlEscape(url)}</link>`);
      // Use the canonical URL as the GUID — stable across edits because the
      // slug pattern is fixed once published. isPermaLink=true is the default.
      lines.push(`      <guid>${xmlEscape(url)}</guid>`);
      lines.push(`      <pubDate>${xmlEscape(pubDate)}</pubDate>`);
      lines.push(`      <description>${xmlEscape(description)}</description>`);
      lines.push('    </item>');
    }

    lines.push('  </channel>');
    lines.push('</rss>');
    return lines.join('\n');
  }
}
