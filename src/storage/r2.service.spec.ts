import { BadRequestException } from '@nestjs/common';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { isStorageNotFound, PENDING_UPLOAD_TTL_SECONDS, R2Service } from './r2.service';

jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation(() => ({
    send: jest.fn().mockResolvedValue({}),
  })),
  PutObjectCommand: jest.fn(),
  DeleteObjectCommand: jest.fn(),
  HeadObjectCommand: jest.fn(),
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

  describe('presigned URL lifetime (S18)', () => {
    const expiresInOfLastPresign = () => {
      const calls = (getSignedUrl as jest.Mock).mock.calls;
      return calls[calls.length - 1][2].expiresIn;
    };

    afterEach(() => {
      delete process.env.R2_UPLOAD_URL_TTL_SECONDS;
    });

    it('caps an image upload URL at the pending-row lifetime even when the env asks for a day', async () => {
      process.env.R2_UPLOAD_URL_TTL_SECONDS = '86400';

      await new R2Service().generateUploadUrl('photo.jpg', 'image/jpeg');

      expect(PENDING_UPLOAD_TTL_SECONDS).toBe(900);
      expect(expiresInOfLastPresign()).toBe(PENDING_UPLOAD_TTL_SECONDS);
    });

    it('still honours a shorter env value', async () => {
      process.env.R2_UPLOAD_URL_TTL_SECONDS = '300';

      await new R2Service().generateUploadUrl('photo.jpg', 'image/jpeg');

      expect(expiresInOfLastPresign()).toBe(300);
    });

    it('defaults to the pending-row lifetime when the env is unset or unusable', async () => {
      delete process.env.R2_UPLOAD_URL_TTL_SECONDS;
      await new R2Service().generateUploadUrl('photo.jpg', 'image/jpeg');
      expect(expiresInOfLastPresign()).toBe(PENDING_UPLOAD_TTL_SECONDS);

      process.env.R2_UPLOAD_URL_TTL_SECONDS = 'not-a-number';
      await new R2Service().generateUploadUrl('photo.jpg', 'image/jpeg');
      expect(expiresInOfLastPresign()).toBe(PENDING_UPLOAD_TTL_SECONDS);
    });

    it('leaves the audio and PDF presigns (no pending row to outlive) on the env value', async () => {
      process.env.R2_UPLOAD_URL_TTL_SECONDS = '3600';
      const svc = new R2Service();

      await svc.presignAudioUpload('lecture.mp3', 'audio/mpeg');
      expect(expiresInOfLastPresign()).toBe(3600);

      await svc.presignDocumentUpload('book.pdf', 'books/pdf/', 1);
      expect(expiresInOfLastPresign()).toBe(3600);
    });
  });

  describe('isStorageNotFound', () => {
    it('recognises the shapes S3/R2 use for a missing key', () => {
      expect(isStorageNotFound(Object.assign(new Error('x'), { name: 'NoSuchKey' }))).toBe(true);
      expect(isStorageNotFound(Object.assign(new Error('x'), { name: 'NotFound' }))).toBe(true);
      expect(isStorageNotFound({ Code: 'NoSuchKey' })).toBe(true);
      expect(isStorageNotFound({ $metadata: { httpStatusCode: 404 } })).toBe(true);
    });

    it('does not mistake other failures for a missing key', () => {
      expect(isStorageNotFound(new Error('socket hang up'))).toBe(false);
      expect(isStorageNotFound({ $metadata: { httpStatusCode: 503 } })).toBe(false);
      expect(isStorageNotFound(null)).toBe(false);
      expect(isStorageNotFound('NoSuchKey')).toBe(false);
    });
  });

  describe('headObject', () => {
    it('returns the stored Cache-Control next to the type and size', async () => {
      (service as any).client.send.mockResolvedValueOnce({
        ContentType: 'image/jpeg',
        ContentLength: 2048,
        CacheControl: 'public, max-age=31536000',
      });

      await expect(service.headObject('media/originals/x/photo.jpg')).resolves.toEqual({
        contentType: 'image/jpeg',
        contentLength: 2048,
        cacheControl: 'public, max-age=31536000',
      });
    });
  });

  describe('putObjectBuffer', () => {
    it('sends Cache-Control only when one is given', async () => {
      await service.putObjectBuffer('media/variants/x/w320.webp', Buffer.from('a'), 'image/webp');
      expect(PutObjectCommand).toHaveBeenLastCalledWith(
        expect.not.objectContaining({ CacheControl: expect.anything() }),
      );

      await service.putObjectBuffer('media/originals/x/photo.jpg', Buffer.from('a'), 'image/jpeg', 'public, max-age=60');
      expect(PutObjectCommand).toHaveBeenLastCalledWith(
        expect.objectContaining({ ContentType: 'image/jpeg', CacheControl: 'public, max-age=60' }),
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

  describe('presignAudioUpload', () => {
    it('returns a 300 MB cap and the audio/ prefix for an audio MIME type', async () => {
      const result = await service.presignAudioUpload('lecture.mp3', 'audio/mpeg');

      expect(result.key).toBe('audio/test-uuid/lecture.mp3');
      expect(result.publicUrl).toBe('https://cdn.imamzain.org/audio/test-uuid/lecture.mp3');
      expect(result.maxBytes).toBe(300 * 1024 * 1024);
    });

    it('delegates PDF content to the audio/pdf/ prefix with a 50 MB cap', async () => {
      const result = await service.presignAudioUpload('transcript.pdf', 'application/pdf');

      expect(result.key).toBe('audio/pdf/test-uuid/transcript.pdf');
      expect(result.publicUrl).toBe('https://cdn.imamzain.org/audio/pdf/test-uuid/transcript.pdf');
      expect(result.maxBytes).toBe(50 * 1024 * 1024);
    });

    it('throws BadRequestException for a disallowed MIME type', async () => {
      await expect(service.presignAudioUpload('video.mp4', 'video/mp4')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('presignDocumentUpload', () => {
    it('builds a key under the given prefix and returns the given maxBytes, unrelated to the audio PDF cap', async () => {
      const result = await service.presignDocumentUpload('al-sahifa.pdf', 'books/pdf/', 150 * 1024 * 1024);

      expect(result.key).toBe('books/pdf/test-uuid/al-sahifa.pdf');
      expect(result.publicUrl).toBe('https://cdn.imamzain.org/books/pdf/test-uuid/al-sahifa.pdf');
      expect(result.maxBytes).toBe(150 * 1024 * 1024);
    });

    it('slugifies the filename and always appends a .pdf extension', async () => {
      const result = await service.presignDocumentUpload('My Paper (Final).PDF', 'academic-papers/pdf/', 1);

      expect(result.key).toBe('academic-papers/pdf/test-uuid/my-paper-final.pdf');
    });
  });
});
