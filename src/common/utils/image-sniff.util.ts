/**
 * Magic-number detection for the four raster formats uploads may carry.
 *
 * Content-Type on an uploaded object is metadata the uploader chose; the bytes
 * are the truth. Sniffing the first few bytes (one small ranged GET) is what
 * stops an HTML/SVG payload labelled `image/png` from becoming a media row
 * served from the CDN origin.
 */

export type SniffedImageMime = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

/** Bytes needed to recognise every supported signature (WebP's is the longest at 12). */
export const IMAGE_SNIFF_BYTES = 16;

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.subarray(start, end));
}

/**
 * Returns the image type the bytes actually are, or null for anything else —
 * including SVG, HTML, PDF and every other "image" a browser would execute.
 */
export function sniffImageMime(bytes: Uint8Array): SniffedImageMime | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (bytes.length >= PNG_SIGNATURE.length && PNG_SIGNATURE.every((b, i) => bytes[i] === b)) {
    return 'image/png';
  }
  if (bytes.length >= 6) {
    const header = ascii(bytes, 0, 6);
    if (header === 'GIF87a' || header === 'GIF89a') return 'image/gif';
  }
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP') {
    return 'image/webp';
  }
  return null;
}
