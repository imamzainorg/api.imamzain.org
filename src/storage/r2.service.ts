import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'crypto';
import type { Readable } from 'stream';
import { IMAGE_SNIFF_BYTES } from '../common/utils/image-sniff.util';

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
]);

const ALLOWED_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

/**
 * Lifetime of a pending image upload: the presigned PUT URL and its
 * `pending_media_uploads` row both expire this long after issue. One constant on
 * both sides so the URL can never outlive the row that tracks the object — a PUT
 * landing after the row is gone is a blob nothing would ever sweep.
 */
export const PENDING_UPLOAD_TTL_SECONDS = 15 * 60;

const KEY_PREFIX = 'media/';
const ORIGINALS_PREFIX = `${KEY_PREFIX}originals/`;

/**
 * Per-MIME upload caps in bytes. The image cap is tuned for sharp's
 * in-memory decode on Render's standard plan (~512 MB RAM): a 25 MB JPEG
 * comfortably fits even when sharp expands it to an uncompressed raster.
 * Larger formats (e.g. PDF up to 150 MB for academic papers) can be
 * added here without touching controller code.
 */
const MAX_BYTES_BY_MIME: Record<string, number> = {
  'image/jpeg': 25 * 1024 * 1024,
  'image/png': 25 * 1024 * 1024,
  'image/gif': 25 * 1024 * 1024,
  'image/webp': 25 * 1024 * 1024,
};

const DEFAULT_MAX_BYTES = 25 * 1024 * 1024;

// ── Audio uploads ───────────────────────────────────────────────────────────
// Audio (and its optional companion PDF) lives under the existing R2 `audio/`
// folder, referenced by a plain CDN URL on the audios row — it does NOT go
// through the image media table / variant pipeline / confirm step.
const AUDIO_ALLOWED_MIME_TYPES = new Set(['audio/mpeg', 'audio/mp4', 'audio/x-m4a']);
const PDF_MIME_TYPE = 'application/pdf';
const AUDIO_EXTENSIONS: Record<string, string> = {
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
};
const AUDIO_PREFIX = 'audio/';
const AUDIO_PDF_PREFIX = 'audio/pdf/';
const MAX_AUDIO_BYTES = 300 * 1024 * 1024; // ~300 MB; long high-bitrate lectures
const MAX_PDF_BYTES = 50 * 1024 * 1024; // ~50 MB; transcript / booklet PDFs

// ── Document (book / academic-paper) PDF uploads ───────────────────────────
// Same no-confirm, no-media-row shape as the audio companion-PDF upload above
// (plain CDN URL saved straight onto the resource's `pdf_url` column) — just
// a bigger cap, since these are full books/theses rather than a lecture
// transcript. Deliberately its own constant, not a share of MAX_PDF_BYTES:
// the two caps are sized for different content and should be free to diverge.
export const DOCUMENT_PDF_BYTES = 150 * 1024 * 1024; // ~150 MB
export const BOOK_PDF_PREFIX = 'books/pdf/';
export const ACADEMIC_PAPER_PDF_PREFIX = 'academic-papers/pdf/';

/** Match new-format original keys: `media/originals/<uuid>/<filename>`. */
const ORIGINAL_KEY_PATTERN = /^media\/originals\/([0-9a-f-]{36})\//i;

function slugifyFilename(filename: string): string {
  return filename
    .toLowerCase()
    .replace(/\.[^.]+$/, '') // strip extension; we re-attach a known-safe one
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

export interface HeadObjectResult {
  contentType: string | undefined;
  contentLength: number | undefined;
  cacheControl?: string | undefined;
}

/**
 * True when an S3/R2 error means "no such object". Deleting a key that is
 * already gone is the goal state, not a failure.
 */
export function isStorageNotFound(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as { name?: unknown; Code?: unknown; $metadata?: { httpStatusCode?: unknown } };
  return (
    e.name === 'NoSuchKey' ||
    e.name === 'NotFound' ||
    e.Code === 'NoSuchKey' ||
    e.$metadata?.httpStatusCode === 404
  );
}

@Injectable()
export class R2Service {
  private readonly logger = new Logger(R2Service.name);
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly publicBaseUrl: string;
  private readonly uploadUrlTtl: number;

  constructor() {
    const accountId = process.env.R2_ACCOUNT_ID ?? '';
    const accessKeyId = process.env.R2_ACCESS_KEY_ID ?? '';
    const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY ?? '';

    this.bucket = process.env.R2_BUCKET ?? 'imamzain-media';
    this.publicBaseUrl = (process.env.R2_PUBLIC_BASE_URL ?? 'https://cdn.imamzain.org').replace(/\/$/, '');
    const configuredTtl = parseInt(process.env.R2_UPLOAD_URL_TTL_SECONDS ?? '900', 10);
    this.uploadUrlTtl = Number.isFinite(configuredTtl) && configuredTtl > 0 ? configuredTtl : 900;

    this.client = new S3Client({
      region: 'auto',
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId, secretAccessKey },
    });
  }

  /**
   * Strip the public base URL prefix from a stored URL to recover the
   * underlying object key. Falls back to URL parsing so a mismatch between
   * the configured base URL and the URL written at create time still yields
   * a usable key (instead of returning the full URL, which would later
   * silently no-op the delete and leave the object in the bucket).
   */
  keyFromPublicUrl(publicUrl: string): string {
    if (publicUrl.startsWith(this.publicBaseUrl + '/')) {
      return publicUrl.slice(this.publicBaseUrl.length + 1);
    }
    try {
      // Decode so this branch yields the same RAW key as the prefix-slice branch
      // above (R2 object keys are raw bytes — `new URL().pathname` percent-encodes
      // non-ASCII, which would otherwise break key equality, e.g. the reconcile
      // idempotency check and S3 deletes for Arabic/space filenames).
      const u = new URL(publicUrl);
      return decodeURIComponent(u.pathname.replace(/^\/+/, ''));
    } catch {
      return publicUrl;
    }
  }

  isManagedKey(key: string): boolean {
    return key.startsWith(KEY_PREFIX) && !key.includes('..') && !key.startsWith('/');
  }

  /** Per-MIME byte cap. Falls back to a conservative 25 MB for unknown types. */
  maxBytesFor(mimeType: string): number {
    return MAX_BYTES_BY_MIME[mimeType] ?? DEFAULT_MAX_BYTES;
  }

  /**
   * Extract the planned media row id from a new-format originals key.
   * Returns null for legacy keys (`media/<uuid>-name.ext`) so the caller
   * can fall back to generating a fresh id — the old layout did not
   * embed the id in the path.
   */
  mediaIdFromKey(key: string): string | null {
    const m = ORIGINAL_KEY_PATTERN.exec(key);
    return m ? m[1] : null;
  }

  async generateUploadUrl(filename: string, mimeType: string) {
    if (!ALLOWED_MIME_TYPES.has(mimeType)) {
      throw new BadRequestException(
        `MIME type "${mimeType}" is not allowed. Permitted types: ${[...ALLOWED_MIME_TYPES].join(', ')}`,
      );
    }

    // Pre-generate the media row id so the R2 layout mirrors the variants
    // folder (`media/variants/<mediaId>/...`). The CMS sees a stable id
    // before confirm runs, which is useful for client-side bookkeeping.
    const mediaId = randomUUID();
    const slug = slugifyFilename(filename);
    const ext = ALLOWED_EXTENSIONS[mimeType];
    const safeName = `${slug || 'file'}.${ext}`;
    const key = `${ORIGINALS_PREFIX}${mediaId}/${safeName}`;

    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: mimeType,
    });

    // Image uploads are tracked by a pending row that lives PENDING_UPLOAD_TTL_SECONDS,
    // so the URL never outlives it (R2_UPLOAD_URL_TTL_SECONDS can only shorten it).
    const uploadUrl = await getSignedUrl(this.client, command, this.presignOptions(PENDING_UPLOAD_TTL_SECONDS));
    const publicUrl = `${this.publicBaseUrl}/${key}`;

    return { uploadUrl, key, publicUrl, mediaId, maxBytes: this.maxBytesFor(mimeType) };
  }

  /**
   * Presign a PUT for a single audio (mp3/m4a) or PDF object under the `audio/`
   * prefix. Unlike {@link generateUploadUrl} this does NOT touch the image
   * variant pipeline, does NOT create a media / pending-upload row, and has NO
   * confirm step — the returned `publicUrl` is saved directly onto the audios
   * record (audio_url / pdf_url, plain text columns).
   *
   * The `maxBytes` returned is advisory: there is no server-side re-check (no
   * confirm/HeadObject step), so the client should validate file size before
   * the PUT.
   */
  async presignAudioUpload(filename: string, contentType: string) {
    const isPdf = contentType === PDF_MIME_TYPE;
    if (!isPdf && !AUDIO_ALLOWED_MIME_TYPES.has(contentType)) {
      throw new BadRequestException(
        `MIME type "${contentType}" is not allowed. Permitted: ${[...AUDIO_ALLOWED_MIME_TYPES, PDF_MIME_TYPE].join(', ')}`,
      );
    }

    if (isPdf) return this.presignDocumentUpload(filename, AUDIO_PDF_PREFIX, MAX_PDF_BYTES);

    const id = randomUUID();
    const slug = slugifyFilename(filename);
    const ext = AUDIO_EXTENSIONS[contentType];
    const safeName = `${slug || 'file'}.${ext}`;
    const key = `${AUDIO_PREFIX}${id}/${safeName}`;

    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: contentType,
    });

    const uploadUrl = await getSignedUrl(this.client, command, this.presignOptions());
    const publicUrl = `${this.publicBaseUrl}/${key}`;

    return { uploadUrl, key, publicUrl, maxBytes: MAX_AUDIO_BYTES };
  }

  /**
   * Presign a PUT for a PDF under an arbitrary key prefix — the shared core
   * behind {@link presignAudioUpload}'s PDF branch and books'/academic-papers'
   * document uploads. Same no-confirm, no-media-row trade-off throughout:
   * the returned `publicUrl` is saved directly onto the resource's `pdf_url`
   * column, with no server-side re-check of the uploaded file (validate size
   * client-side before the PUT — `maxBytes` is advisory only).
   */
  async presignDocumentUpload(filename: string, keyPrefix: string, maxBytes: number) {
    const id = randomUUID();
    const slug = slugifyFilename(filename);
    const safeName = `${slug || 'file'}.pdf`;
    const key = `${keyPrefix}${id}/${safeName}`;

    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: PDF_MIME_TYPE,
    });

    const uploadUrl = await getSignedUrl(this.client, command, this.presignOptions());
    const publicUrl = `${this.publicBaseUrl}/${key}`;

    return { uploadUrl, key, publicUrl, maxBytes };
  }

  /**
   * List every object key under the `audio/` prefix (paginated). Used by the
   * audio reconcile script to find CDN files that have no `audios` row yet.
   * Skips directory markers (keys ending in `/`); callers filter by extension.
   */
  async listAudioKeys(): Promise<string[]> {
    const keys: string[] = [];
    let continuationToken: string | undefined;
    do {
      const res = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: AUDIO_PREFIX,
          ContinuationToken: continuationToken,
        }),
      );
      for (const obj of res.Contents ?? []) {
        if (obj.Key && !obj.Key.endsWith('/')) keys.push(obj.Key);
      }
      continuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (continuationToken);
    return keys;
  }

  /** Build the public CDN URL for a stored object key. */
  publicUrlForKey(key: string): string {
    return `${this.publicBaseUrl}/${key}`;
  }

  async deleteObject(key: string): Promise<void> {
    const command = new DeleteObjectCommand({ Bucket: this.bucket, Key: key });
    await this.client.send(command);
  }

  async objectExists(key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Options for every presigned PUT. `signableHeaders` forces Content-Type
   * into the signature: the S3 presigner deliberately leaves it unsigned by
   * default, which let a client PUT `text/html` bytes under a URL presigned
   * for `image/jpeg` — and R2 would then serve them as HTML from the CDN
   * origin. With it signed, R2 rejects a PUT whose Content-Type differs from
   * the one declared to the upload-url call (the CMS always sends the same
   * value on all three upload paths).
   */
  private presignOptions(maxTtlSeconds?: number) {
    const expiresIn = maxTtlSeconds === undefined ? this.uploadUrlTtl : Math.min(this.uploadUrlTtl, maxTtlSeconds);
    return { expiresIn, signableHeaders: new Set(['content-type']) };
  }

  /** True when `mime` is one of the image types an upload may carry (jpeg/png/gif/webp). */
  isAllowedImageMime(mime: string | undefined): mime is string {
    return typeof mime === 'string' && ALLOWED_MIME_TYPES.has(mime);
  }

  /**
   * Fetch the actual stored Content-Type and Content-Length so the service
   * layer can compare them against client-declared values. Returns null when
   * the object isn't present.
   */
  async headObject(key: string): Promise<HeadObjectResult | null> {
    try {
      const result = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return {
        contentType: result.ContentType,
        contentLength: typeof result.ContentLength === 'number' ? result.ContentLength : undefined,
        cacheControl: result.CacheControl,
      };
    } catch (err) {
      this.logger.warn(`HeadObject failed for ${key}: ${err}`);
      return null;
    }
  }

  /**
   * Read only the first `bytes` bytes of an object (HTTP Range request) —
   * enough to sniff a magic number without pulling a 25 MB original through
   * the dyno. Used by the media confirm step.
   */
  async getObjectPrefix(key: string, bytes = IMAGE_SNIFF_BYTES): Promise<Buffer> {
    const result = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key, Range: `bytes=0-${bytes - 1}` }),
    );
    return this.readBody(key, result.Body as Readable | undefined);
  }

  /** Fetch an object's body as a Buffer. Used by the variant generator. */
  async getObjectBuffer(key: string): Promise<Buffer> {
    const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return this.readBody(key, result.Body as Readable | undefined);
  }

  private async readBody(key: string, body: Readable | undefined): Promise<Buffer> {
    if (!body) throw new Error(`R2 object ${key} returned an empty body`);
    const chunks: Buffer[] = [];
    for await (const chunk of body) {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  /**
   * Upload a buffer to R2 and return the resulting public URL. `cacheControl` is
   * only sent when given, so overwriting an object can keep the header it had.
   */
  async putObjectBuffer(key: string, body: Buffer, contentType: string, cacheControl?: string): Promise<string> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        ...(cacheControl ? { CacheControl: cacheControl } : {}),
      }),
    );
    return `${this.publicBaseUrl}/${key}`;
  }

  /** The variants prefix for a given media row. Mirrored by the cleanup delete. */
  variantKey(mediaId: string, width: number): string {
    return `${KEY_PREFIX}variants/${mediaId}/w${width}.webp`;
  }

  async checkConnectivity(): Promise<boolean> {
    try {
      await this.client.send(new ListObjectsV2Command({ Bucket: this.bucket, MaxKeys: 1 }));
      return true;
    } catch {
      return false;
    }
  }
}
