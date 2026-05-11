/**
 * Server-side reading-time estimate for a post body.
 *
 * Body content is rich-text HTML (Tiptap). We strip tags to plain text,
 * count characters (Arabic words can't be reliably split on whitespace
 * the way English / European text can), and divide by an empirical
 * characters-per-minute constant tuned for mixed Arabic + English content.
 *
 * The exact constant doesn't matter much — readers don't notice a
 * minute either way — but having a consistent number labelled by the
 * API saves every consumer from reimplementing the same heuristic.
 */

const CHARS_PER_MINUTE = 1000; // ~ 200 wpm × 5 chars/word, a common reading-speed estimate

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[#a-z0-9]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function readingTimeMinutes(html: string | null | undefined): number {
  if (!html) return 0;
  const text = stripHtml(html);
  if (text.length === 0) return 0;
  return Math.max(1, Math.round(text.length / CHARS_PER_MINUTE));
}
