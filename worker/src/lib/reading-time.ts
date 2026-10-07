// src/common/utils/reading-time.util.ts: characters, not words, because Arabic can't be split on whitespace.
const CHARS_PER_MINUTE = 1000;

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
