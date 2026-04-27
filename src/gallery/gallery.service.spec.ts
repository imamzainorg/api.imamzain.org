import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { GalleryService } from './gallery.service';
import { PrismaService } from '../prisma/prisma.service';

const baseImage = {
  media_id: 'media-1',
  category_id: 'cat-1',
  author: 'Photographer',
  tags: ['shrine', 'pilgrimage'],
  locations: ['Karbala'],
  taken_at: null,
  deleted_at: null,
  created_at: new Date(),
  gallery_image_translations: [
    { lang: 'ar', title: 'صورة', description: null, is_default: true },
    { lang: 'en', title: 'Photo', description: null, is_default: false },
  ],
  media: { id: 'media-1', url: 'https://cdn.example.com/photo.jpg' },
  gallery_categories: { gallery_category_translations: [] },
};

describe('GalleryService', () => {
  let service: GalleryService;
  let prisma: any;

  const mockTx = {
    gallery_images: { create: jest.fn(), update: jest.fn() },
    gallery_image_translations: { createMany: jest.fn(), upsert: jest.fn() },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GalleryService,
        {
          provide: PrismaService,
          useValue: {
            gallery_images: {
              findMany: jest.fn(),
              findFirst: jest.fn(),
              count: jest.fn(),
              update: jest.fn().mockResolvedValue({}),
            },
            media: { findUnique: jest.fn() },
            audit_logs: { create: jest.fn().mockResolvedValue({}) },
            $transaction: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<GalleryService>(GalleryService);
    prisma = module.get(PrismaService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('findAll', () => {
    it('returns paginated images with resolved translation', async () => {
      prisma.gallery_images.findMany.mockResolvedValue([baseImage]);
      prisma.gallery_images.count.mockResolvedValue(1);

      const result = await service.findAll({}, 'ar');

      expect(result.data.items[0].translation.lang).toBe('ar');
    });

    it('filters by category_id when provided', async () => {
      prisma.gallery_images.findMany.mockResolvedValue([]);
      prisma.gallery_images.count.mockResolvedValue(0);

      await service.findAll({ category_id: 'cat-1' }, null);

      expect(prisma.gallery_images.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ category_id: 'cat-1' }) }),
      );
    });

    it('filters by tags when provided', async () => {
      prisma.gallery_images.findMany.mockResolvedValue([]);
      prisma.gallery_images.count.mockResolvedValue(0);

      await service.findAll({ tags: ['shrine'] }, null);

      expect(prisma.gallery_images.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ tags: { hasEvery: ['shrine'] } }),
        }),
      );
    });
  });

  describe('findOne', () => {
    it('uses media_id as PK to find image', async () => {
      prisma.gallery_images.findFirst.mockResolvedValue(baseImage);

      await service.findOne('media-1', 'en');

      expect(prisma.gallery_images.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { media_id: 'media-1', deleted_at: null } }),
      );
    });

    it('throws NotFoundException when not found', async () => {
      prisma.gallery_images.findFirst.mockResolvedValue(null);

      await expect(service.findOne('ghost', null)).rejects.toThrow(NotFoundException);
    });
  });

  describe('create', () => {
    it('creates image and translations inside a transaction', async () => {
      prisma.media.findUnique.mockResolvedValue({ id: 'media-1' });
      mockTx.gallery_images.create.mockResolvedValue(baseImage);
      mockTx.gallery_image_translations.createMany.mockResolvedValue({});
      prisma.$transaction.mockImplementation((cb) => cb(mockTx));

      const result = await service.create(
        {
          media_id: 'media-1',
          translations: [{ lang: 'ar', title: 'صورة' }],
        },
        'user-1',
      );

      expect(mockTx.gallery_images.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ media_id: 'media-1' }) }),
      );
      expect(result.message).toBe('Gallery image created');
    });

    it('throws NotFoundException when media not found', async () => {
      prisma.media.findUnique.mockResolvedValue(null);

      await expect(
        service.create({ media_id: 'bad', translations: [] }, 'user-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('updates image using media_id as PK', async () => {
      prisma.gallery_images.findFirst.mockResolvedValue(baseImage);
      mockTx.gallery_images.update.mockResolvedValue({});
      prisma.$transaction.mockImplementation((cb) => cb(mockTx));

      const result = await service.update('media-1', { author: 'New Author' }, 'user-1');

      expect(mockTx.gallery_images.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { media_id: 'media-1' } }),
      );
      expect(result.message).toBe('Gallery image updated');
    });

    it('throws NotFoundException when not found', async () => {
      prisma.gallery_images.findFirst.mockResolvedValue(null);

      await expect(service.update('ghost', {}, 'user-1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('softDelete', () => {
    it('sets deleted_at using media_id', async () => {
      prisma.gallery_images.findFirst.mockResolvedValue(baseImage);

      const result = await service.softDelete('media-1', 'user-1');

      expect(prisma.gallery_images.update).toHaveBeenCalledWith({
        where: { media_id: 'media-1' },
        data: { deleted_at: expect.any(Date) },
      });
      expect(result.message).toBe('Gallery image deleted');
    });

    it('throws NotFoundException when not found', async () => {
      prisma.gallery_images.findFirst.mockResolvedValue(null);

      await expect(service.softDelete('ghost', 'user-1')).rejects.toThrow(NotFoundException);
    });
  });
});
