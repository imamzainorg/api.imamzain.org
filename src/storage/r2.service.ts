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
    this.uploadUrlTtl = parseInt(process.env.R2_UPLOAD_URL_TTL_SECONDS ?? '900', 10);

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

    const uploadUrl = await getSignedUrl(this.client, command, { expiresIn: this.uploadUrlTtl });
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

    const id = randomUUID();
    const slug = slugifyFilename(filename);
    const ext = isPdf ? 'pdf' : AUDIO_EXTENSIONS[contentType];
    const safeName = `${slug || 'file'}.${ext}`;
    const prefix = isPdf ? AUDIO_PDF_PREFIX : AUDIO_PREFIX;
    const key = `${prefix}${id}/${safeName}`;

    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: contentType,
    });

    const uploadUrl = await getSignedUrl(this.client, command, { expiresIn: this.uploadUrlTtl });
    const publicUrl = `${this.publicBaseUrl}/${key}`;
    const maxBytes = isPdf ? MAX_PDF_BYTES : MAX_AUDIO_BYTES;

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
      };
    } catch (err) {
      this.logger.warn(`HeadObject failed for ${key}: ${err}`);
      return null;
    }
  }

  /** Fetch an object's body as a Buffer. Used by the variant generator. */
  async getObjectBuffer(key: string): Promise<Buffer> {
    const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    const body = result.Body as Readable | undefined;
    if (!body) throw new Error(`R2 object ${key} returned an empty body`);
    const chunks: Buffer[] = [];
    for await (const chunk of body) {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  /** Upload a buffer to R2 and return the resulting public URL. */
  async putObjectBuffer(key: string, body: Buffer, contentType: string): Promise<string> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
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
