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
 * allowed (background:url(javascript:...) is a real vector); `class` is
 * allowed because Tiptap emits it for syntax highlighting. `id` is allowed
 * only in a namespaced form (see USER_CONTENT_ID_PREFIX): a raw id lets
 * authored HTML shadow host-page elements and `window.*` globals (DOM
 * clobbering).
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
 * Allowlist of `data:` MIME types permitted inside <img src>. Restricting
 * to image MIMEs at the sanitizer layer blocks `data:text/html;base64,...`
 * payloads that would otherwise be live HTML embedded in the article body.
 */
const ALLOWED_DATA_IMG_MIMES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/svg+xml',
]);

const DATA_URL_MIME_RE = /^data:([^;,]+)[;,]/i;

/**
 * Every kept `id` gets this prefix so authored ids can never collide with (or
 * clobber) an element or global of the page that renders the body. The
 * sanitiser runs again each time the CMS re-saves a body it fetched from us,
 * so an id that already carries the prefix is left alone — otherwise it would
 * grow one prefix per save.
 */
const USER_CONTENT_ID_PREFIX = 'user-content-';
const SAFE_ID_RE = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;

/** The namespaced form of an authored id, or null when the id is not acceptable. */
function namespacedId(raw: string): string | null {
  const bare = raw.startsWith(USER_CONTENT_ID_PREFIX) ? raw.slice(USER_CONTENT_ID_PREFIX.length) : raw;
  return SAFE_ID_RE.test(bare) ? USER_CONTENT_ID_PREFIX + bare : null;
}

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
      // data: is permitted on <img> only; the per-attribute filter below
      // pins the MIME so `data:text/html;base64,...` is rejected.
      img: ['http', 'https', 'data'],
    },
    allowedSchemesAppliedToAttributes: ['href', 'src'],
    allowProtocolRelative: true,
    exclusiveFilter: (frame) => {
      // Drop <img> elements whose data: URL MIME is not in the image
      // allowlist. sanitize-html's scheme allowlist alone accepts any MIME
      // after the `data:` prefix, so we filter here as a second gate.
      if (frame.tag === 'img') {
        const src = frame.attribs?.src;
        if (typeof src === 'string' && src.toLowerCase().startsWith('data:')) {
          const match = DATA_URL_MIME_RE.exec(src);
          const mime = match?.[1]?.trim().toLowerCase();
          if (!mime || !ALLOWED_DATA_IMG_MIMES.has(mime)) {
            return true; // drop
          }
        }
      }
      return false;
    },
    transformTags: {
      a: (tagName, attribs) => {
        const next = { ...attribs };
        if (next.target !== undefined) {
          // Browsers match the `_blank` keyword case-insensitively, and ANY
          // other target names a fresh browsing context too — so every
          // non-_blank target is dropped, and the surviving one is rewritten
          // to the exact keyword with rel pinned. An authored rel is
          // overwritten on purpose (rel="opener" would defeat it).
          if (next.target.trim().toLowerCase() === '_blank') {
            next.target = '_blank';
            next.rel = 'noopener noreferrer';
          } else {
            delete next.target;
          }
        }
        // Same-page anchors follow the id rewrite below; without this an
        // editor-authored in-page link would stop reaching its heading.
        const href = next.href?.trim();
        if (href?.startsWith('#') && href.length > 1) {
          const id = namespacedId(href.slice(1));
          if (id) next.href = `#${id}`;
        }
        return { tagName, attribs: next };
      },
      '*': (tagName, attribs) => {
        if (attribs.id === undefined) return { tagName, attribs };
        const next = { ...attribs };
        const id = namespacedId(next.id);
        if (id) next.id = id;
        else delete next.id;
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
