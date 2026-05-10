import sanitizeHtml from 'sanitize-html';

/**
 * Server-side HTML sanitisation for content fields produced by the Tiptap
 * rich-text editor in the CMS.
 *
 * The CMS does its own client-side cleanup (Tiptap's schema drops unknown
 * elements at parse time, plus `sanitizeEditorHtml` strips javascript:/
 * vbscript: URLs and inline event handlers before submit). This server-side
 * pass is defence-in-depth: it backstops the public API for callers that
 * bypass the CMS — e.g. a compromised admin session POSTing raw HTML
 * directly — and protects against any rendering surface that uses
 * dangerouslySetInnerHTML downstream.
 *
 * The allowlist mirrors the Tiptap StarterKit schema (paragraph, heading,
 * lists, code, blockquote, link, image, table, basic marks). Everything
 * else is dropped silently. URL schemes are restricted; `style` is not
 * allowed (background:url(javascript:...) is a real vector); `class` and
 * `id` are allowed because Tiptap emits them for syntax highlighting and
 * heading anchors.
 */
const TIPTAP_ALLOWED_TAGS = [
  'p',
  'br',
  'hr',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'ul',
  'ol',
  'li',
  'blockquote',
  'pre',
  'code',
  'strong',
  'b',
  'em',
  'i',
  'u',
  's',
  'sub',
  'sup',
  'mark',
  'a',
  'img',
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'th',
  'td',
  'span',
  'div',
];

/**
 * Sanitise HTML produced by the rich-text editor.
 * Returns the cleaned HTML; never throws on malformed input.
 */
export function sanitizeEditorHtml(html: string | null | undefined): string {
  if (!html) return '';
  return sanitizeHtml(html, {
    allowedTags: TIPTAP_ALLOWED_TAGS,
    allowedAttributes: {
      a: ['href', 'target', 'rel', 'title'],
      img: ['src', 'alt', 'title', 'width', 'height', 'loading'],
      th: ['colspan', 'rowspan', 'scope'],
      td: ['colspan', 'rowspan'],
      // Apply to all allowed tags. `style` is intentionally absent.
      '*': ['class', 'id'],
    },
    allowedSchemes: ['http', 'https', 'mailto', 'tel'],
    allowedSchemesByTag: {
      // data: is permitted on <img> only, restricted to image MIMEs by the
      // class-validator pattern on the editor side; the public site can
      // still display embedded thumbnails this way.
      img: ['http', 'https', 'data'],
    },
    allowedSchemesAppliedToAttributes: ['href', 'src'],
    allowProtocolRelative: true,
    transformTags: {
      // Pair target=_blank with rel=noopener noreferrer to block reverse
      // tab-nabbing on whatever surface renders the body.
      a: (tagName, attribs) => {
        const next = { ...attribs };
        if (next.target === '_blank') {
          next.rel = 'noopener noreferrer';
        }
        return { tagName, attribs: next };
      },
    },
  });
}

/**
 * UTF-8 byte length of a string. JSON request bodies are UTF-8 on the wire,
 * so this is the size limit clients should respect. Mirrors the CMS's
 * `byteLength` helper.
 */
export function utf8ByteLength(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

/** Maximum body byte size accepted by the API (200 KB). Mirrors the CMS limit. */
export const MAX_BODY_BYTES = 200 * 1024;
