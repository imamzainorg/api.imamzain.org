import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { S3Client, PutObjectCommand, DeleteObjectCommand, HeadObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'crypto';

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
      const u = new URL(publicUrl);
      return u.pathname.replace(/^\/+/, '');
    } catch {
      return publicUrl;
    }
  }

  isManagedKey(key: string): boolean {
    return key.startsWith(KEY_PREFIX) && !key.includes('..') && !key.startsWith('/');
  }

  async generateUploadUrl(filename: string, mimeType: string) {
    if (!ALLOWED_MIME_TYPES.has(mimeType)) {
      throw new BadRequestException(
        `MIME type "${mimeType}" is not allowed. Permitted types: ${[...ALLOWED_MIME_TYPES].join(', ')}`,
      );
    }

    const slug = slugifyFilename(filename);
    const ext = ALLOWED_EXTENSIONS[mimeType];
    const safeName = `${randomUUID()}-${slug || 'file'}.${ext}`;
    const key = `${KEY_PREFIX}${safeName}`;

    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: mimeType,
    });

    const uploadUrl = await getSignedUrl(this.client, command, { expiresIn: this.uploadUrlTtl });
    const publicUrl = `${this.publicBaseUrl}/${key}`;

    return { uploadUrl, key, publicUrl };
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

  async checkConnectivity(): Promise<boolean> {
    try {
      await this.client.send(new ListObjectsV2Command({ Bucket: this.bucket, MaxKeys: 1 }));
      return true;
    } catch {
      return false;
    }
  }
}
