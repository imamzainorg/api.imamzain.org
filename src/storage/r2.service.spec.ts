import { BadRequestException } from '@nestjs/common';
import { R2Service } from './r2.service';

jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation(() => ({
    send: jest.fn().mockResolvedValue({}),
  })),
  PutObjectCommand: jest.fn(),
  DeleteObjectCommand: jest.fn(),
}));

jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn().mockResolvedValue('https://r2.example.com/signed-url'),
}));

jest.mock('crypto', () => ({
  ...jest.requireActual('crypto'),
  randomUUID: jest.fn().mockReturnValue('test-uuid'),
}));

describe('R2Service', () => {
  let service: R2Service;

  beforeEach(() => {
    process.env.R2_ACCOUNT_ID = 'test-account';
    process.env.R2_ACCESS_KEY_ID = 'key';
    process.env.R2_SECRET_ACCESS_KEY = 'secret';
    process.env.R2_BUCKET = 'test-bucket';
    process.env.R2_PUBLIC_BASE_URL = 'https://cdn.imamzain.org';
    service = new R2Service();
  });

  afterEach(() => jest.clearAllMocks());

  describe('generateUploadUrl', () => {
    it('returns uploadUrl, key, mediaId, and maxBytes for valid image MIME type', async () => {
      const result = await service.generateUploadUrl('photo.jpg', 'image/jpeg');

      expect(result.uploadUrl).toBe('https://r2.example.com/signed-url');
      expect(result.key).toBe('media/originals/test-uuid/photo.jpg');
      expect(result.publicUrl).toBe('https://cdn.imamzain.org/media/originals/test-uuid/photo.jpg');
      expect(result.mediaId).toBe('test-uuid');
      expect(result.maxBytes).toBe(25 * 1024 * 1024);
    });

    it('slugifies the filename in the key', async () => {
      const result = await service.generateUploadUrl('My Photo File.PNG', 'image/png');

      expect(result.key).toBe('media/originals/test-uuid/my-photo-file.png');
    });

    it('throws BadRequestException for non-image MIME types', async () => {
      await expect(service.generateUploadUrl('doc.pdf', 'application/pdf')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws BadRequestException for video MIME types', async () => {
      await expect(service.generateUploadUrl('video.mp4', 'video/mp4')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('mediaIdFromKey', () => {
    it('extracts the uuid from a new-format originals key', () => {
      const id = service.mediaIdFromKey('media/originals/9c8d4f7a-1b2e-4c5d-9e6f-7a8b9c0d1e2f/photo.jpg');
      expect(id).toBe('9c8d4f7a-1b2e-4c5d-9e6f-7a8b9c0d1e2f');
    });

    it('returns null for legacy keys (no `/originals/` segment)', () => {
      expect(service.mediaIdFromKey('media/old-uuid-photo.jpg')).toBeNull();
    });

    it('returns null for variants keys', () => {
      expect(service.mediaIdFromKey('media/variants/abc/w320.webp')).toBeNull();
    });
  });

  describe('maxBytesFor', () => {
    it('returns 25 MB for all image MIME types', () => {
      expect(service.maxBytesFor('image/jpeg')).toBe(25 * 1024 * 1024);
      expect(service.maxBytesFor('image/png')).toBe(25 * 1024 * 1024);
      expect(service.maxBytesFor('image/webp')).toBe(25 * 1024 * 1024);
      expect(service.maxBytesFor('image/gif')).toBe(25 * 1024 * 1024);
    });

    it('falls back to 25 MB for unknown MIME types', () => {
      expect(service.maxBytesFor('application/octet-stream')).toBe(25 * 1024 * 1024);
    });
  });

  describe('deleteObject', () => {
    it('sends a DeleteObjectCommand without throwing', async () => {
      await expect(service.deleteObject('media/some-key.jpg')).resolves.toBeUndefined();
    });
  });
});
