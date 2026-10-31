export const PDF_ACCESS = ['public', 'app'] as const;
export type PdfAccess = (typeof PDF_ACCESS)[number];

/** `pdf_access` is null in a public response when the book has no PDF at all. */
type Gated<T> = Omit<T, 'pdf_access'> & { pdf_access: string | null };

/**
 * A book-shaped row with its PDF fields as the caller may see them. The one place that decides: every
 * public response that carries `pdf_url` (list, detail, a series' parts) goes through it, so a new
 * endpoint cannot forget the rule.
 *
 * - no PDF: both fields null, so the website draws no button;
 * - 'public': the link, for everyone;
 * - anything else (today only 'app'): `pdf_access` is reported, the link only to the app. An unknown
 *   value withholds the link too.
 */
export function gatePdf<T extends { pdf_url: string | null; pdf_access: string }>(
  row: T,
  isApp: boolean,
): Gated<T> {
  if (!row.pdf_url) return { ...row, pdf_url: null, pdf_access: null };
  if (row.pdf_access !== 'public' && !isApp) return { ...row, pdf_url: null };
  return row;
}
