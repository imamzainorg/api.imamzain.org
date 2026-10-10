// What Nest read with sharp's `metadata()`, parsed from the bytes: the four raster formats uploads may
// carry, their displayed (EXIF-oriented) size, animation, CMYK, and whether EXIF / XMP / IPTC is
// present. Works on a prefix of the file (the header) as well as on the whole file.

export type RasterFormat = 'jpeg' | 'png' | 'gif' | 'webp';

export interface ImageHeader {
  format: RasterFormat;
  /** Size as displayed: the stored raster with EXIF orientations 5–8 (quarter turns) swapped. */
  width: number;
  height: number;
  /** More than one frame (GIF, WebP). Needs the whole file for a GIF. */
  animated: boolean;
  /** EXIF, XMP or IPTC is present. */
  hasMetadata: boolean;
  /** A four-component (CMYK) JPEG, which a re-encode would shift in colour. */
  cmyk: boolean;
}

const ascii = (b: Uint8Array, start: number, end: number) => String.fromCharCode(...b.subarray(start, Math.min(end, b.length)));
const u16be = (b: Uint8Array, i: number) => (b[i] << 8) | b[i + 1];
const u16le = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8);
const u24le = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
const u32be = (b: Uint8Array, i: number) => ((b[i] << 24) >>> 0) + ((b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]);
const u32le = (b: Uint8Array, i: number) => ((b[i + 3] << 24) >>> 0) + ((b[i + 2] << 16) | (b[i + 1] << 8) | b[i]);

/** The Orientation tag (0x0112) of a TIFF-structured EXIF block, or undefined. */
export function exifOrientation(tiff: Uint8Array): number | undefined {
  if (tiff.length < 8) return undefined;
  const order = ascii(tiff, 0, 2);
  if (order !== 'II' && order !== 'MM') return undefined;
  const le = order === 'II';
  const u16 = (i: number) => (le ? u16le(tiff, i) : u16be(tiff, i));
  const u32 = (i: number) => (le ? u32le(tiff, i) : u32be(tiff, i));
  const ifd = u32(4);
  if (ifd + 2 > tiff.length) return undefined;
  const entries = u16(ifd);
  for (let n = 0; n < entries; n++) {
    const at = ifd + 2 + n * 12;
    if (at + 12 > tiff.length) return undefined;
    if (u16(at) === 0x0112) return u16(at + 8);
  }
  return undefined;
}

const oriented = (width: number, height: number, orientation: number | undefined) =>
  orientation !== undefined && orientation >= 5 && orientation <= 8 ? { width: height, height: width } : { width, height };

const XMP_JPEG = 'http://ns.adobe.com/xap/1.0/\0';

function parseJpeg(b: Uint8Array): ImageHeader | null {
  let i = 2;
  let exif = false;
  let xmp = false;
  let iptc = false;
  let orientation: number | undefined;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) return null;
    const marker = b[i + 1];
    if (marker === 0xff) {
      i++;
      continue;
    }
    // Standalone markers carry no length.
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    const len = u16be(b, i + 2);
    const seg = i + 4;
    if (marker === 0xe1 && ascii(b, seg, seg + 6) === 'Exif\0\0') {
      exif = true;
      orientation = exifOrientation(b.subarray(seg + 6, i + 2 + len));
    } else if (marker === 0xe1 && ascii(b, seg, seg + XMP_JPEG.length) === XMP_JPEG) {
      xmp = true;
    } else if (marker === 0xed && ascii(b, seg, seg + 13) === 'Photoshop 3.0') {
      iptc = true;
    }
    // SOF0–15, except DHT (C4), JPG (C8) and DAC (CC).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (seg + 6 > b.length) return null;
      const height = u16be(b, seg + 1);
      const width = u16be(b, seg + 3);
      if (!width || !height) return null;
      return { format: 'jpeg', ...oriented(width, height, orientation), animated: false, hasMetadata: exif || xmp || iptc, cmyk: b[seg + 5] === 4 };
    }
    i += 2 + len;
  }
  return null;
}

function parsePng(b: Uint8Array): ImageHeader | null {
  if (b.length < 24 || ascii(b, 12, 16) !== 'IHDR') return null;
  const width = u32be(b, 16);
  const height = u32be(b, 20);
  if (!width || !height) return null;
  let exif = false;
  let xmp = false;
  let orientation: number | undefined;
  // Ancillary chunks up to the image data (or the end of what was read).
  for (let i = 8; i + 8 <= b.length; ) {
    const len = u32be(b, i);
    const type = ascii(b, i + 4, i + 8);
    const data = b.subarray(i + 8, i + 8 + len);
    if (type === 'IDAT' || type === 'IEND') break;
    if (type === 'eXIf') {
      exif = true;
      orientation = exifOrientation(data);
    } else if ((type === 'iTXt' || type === 'tEXt' || type === 'zTXt') && ascii(data, 0, 17) === 'XML:com.adobe.xmp') {
      xmp = true;
    }
    i += 12 + len;
  }
  return { format: 'png', ...oriented(width, height, orientation), animated: false, hasMetadata: exif || xmp, cmyk: false };
}

/** Frames in a GIF, walking its blocks; stops early once two are seen. */
function gifFrames(b: Uint8Array): number {
  let i = 13;
  if (b[10] & 0x80) i += 3 * 2 ** ((b[10] & 0x07) + 1);
  let frames = 0;
  const skipSubBlocks = () => {
    while (i < b.length && b[i] !== 0) i += b[i] + 1;
    i++;
  };
  while (i < b.length && frames < 2) {
    const block = b[i];
    if (block === 0x3b) break;
    if (block === 0x21) {
      i += 2;
      skipSubBlocks();
    } else if (block === 0x2c) {
      frames++;
      const packed = b[i + 9];
      i += 10;
      if (packed & 0x80) i += 3 * 2 ** ((packed & 0x07) + 1);
      i++; // LZW minimum code size
      skipSubBlocks();
    } else {
      break;
    }
  }
  return frames;
}

function parseGif(b: Uint8Array): ImageHeader | null {
  if (b.length < 10) return null;
  const width = u16le(b, 6);
  const height = u16le(b, 8);
  if (!width || !height) return null;
  return { format: 'gif', width, height, animated: gifFrames(b) > 1, hasMetadata: false, cmyk: false };
}

function parseWebp(b: Uint8Array): ImageHeader | null {
  if (b.length < 30) return null;
  const first = ascii(b, 12, 16);
  let width: number;
  let height: number;
  let animated = false;
  let exif = false;
  let xmp = false;
  if (first === 'VP8 ') {
    if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null;
    width = u16le(b, 26) & 0x3fff;
    height = u16le(b, 28) & 0x3fff;
  } else if (first === 'VP8L') {
    if (b[20] !== 0x2f) return null;
    const bits = u32le(b, 21);
    width = (bits & 0x3fff) + 1;
    height = ((bits >>> 14) & 0x3fff) + 1;
  } else if (first === 'VP8X') {
    const flags = b[20];
    animated = (flags & 0x02) !== 0;
    exif = (flags & 0x08) !== 0;
    xmp = (flags & 0x04) !== 0;
    width = u24le(b, 24) + 1;
    height = u24le(b, 27) + 1;
  } else {
    return null;
  }
  let orientation: number | undefined;
  for (let i = 12; i + 8 <= b.length; ) {
    const len = u32le(b, i + 4);
    if (ascii(b, i, i + 4) === 'EXIF') {
      exif = true;
      const data = b.subarray(i + 8, i + 8 + len);
      // Some writers keep JPEG's "Exif\0\0" prefix inside the chunk.
      orientation = exifOrientation(ascii(data, 0, 6) === 'Exif\0\0' ? data.subarray(6) : data);
    } else if (ascii(b, i, i + 4) === 'XMP ') {
      xmp = true;
    }
    i += 8 + len + (len % 2);
  }
  if (!width || !height) return null;
  return { format: 'webp', ...oriented(width, height, orientation), animated, hasMetadata: exif || xmp, cmyk: false };
}

/**
 * The header of a JPEG, PNG, GIF or WebP, or null for anything else (SVG, HTML, PDF …) and for bytes
 * too short or malformed to read a size from.
 */
export function parseImageHeader(b: Uint8Array): ImageHeader | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return parseJpeg(b);
  if (b.length >= 8 && b[0] === 0x89 && ascii(b, 1, 8) === 'PNG\r\n\x1a\n') return parsePng(b);
  if (b.length >= 6 && (ascii(b, 0, 6) === 'GIF87a' || ascii(b, 0, 6) === 'GIF89a')) return parseGif(b);
  if (b.length >= 12 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WEBP') return parseWebp(b);
  return null;
}

export type SniffedImageMime = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

/**
 * src/common/utils/image-sniff.util.ts: the type the bytes really are, by magic number, or null
 * (SVG, HTML, PDF and every other "image" a browser would execute).
 */
export function sniffImageMime(b: Uint8Array): SniffedImageMime | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 8 && b[0] === 0x89 && ascii(b, 1, 8) === 'PNG\r\n\x1a\n') return 'image/png';
  if (b.length >= 6 && (ascii(b, 0, 6) === 'GIF87a' || ascii(b, 0, 6) === 'GIF89a')) return 'image/gif';
  if (b.length >= 12 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WEBP') return 'image/webp';
  return null;
}
