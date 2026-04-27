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
    it('returns uploadUrl, key, and publicUrl for valid image MIME type', async () => {
      const result = await service.generateUploadUrl('photo.jpg', 'image/jpeg');

      expect(result.uploadUrl).toBe('https://r2.example.com/signed-url');
      expect(result.key).toMatch(/^media\/test-uuid-/);
      expect(result.publicUrl).toContain('https://cdn.imamzain.org/media/');
    });

    it('slugifies the filename in the key', async () => {
      const result = await service.generateUploadUrl('My Photo File.PNG', 'image/png');

      expect(result.key).toContain('my-photo-file.png');
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

  describe('deleteObject', () => {
    it('sends a DeleteObjectCommand without throwing', async () => {
      await expect(service.deleteObject('media/some-key.jpg')).resolves.toBeUndefined();
    });
  });
});
