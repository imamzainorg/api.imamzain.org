import { Test, TestingModule } from "@nestjs/testing";
import { NotFoundException } from "@nestjs/common";
import { GalleryCategoriesService } from "./gallery-categories.service";
import { PrismaService } from "../prisma/prisma.service";

const baseCategory = {
  id: "cat-1",
  deleted_at: null,
  gallery_category_translations: [],
};

describe("GalleryCategoriesService", () => {
  let service: GalleryCategoriesService;
  let prisma: any;

  const mockTx = {
    gallery_categories: { create: jest.fn() },
    gallery_category_translations: { createMany: jest.fn() },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GalleryCategoriesService,
        {
          provide: PrismaService,
          useValue: {
            gallery_categories: {
              findMany: jest.fn(),
              findFirst: jest.fn(),
              update: jest.fn().mockResolvedValue({}),
            },
            gallery_category_translations: {
              upsert: jest.fn().mockResolvedValue({}),
            },
            audit_logs: { create: jest.fn().mockResolvedValue({}) },
            $transaction: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<GalleryCategoriesService>(GalleryCategoriesService);
    prisma = module.get(PrismaService);
  });

  afterEach(() => jest.clearAllMocks());

  describe("findAll", () => {
    it("filters translations by lang when Accept-Language is set", async () => {
      const category = {
        ...baseCategory,
        gallery_category_translations: [
          { lang: "ar", title: "معرض", slug: "maared" },
        ],
      };
      prisma.gallery_categories.findMany.mockResolvedValue([category]);

      const result = await service.findAll("ar");

      expect(prisma.gallery_categories.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { deleted_at: null },
          include: { gallery_category_translations: { where: { lang: "ar" } } },
        }),
      );
      expect(result.data[0].gallery_category_translations[0].lang).toBe("ar");
    });

    it("returns all translations when no lang specified", async () => {
      prisma.gallery_categories.findMany.mockResolvedValue([baseCategory]);

      await service.findAll(null);

      expect(prisma.gallery_categories.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          include: { gallery_category_translations: true },
        }),
      );
    });

    it("only queries non-deleted categories", async () => {
      prisma.gallery_categories.findMany.mockResolvedValue([]);

      await service.findAll(null);

      expect(prisma.gallery_categories.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { deleted_at: null } }),
      );
    });
  });

  describe("findOne", () => {
    it("returns category with lang-filtered translations", async () => {
      const category = {
        ...baseCategory,
        gallery_category_translations: [
          { lang: "en", title: "Gallery", slug: "gallery" },
        ],
      };
      prisma.gallery_categories.findFirst.mockResolvedValue(category);

      const result = await service.findOne("cat-1", "en");

      expect(prisma.gallery_categories.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "cat-1", deleted_at: null },
          include: { gallery_category_translations: { where: { lang: "en" } } },
        }),
      );
      expect(result.data.id).toBe("cat-1");
      expect(result.data.gallery_category_translations[0].lang).toBe("en");
    });

    it("returns all translations when no lang specified", async () => {
      prisma.gallery_categories.findFirst.mockResolvedValue(baseCategory);

      await service.findOne("cat-1", null);

      expect(prisma.gallery_categories.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          include: { gallery_category_translations: true },
        }),
      );
    });

    it("throws NotFoundException when not found", async () => {
      prisma.gallery_categories.findFirst.mockResolvedValue(null);

      await expect(service.findOne("ghost", null)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe("create", () => {
    it("creates category with translations in a transaction", async () => {
      mockTx.gallery_categories.create.mockResolvedValue(baseCategory);
      mockTx.gallery_category_translations.createMany.mockResolvedValue({});
      prisma.$transaction.mockImplementation((cb: any) => cb(mockTx));

      const result = await service.create(
        { translations: [{ lang: "ar", title: "معرض", slug: "maared" }] },
        "actor-1",
      );

      expect(mockTx.gallery_categories.create).toHaveBeenCalled();
      expect(
        mockTx.gallery_category_translations.createMany,
      ).toHaveBeenCalled();
      expect(result.data.id).toBe("cat-1");
    });
  });

  describe("update", () => {
    it("upserts translations for existing category", async () => {
      prisma.gallery_categories.findFirst.mockResolvedValue(baseCategory);

      const result = await service.update(
        "cat-1",
        { translations: [{ lang: "ar", title: "معرض", slug: "maared" }] },
        "actor-1",
      );

      expect(prisma.gallery_category_translations.upsert).toHaveBeenCalled();
      expect(result.message).toBe("Category updated");
    });

    it("throws NotFoundException when not found", async () => {
      prisma.gallery_categories.findFirst.mockResolvedValue(null);

      await expect(service.update("ghost", {}, "actor-1")).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe("softDelete", () => {
    it("soft-deletes the category", async () => {
      prisma.gallery_categories.findFirst.mockResolvedValue(baseCategory);

      const result = await service.softDelete("cat-1", "actor-1");

      expect(prisma.gallery_categories.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { deleted_at: expect.any(Date) } }),
      );
      expect(result.message).toBe("Category deleted");
    });

    it("throws NotFoundException when not found", async () => {
      prisma.gallery_categories.findFirst.mockResolvedValue(null);

      await expect(service.softDelete("ghost", "actor-1")).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
