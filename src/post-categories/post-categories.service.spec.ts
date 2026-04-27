import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { PostCategoriesService } from './post-categories.service';
import { PrismaService } from '../prisma/prisma.service';

const baseCategory = { id: 'cat-1', deleted_at: null };

describe('PostCategoriesService', () => {
  let service: PostCategoriesService;
  let prisma: any;

  const mockTx = {
    post_categories: { create: jest.fn() },
    post_category_translations: { createMany: jest.fn() },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PostCategoriesService,
        {
          provide: PrismaService,
          useValue: {
            post_categories: {
              findMany: jest.fn(),
              findFirst: jest.fn(),
              update: jest.fn().mockResolvedValue({}),
            },
            post_category_translations: { upsert: jest.fn().mockResolvedValue({}) },
            posts: { count: jest.fn() },
            audit_logs: { create: jest.fn().mockResolvedValue({}) },
            $transaction: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<PostCategoriesService>(PostCategoriesService);
    prisma = module.get(PrismaService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('findAll', () => {
    it('returns all non-deleted categories', async () => {
      prisma.post_categories.findMany.mockResolvedValue([baseCategory]);

      const result = await service.findAll(null);

      expect(result.data).toHaveLength(1);
    });
  });

  describe('findOne', () => {
    it('returns category by id', async () => {
      prisma.post_categories.findFirst.mockResolvedValue(baseCategory);

      const result = await service.findOne('cat-1', null);

      expect(result.data.id).toBe('cat-1');
    });

    it('throws NotFoundException when not found', async () => {
      prisma.post_categories.findFirst.mockResolvedValue(null);

      await expect(service.findOne('ghost', null)).rejects.toThrow(NotFoundException);
    });
  });

  describe('create', () => {
    it('creates category with translations in a transaction', async () => {
      mockTx.post_categories.create.mockResolvedValue(baseCategory);
      mockTx.post_category_translations.createMany.mockResolvedValue({});
      prisma.$transaction.mockImplementation((cb) => cb(mockTx));

      const result = await service.create(
        { translations: [{ lang: 'ar', title: 'فئة', slug: 'fia' }] },
        'actor-1',
      );

      expect(mockTx.post_categories.create).toHaveBeenCalled();
      expect(mockTx.post_category_translations.createMany).toHaveBeenCalled();
      expect(result.data.id).toBe('cat-1');
    });
  });

  describe('update', () => {
    it('upserts translations for existing category', async () => {
      prisma.post_categories.findFirst.mockResolvedValue(baseCategory);

      const result = await service.update(
        'cat-1',
        { translations: [{ lang: 'ar', title: 'فئة', slug: 'fia' }] },
        'actor-1',
      );

      expect(prisma.post_category_translations.upsert).toHaveBeenCalled();
      expect(result.message).toBe('Category updated');
    });

    it('throws NotFoundException when not found', async () => {
      prisma.post_categories.findFirst.mockResolvedValue(null);

      await expect(service.update('ghost', {}, 'actor-1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('softDelete', () => {
    it('deletes category when no posts reference it', async () => {
      prisma.post_categories.findFirst.mockResolvedValue(baseCategory);
      prisma.posts.count.mockResolvedValue(0);

      const result = await service.softDelete('cat-1', 'actor-1');

      expect(prisma.post_categories.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { deleted_at: expect.any(Date) } }),
      );
      expect(result.message).toBe('Category deleted');
    });

    it('throws ConflictException when category has posts', async () => {
      prisma.post_categories.findFirst.mockResolvedValue(baseCategory);
      prisma.posts.count.mockResolvedValue(3);

      await expect(service.softDelete('cat-1', 'actor-1')).rejects.toThrow(ConflictException);
    });

    it('throws NotFoundException when not found', async () => {
      prisma.post_categories.findFirst.mockResolvedValue(null);

      await expect(service.softDelete('ghost', 'actor-1')).rejects.toThrow(NotFoundException);
    });
  });
});
