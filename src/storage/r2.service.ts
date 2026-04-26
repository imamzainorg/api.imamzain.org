import { BadRequestException, Injectable } from '@nestjs/common';
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createId } from '@paralleldrive/cuid2';

function slugifyFilename(filename: string): string {
  return filename
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, '-')
    .replace(/^-|-$/g, '');
}

@Injectable()
export class R2Service {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly publicBaseUrl: string;
  private readonly uploadUrlTtl: number;

  constructor() {
    const accountId = process.env.R2_ACCOUNT_ID ?? '';
    const accessKeyId = process.env.R2_ACCESS_KEY_ID ?? '';
    const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY ?? '';

    this.bucket = process.env.R2_BUCKET ?? 'imamzain-media';
    this.publicBaseUrl = process.env.R2_PUBLIC_BASE_URL ?? 'https://cdn.imamzain.org';
    this.uploadUrlTtl = parseInt(process.env.R2_UPLOAD_URL_TTL_SECONDS ?? '900', 10);

    this.client = new S3Client({
      region: 'auto',
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    });
  }

  async generateUploadUrl(filename: string, mimeType: string) {
    if (!/^image\//.test(mimeType)) {
      throw new BadRequestException('Only image MIME types are allowed');
    }

    const key = `media/${createId()}-${slugifyFilename(filename)}`;

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
    const command = new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });
    await this.client.send(command);
  }
}
