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

function postUrl(lang: string, slug: string): string {
  return `${publicSiteBase()}/${lang}/posts/${slug}`;
}

// Static pages are canonical, root-level URLs on the public site:
// `{PUBLIC_SITE_URL}/{lang}/{slug}` (e.g. /ar/imam-zain-biography). If the
// front-end serves them under a different path prefix, update this to match —
// same contract as postUrl above.
function staticPageUrl(lang: string, slug: string): string {
  return `${publicSiteBase()}/${lang}/${slug}`;
}

function bookUrl(lang: string, slug: string): string {
  return `${publicSiteBase()}/${lang}/books/${slug}`;
}

function paperUrl(lang: string, slug: string): string {
  return `${publicSiteBase()}/${lang}/academic-papers/${slug}`;
}

// Audios use a single, language-agnostic canonical slug → no /{lang}/ segment.
function audioUrl(slug: string): string {
  return `${publicSiteBase()}/audios/${slug}`;
}

/**
 * Sitemap + RSS feed generation for the public main site.
 *
 * Both endpoints read directly from the live posts table — no caching layer.
 * At current corpus size (low thousands of posts × two languages) this is
 * well under the 50k-URL-per-sitemap and 500-item-per-feed practical caps,
 * and the read is a couple of indexed scans. Revisit if the corpus grows.
 *
 * URL shape: `{PUBLIC_SITE_URL}/{lang}/posts/{slug}`. Set
 * `PUBLIC_SITE_URL` to override the default `https://imamzain.org`.
 */
@Injectable()
export class FeedsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Build a urlset sitemap with one <url> entry per published post and an
   * `xhtml:link` alternate per other translation so search engines learn
   * the language alternates.
   */
  async buildSitemap(): Promise<string> {
    const posts = await this.prisma.posts.findMany({
      where: { deleted_at: null, is_published: true },
      include: { post_translations: { select: { lang: true, slug: true, is_default: true } } },
      orderBy: { published_at: 'desc' },
    });

    const lines: string[] = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
    ];

    for (const post of posts) {
      const lastmod = (post.updated_at ?? post.published_at ?? post.created_at).toISOString();
      const alternates = post.post_translations.map((t) => ({
        lang: t.lang,
        url: postUrl(t.lang, t.slug),
      }));

      for (const t of post.post_translations) {
        const url = postUrl(t.lang, t.slug);
        lines.push('  <url>');
        lines.push(`    <loc>${xmlEscape(url)}</loc>`);
        lines.push(`    <lastmod>${xmlEscape(lastmod)}</lastmod>`);
        for (const alt of alternates) {
          lines.push(
            `    <xhtml:link rel="alternate" hreflang="${xmlEscape(alt.lang)}" href="${xmlEscape(alt.url)}"/>`,
          );
        }
        lines.push('  </url>');
      }
    }

    // Static pages (biography, about, …) are public, indexable URLs too — emit
    // one <url> per translation with hreflang alternates, same shape as posts.
    const pages = await this.prisma.static_pages.findMany({
      where: { deleted_at: null, is_published: true },
      include: { static_page_translations: { select: { lang: true, slug: true } } },
      orderBy: [{ display_order: 'asc' }, { id: 'asc' }],
    });

    for (const page of pages) {
      const lastmod = (page.updated_at ?? page.created_at).toISOString();
      const alternates = page.static_page_translations.map((t) => ({
        lang: t.lang,
        url: staticPageUrl(t.lang, t.slug),
      }));

      for (const t of page.static_page_translations) {
        const url = staticPageUrl(t.lang, t.slug);
        lines.push('  <url>');
        lines.push(`    <loc>${xmlEscape(url)}</loc>`);
        lines.push(`    <lastmod>${xmlEscape(lastmod)}</lastmod>`);
        for (const alt of alternates) {
          lines.push(
            `    <xhtml:link rel="alternate" hreflang="${xmlEscape(alt.lang)}" href="${xmlEscape(alt.url)}"/>`,
          );
        }
        lines.push('  </url>');
      }
    }

    // Books & academic papers that have an editor slug on at least one
    // translation get indexable URLs too. Rows with no slug stay UUID-only and
    // are intentionally omitted (no human/SEO-friendly URL to advertise).
    const books = await this.prisma.books.findMany({
      where: { deleted_at: null, book_translations: { some: { slug: { not: null } } } },
      select: { updated_at: true, created_at: true, book_translations: { select: { lang: true, slug: true } } },
    });
    for (const book of books) {
      const slugged = book.book_translations.filter((t): t is { lang: string; slug: string } => !!t.slug);
      if (slugged.length === 0) continue;
      const lastmod = (book.updated_at ?? book.created_at).toISOString();
      const alternates = slugged.map((t) => ({ lang: t.lang, url: bookUrl(t.lang, t.slug) }));
      for (const t of slugged) this.pushUrlEntry(lines, bookUrl(t.lang, t.slug), lastmod, alternates);
    }

    const papers = await this.prisma.academic_papers.findMany({
      where: { deleted_at: null, academic_paper_translations: { some: { slug: { not: null } } } },
      select: { updated_at: true, created_at: true, academic_paper_translations: { select: { lang: true, slug: true } } },
    });
    for (const paper of papers) {
      const slugged = paper.academic_paper_translations.filter((t): t is { lang: string; slug: string } => !!t.slug);
      if (slugged.length === 0) continue;
      const lastmod = (paper.updated_at ?? paper.created_at).toISOString();
      const alternates = slugged.map((t) => ({ lang: t.lang, url: paperUrl(t.lang, t.slug) }));
      for (const t of slugged) this.pushUrlEntry(lines, paperUrl(t.lang, t.slug), lastmod, alternates);
    }

    // Audios: published + slugged only. Single canonical slug, so emit one bare
    // <url> per audio (no /{lang}/ segment, no hreflang alternates).
    const audios = await this.prisma.audios.findMany({
      where: { deleted_at: null, is_published: true, slug: { not: null } },
      select: { slug: true, updated_at: true, created_at: true },
    });
    for (const audio of audios) {
      if (!audio.slug) continue;
      const lastmod = (audio.updated_at ?? audio.created_at).toISOString();
      lines.push('  <url>');
      lines.push(`    <loc>${xmlEscape(audioUrl(audio.slug))}</loc>`);
      lines.push(`    <lastmod>${xmlEscape(lastmod)}</lastmod>`);
      lines.push('  </url>');
    }

    lines.push('</urlset>');
    return lines.join('\n');
  }

  /** Emit one <url> block with hreflang alternates. */
  private pushUrlEntry(
    lines: string[],
    loc: string,
    lastmod: string,
    alternates: { lang: string; url: string }[],
  ): void {
    lines.push('  <url>');
    lines.push(`    <loc>${xmlEscape(loc)}</loc>`);
    lines.push(`    <lastmod>${xmlEscape(lastmod)}</lastmod>`);
    for (const alt of alternates) {
      lines.push(
        `    <xhtml:link rel="alternate" hreflang="${xmlEscape(alt.lang)}" href="${xmlEscape(alt.url)}"/>`,
      );
    }
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
        post_translations: true,
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

      const url = postUrl(translation.lang, translation.slug);
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
