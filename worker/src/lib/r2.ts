// R2 storage (src/storage/r2.service.ts): the R2 binding for reads, writes and deletes; aws4fetch for
// the presigned PUT URLs the CMS uploads to directly, which need the bucket's S3 credentials.
import { AwsClient } from 'aws4fetch';
import { badRequest } from './errors';
import type { AppBindings } from './types';

export const ALLOWED_IMAGE_MIMES: ReadonlySet<string> = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
]);

const IMAGE_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

/** 25 MB for every image type (and anything unknown). */
const IMAGE_MAX_BYTES = 25 * 1024 * 1024;

/**
 * Lifetime of a pending image upload: the presigned URL and its pending_media_uploads row both expire
 * this long after issue, so the URL can never outlive the row that lets the sweep find its object.
 */
export const PENDING_UPLOAD_TTL_SECONDS = 15 * 60;

const KEY_PREFIX = 'media/';
/**
 * The media id baked into an original's key, for both shapes in the bucket: `media/<uuid>.<ext>` (flat,
 * current) and `media/originals/<uuid>/<filename>` (older uploads). Variants live under `media/variants/`,
 * which neither pattern matches.
 */
const ORIGINAL_KEY_PATTERNS = [
  /^media\/([0-9a-f-]{36})\.[a-z0-9]+$/i,
  /^media\/originals\/([0-9a-f-]{36})\//i,
];

/** Stored with every upload: keys are immutable UUIDs, so a URL's bytes never change. */
export const UPLOAD_CACHE_CONTROL = 'public, max-age=31536000, immutable';

type R2Env = Pick<
  AppBindings,
  | 'R2'
  | 'R2_PUBLIC_BASE_URL'
  | 'R2_ACCOUNT_ID'
  | 'R2_ACCESS_KEY_ID'
  | 'R2_SECRET_ACCESS_KEY'
  | 'R2_BUCKET'
  | 'R2_UPLOAD_URL_TTL_SECONDS'
>;

const publicBase = (env: R2Env) =>
  (env.R2_PUBLIC_BASE_URL || 'https://cdn.imamzain.org').replace(/\/$/, '');

export const publicUrlForKey = (env: R2Env, key: string) => `${publicBase(env)}/${key}`;

/**
 * The object key behind a stored public URL. Falls back to the URL's path (decoded, since R2 keys are
 * raw bytes) when the configured base URL doesn't match, so a delete still finds the object.
 */
export function keyFromPublicUrl(env: R2Env, url: string): string {
  const base = publicBase(env);
  if (url.startsWith(`${base}/`)) return url.slice(base.length + 1);
  try {
    return decodeURIComponent(new URL(url).pathname.replace(/^\/+/, ''));
  } catch {
    return url;
  }
}

export const isManagedKey = (key: string) =>
  key.startsWith(KEY_PREFIX) && !key.includes('..') && !key.startsWith('/');

export const maxBytesFor = (_mime: string) => IMAGE_MAX_BYTES;

/** The media id baked into an original's key; null for legacy keys that carry none. */
export function mediaIdFromKey(key: string): string | null {
  for (const pattern of ORIGINAL_KEY_PATTERNS) {
    const id = pattern.exec(key)?.[1];
    if (id) return id;
  }
  return null;
}

export const variantKey = (mediaId: string, width: number) =>
  `${KEY_PREFIX}variants/${mediaId}/w${width}.webp`;

const KNOWN_EXTENSIONS = /\.(jpe?g|png|gif|webp|pdf|mp3|m4a)$/i;
const LONE_SURROGATE =
  /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g;

/**
 * `inline; filename*=UTF-8''<name>` for the name a visitor's browser saves the file as. The key is a bare
 * UUID, so this header is the only place the readable name (Arabic included) survives. RFC 5987 encoding
 * keeps the header ASCII, which a signed header must be.
 */
export function contentDispositionFor(filename: string, extension: string): string {
  const base = filename
    .replace(/^.*[\\/]/, '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(LONE_SURROGATE, '\ufffd')
    .replace(KNOWN_EXTENSIONS, '')
    .trim();
  const name = `${Array.from(base).slice(0, 120).join('').trim() || 'file'}.${extension}`;
  const encoded = encodeURIComponent(name).replace(
    /['()*]/g,
    (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `inline; filename*=UTF-8''${encoded}`;
}

/** R2_UPLOAD_URL_TTL_SECONDS (default 900), never longer than `maxSeconds`. */
function uploadUrlTtl(env: R2Env, maxSeconds: number): number {
  const configured = parseInt(env.R2_UPLOAD_URL_TTL_SECONDS ?? '900', 10);
  return Math.min(Number.isFinite(configured) && configured > 0 ? configured : 900, maxSeconds);
}

/** What the uploader must send on the PUT: every one of these is a signed header. */
type UploadHeaders = Record<'Content-Type' | 'Cache-Control' | 'Content-Disposition', string>;

const uploadHeaders = (
  contentType: string,
  filename: string,
  extension: string,
): UploadHeaders => ({
  'Content-Type': contentType,
  'Cache-Control': UPLOAD_CACHE_CONTROL,
  'Content-Disposition': contentDispositionFor(filename, extension),
});

/**
 * A presigned PUT for `key` (virtual-hosted bucket URL). The headers are signed: R2 refuses a PUT whose
 * Content-Type differs from the one declared here (so `text/html` bytes can't land under a URL presigned
 * for `image/jpeg`), and the object is stored with exactly this Cache-Control and Content-Disposition.
 */
async function presignPut(
  env: R2Env,
  key: string,
  headers: UploadHeaders,
  ttlSeconds: number,
): Promise<string> {
  const client = new AwsClient({
    accessKeyId: env.R2_ACCESS_KEY_ID ?? '',
    secretAccessKey: env.R2_SECRET_ACCESS_KEY ?? '',
    service: 's3',
    region: 'auto',
  });
  const url = new URL(
    `https://${env.R2_BUCKET || 'imamzain-media'}.${env.R2_ACCOUNT_ID ?? ''}.r2.cloudflarestorage.com/${key}`,
  );
  url.searchParams.set('X-Amz-Expires', String(ttlSeconds));
  const signed = await client.sign(url.toString(), {
    method: 'PUT',
    headers,
    aws: { signQuery: true, allHeaders: true },
  });
  return signed.url;
}

/** Step 1 of an image upload: a fresh media id, its flat key `media/<id>.<ext>`, and the presigned PUT. */
export async function generateImageUploadUrl(env: R2Env, filename: string, mimeType: string) {
  if (!ALLOWED_IMAGE_MIMES.has(mimeType)) {
    throw badRequest(
      `MIME type "${mimeType}" is not allowed. Permitted types: ${[...ALLOWED_IMAGE_MIMES].join(', ')}`,
    );
  }
  const mediaId = crypto.randomUUID();
  const extension = IMAGE_EXTENSIONS[mimeType];
  const key = `${KEY_PREFIX}${mediaId}.${extension}`;
  const headers = uploadHeaders(mimeType, filename, extension);
  const uploadUrl = await presignPut(
    env,
    key,
    headers,
    uploadUrlTtl(env, PENDING_UPLOAD_TTL_SECONDS),
  );
  return {
    uploadUrl,
    key,
    publicUrl: publicUrlForKey(env, key),
    mediaId,
    maxBytes: maxBytesFor(mimeType),
    headers,
  };
}

/**
 * A presigned PUT for a file that needs no confirm step and no media row (audio, PDFs): the CMS saves
 * `publicUrl` straight onto the record. `maxBytes` is advisory: nothing re-checks the upload.
 */
export async function generateFileUploadUrl(
  env: R2Env,
  opts: {
    prefix: string;
    filename: string;
    extension: string;
    contentType: string;
    maxBytes: number;
  },
) {
  const key = `${opts.prefix}${crypto.randomUUID()}.${opts.extension}`;
  const headers = uploadHeaders(opts.contentType, opts.filename, opts.extension);
  const uploadUrl = await presignPut(env, key, headers, uploadUrlTtl(env, Number.POSITIVE_INFINITY));
  return {
    uploadUrl,
    key,
    publicUrl: publicUrlForKey(env, key),
    maxBytes: opts.maxBytes,
    headers,
  };
}

const AUDIO_EXTENSIONS: Record<string, string> = {
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
};
const PDF_MIME = 'application/pdf';
const MAX_AUDIO_BYTES = 300 * 1024 * 1024;
const MAX_AUDIO_PDF_BYTES = 50 * 1024 * 1024;
/** Whole books and theses: sized apart from the audio companion PDFs on purpose. */
export const DOCUMENT_PDF_BYTES = 150 * 1024 * 1024;
export const BOOK_PDF_PREFIX = 'books/pdf/';
export const ACADEMIC_PAPER_PDF_PREFIX = 'academic-papers/pdf/';

/** A PDF under `prefix` (books', papers' and audios' companion PDFs). */
export const presignDocumentUpload = (
  env: R2Env,
  filename: string,
  prefix: string,
  maxBytes: number,
) =>
  generateFileUploadUrl(env, {
    prefix,
    filename,
    extension: 'pdf',
    contentType: PDF_MIME,
    maxBytes,
  });

/** An mp3 / m4a under `audio/`, or a companion PDF under `audio/pdf/`. */
export function presignAudioUpload(env: R2Env, filename: string, contentType: string) {
  if (contentType === PDF_MIME)
    return presignDocumentUpload(env, filename, 'audio/pdf/', MAX_AUDIO_PDF_BYTES);
  const extension = AUDIO_EXTENSIONS[contentType];
  if (!extension) {
    throw badRequest(
      `MIME type "${contentType}" is not allowed. Permitted: ${[...Object.keys(AUDIO_EXTENSIONS), PDF_MIME].join(', ')}`,
    );
  }
  return generateFileUploadUrl(env, {
    prefix: 'audio/',
    filename,
    extension,
    contentType,
    maxBytes: MAX_AUDIO_BYTES,
  });
}

/** Stored type, size, cache header and download name of an object, or null when it isn't there. */
export async function headObject(env: R2Env, key: string) {
  const head = await env.R2.head(key);
  if (!head) return null;
  return {
    contentType: head.httpMetadata?.contentType,
    contentLength: head.size,
    cacheControl: head.httpMetadata?.cacheControl,
    contentDisposition: head.httpMetadata?.contentDisposition,
  };
}

/** The first `bytes` bytes (a ranged read), enough to sniff the format and read the image header. */
export async function getObjectPrefix(env: R2Env, key: string, bytes: number): Promise<Uint8Array> {
  const obj = await env.R2.get(key, { range: { offset: 0, length: bytes } });
  if (!obj) throw new Error(`R2 object ${key} not found`);
  return new Uint8Array(await obj.arrayBuffer());
}

/** The whole object, or null when it isn't there. */
export async function getObjectBytes(env: R2Env, key: string): Promise<Uint8Array | null> {
  const obj = await env.R2.get(key);
  return obj ? new Uint8Array(await obj.arrayBuffer()) : null;
}

/**
 * Writes `body` and returns its public URL. An overwrite replaces the object's headers, so it passes
 * the old ones back in `headers`; only the ones given are set.
 */
export async function putObject(
  env: R2Env,
  key: string,
  body: Uint8Array | ArrayBuffer,
  contentType: string,
  headers: { cacheControl?: string; contentDisposition?: string } = {},
): Promise<string> {
  await env.R2.put(key, body, {
    httpMetadata: {
      contentType,
      ...(headers.cacheControl ? { cacheControl: headers.cacheControl } : {}),
      ...(headers.contentDisposition ? { contentDisposition: headers.contentDisposition } : {}),
    },
  });
  return publicUrlForKey(env, key);
}

/** Deleting a key that is already gone succeeds (the binding doesn't report it). */
export async function deleteObject(env: R2Env, key: string): Promise<void> {
  await env.R2.delete(key);
}
