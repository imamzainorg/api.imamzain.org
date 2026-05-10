import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { MediaService } from './media.service';
import { PrismaService } from '../prisma/prisma.service';
import { R2Service } from '../storage/r2.service';
import { ImageVariantService } from './image-variant.service';

const baseMedia = {
  id: 'media-1',
  filename: 'photo.jpg',
  url: 'https://cdn.imamzain.org/media/photo.jpg',
  mime_type: 'image/jpeg',
  file_size: 10240,
  width: 800,
  height: 600,
  alt_text: null,
  created_at: new Date(),
};

describe('MediaService', () => {
  let service: MediaService;
  let prisma: any;
  let r2: any;
  let prismaMediaCreate: jest.Mock;

  beforeEach(async () => {
    prismaMediaCreate = jest.fn();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MediaService,
        {
          provide: PrismaService,
          useValue: {
            media: {
              findMany: jest.fn(),
              findUnique: jest.fn(),
              create: jest.fn(),
              update: jest.fn(),
              delete: jest.fn(),
              count: jest.fn(),
            },
            posts: { count: jest.fn() },
            books: { count: jest.fn() },
            gallery_images: { count: jest.fn() },
            post_attachments: { count: jest.fn() },
            pending_media_uploads: {
              create: jest.fn().mockResolvedValue({}),
              findFirst: jest.fn(),
              findMany: jest.fn(),
              delete: jest.fn().mockResolvedValue({}),
              deleteMany: jest.fn().mockResolvedValue({}),
            },
            audit_logs: { create: jest.fn().mockResolvedValue({}) },
            $transaction: jest.fn().mockImplementation(async (cb: any) =>
              cb({
                media: { create: prismaMediaCreate },
                pending_media_uploads: { deleteMany: jest.fn().mockResolvedValue({}) },
              }),
            ),
          },
        },
        {
          provide: R2Service,
          useValue: {
            generateUploadUrl: jest.fn(),
            objectExists: jest.fn().mockResolvedValue(true),
            headObject: jest.fn().mockResolvedValue({
              contentType: 'image/jpeg',
              contentLength: 10240,
            }),
            isManagedKey: jest.fn().mockReturnValue(true),
            keyFromPublicUrl: jest.fn().mockImplementation((u: string) =>
              u.replace('https://cdn.imamzain.org/', ''),
            ),
            deleteObject: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: ImageVariantService,
          useValue: {
            generateForMedia: jest.fn().mockResolvedValue([]),
            findForMedia: jest.fn().mockResolvedValue([]),
            findForMediaIds: jest.fn().mockResolvedValue(new Map()),
            deleteR2Variants: jest.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile();

    service = module.get<MediaService>(MediaService);
    prisma = module.get(PrismaService);
    r2 = module.get(R2Service);
  });

  afterEach(() => jest.clearAllMocks());

  describe('requestUploadUrl', () => {
    it('delegates to r2Service and returns result', async () => {
      r2.generateUploadUrl.mockResolvedValue({
        uploadUrl: 'https://r2.example.com/signed',
        key: 'media/abc-photo.jpg',
        publicUrl: 'https://cdn.imamzain.org/media/abc-photo.jpg',
      });

      const result = await service.requestUploadUrl(
        { filename: 'photo.jpg', mime_type: 'image/jpeg' },
        'user-1',
      );

      expect(r2.generateUploadUrl).toHaveBeenCalledWith('photo.jpg', 'image/jpeg');
      expect(result.data.uploadUrl).toContain('r2.example.com');
    });
  });

  describe('confirmUpload', () => {
    it('creates a media record bound to the user that requested the upload', async () => {
      prisma.pending_media_uploads.findFirst.mockResolvedValue({
        key: 'media/photo.jpg',
        requested_by: 'user-1',
      });
      prismaMediaCreate.mockResolvedValue(baseMedia);

      const result = await service.confirmUpload(
        {
          key: 'media/photo.jpg',
          filename: 'photo.jpg',
          mime_type: 'image/jpeg',
          file_size: 10240,
        },
        'user-1',
      );

      expect(prismaMediaCreate).toHaveBeenCalled();
      expect(result.message).toBe('Media created');
      expect(result.data.id).toBe('media-1');
    });

    it('rejects when no pending upload matches the key', async () => {
      prisma.pending_media_uploads.findFirst.mockResolvedValue(null);

      await expect(
        service.confirmUpload(
          {
            key: 'media/photo.jpg',
            filename: 'photo.jpg',
            mime_type: 'image/jpeg',
            file_size: 10240,
          },
          'user-1',
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects when the pending upload was issued to a different user', async () => {
      prisma.pending_media_uploads.findFirst.mockResolvedValue({
        key: 'media/photo.jpg',
        requested_by: 'someone-else',
      });

      const { ForbiddenException } = await import('@nestjs/common');
      await expect(
        service.confirmUpload(
          {
            key: 'media/photo.jpg',
            filename: 'photo.jpg',
            mime_type: 'image/jpeg',
            file_size: 10240,
          },
          'user-1',
        ),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('findAll', () => {
    it('returns paginated media', async () => {
      prisma.media.findMany.mockResolvedValue([baseMedia]);
      prisma.media.count.mockResolvedValue(1);

      const result = await service.findAll(1, 10);

      expect(result.data.items).toHaveLength(1);
      expect(result.data.pagination).toEqual({ page: 1, limit: 10, total: 1, pages: 1 });
    });
  });

  describe('findOne', () => {
    it('returns media when found', async () => {
      prisma.media.findUnique.mockResolvedValue(baseMedia);

      const result = await service.findOne('media-1');

      expect(result.data.id).toBe('media-1');
    });

    it('throws NotFoundException when not found', async () => {
      prisma.media.findUnique.mockResolvedValue(null);

      await expect(service.findOne('ghost')).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('updates alt_text and returns updated media', async () => {
      prisma.media.findUnique.mockResolvedValue(baseMedia);
      prisma.media.update.mockResolvedValue({ ...baseMedia, alt_text: 'A photo' });

      const result = await service.update('media-1', { alt_text: 'A photo' }, 'user-1');

      expect(result.data.alt_text).toBe('A photo');
    });

    it('throws NotFoundException when not found', async () => {
      prisma.media.findUnique.mockResolvedValue(null);

      await expect(service.update('ghost', {}, 'user-1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('delete', () => {
    it('deletes media and fires R2 delete in background', async () => {
      prisma.media.findUnique.mockResolvedValue(baseMedia);
      prisma.posts.count.mockResolvedValue(0);
      prisma.books.count.mockResolvedValue(0);
      prisma.gallery_images.count.mockResolvedValue(0);
      prisma.post_attachments.count.mockResolvedValue(0);
      prisma.media.delete.mockResolvedValue({});

      const result = await service.delete('media-1', 'user-1');

      expect(prisma.media.delete).toHaveBeenCalledWith({ where: { id: 'media-1' } });
      expect(result.message).toBe('Media deleted');
    });

    it('throws ConflictException when media is referenced by posts', async () => {
      prisma.media.findUnique.mockResolvedValue(baseMedia);
      prisma.posts.count.mockResolvedValue(2);
      prisma.books.count.mockResolvedValue(0);
      prisma.gallery_images.count.mockResolvedValue(0);
      prisma.post_attachments.count.mockResolvedValue(0);

      await expect(service.delete('media-1', 'user-1')).rejects.toThrow(ConflictException);
      expect(prisma.media.delete).not.toHaveBeenCalled();
    });

    it('throws ConflictException when media is referenced by gallery_images', async () => {
      prisma.media.findUnique.mockResolvedValue(baseMedia);
      prisma.posts.count.mockResolvedValue(0);
      prisma.books.count.mockResolvedValue(0);
      prisma.gallery_images.count.mockResolvedValue(1);
      prisma.post_attachments.count.mockResolvedValue(0);

      await expect(service.delete('media-1', 'user-1')).rejects.toThrow(ConflictException);
    });

    it('throws NotFoundException when media not found', async () => {
      prisma.media.findUnique.mockResolvedValue(null);

      await expect(service.delete('ghost', 'user-1')).rejects.toThrow(NotFoundException);
    });
  });
});
