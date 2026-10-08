import type { Context } from 'hono';
import type { AppEnv } from '../../lib/types';

/** Strip rich-text HTML to a plain summary for a feed `<description>`. */
export function htmlToPlainExcerpt(html: string, maxChars = 280): string {
  const text = html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars - 1).trimEnd() + '…';
}

/** XML attribute / text escape: & < > " '. */
export function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function publicSiteBase(c: Context<AppEnv>): string {
  return (c.env.PUBLIC_SITE_URL ?? 'https://imamzain.org').replace(/\/$/, '');
}

// These mirror the public site's real routes. The site is single-language (`<html lang="ar">`, no
// [lang] segment), so a row with several translations has one canonical URL and no hreflang alternates.
// Academic papers and audios have no detail route and stay out of the sitemap.
export const postUrl = (c: Context<AppEnv>, slug: string) => `${publicSiteBase(c)}/news/${slug}`;
export const staticPageUrl = (c: Context<AppEnv>, slug: string) =>
  `${publicSiteBase(c)}/his-life/${slug}`;
// The site serves books at /library/books/{slug} and /publications/{slug} with no rel=canonical;
// the dedicated detail view is the one advertised.
export const bookUrl = (c: Context<AppEnv>, slug: string) =>
  `${publicSiteBase(c)}/library/books/${slug}`;
