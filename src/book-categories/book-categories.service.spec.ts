import { Test, TestingModule } from "@nestjs/testing";
import { ConflictException, NotFoundException } from "@nestjs/common";
import { BookCategoriesService } from "./book-categories.service";
import { PrismaService } from "../prisma/prisma.service";

const baseCategory = {
  id: "cat-1",
  deleted_at: null,
  book_category_translations: [],
};

describe("BookCategoriesService", () => {
  let service: BookCategoriesService;
  let prisma: any;

  const mockTx = {
    book_categories: { create: jest.fn() },
    book_category_translations: { createMany: jest.fn() },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BookCategoriesService,
        {
          provide: PrismaService,
          useValue: {
            book_categories: {
              findMany: jest.fn(),
              findFirst: jest.fn(),
              update: jest.fn().mockResolvedValue({}),
              count: jest.fn().mockResolvedValue(0),
            },
            book_category_translations: {
              upsert: jest.fn().mockResolvedValue({}),
            },
            books: { count: jest.fn() },
            audit_logs: { create: jest.fn().mockResolvedValue({}) },
            $transaction: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<BookCategoriesService>(BookCategoriesService);
    prisma = module.get(PrismaService);
  });

  afterEach(() => jest.clearAllMocks());

  describe("findAll", () => {
    it("resolves translation to requested lang when present", async () => {
      const category = {
        ...baseCategory,
        book_category_translations: [
          { lang: "ar", title: "فقه", slug: "fiqh" },
          { lang: "en", title: "Jurisprudence", slug: "jurisprudence" },
        ],
      };
      prisma.book_categories.findMany.mockResolvedValue([category]);

      const result = await service.findAll("ar", 1, 10);

      expect(prisma.book_categories.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { deleted_at: null },
          include: { book_category_translations: true },
          orderBy: [{ created_at: "desc" }, { id: "asc" }],
        }),
      );
      expect(result.data.items[0].translation.lang).toBe("ar");
    });

    it("falls back to first translation when requested lang is missing", async () => {
      const category = {
        ...baseCategory,
        book_category_translations: [
          { lang: "ar", title: "فقه", slug: "fiqh" },
        ],
      };
      prisma.book_categories.findMany.mockResolvedValue([category]);

      const result = await service.findAll("fr", 1, 10);

      expect(result.data.items[0].translation.lang).toBe("ar");
    });

    it("loads all translations and orders deterministically", async () => {
      prisma.book_categories.findMany.mockResolvedValue([baseCategory]);

      await service.findAll(null, 1, 10);

      expect(prisma.book_categories.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          include: { book_category_translations: true },
          orderBy: [{ created_at: "desc" }, { id: "asc" }],
        }),
      );
    });

    it("only queries non-deleted categories", async () => {
      prisma.book_categories.findMany.mockResolvedValue([]);

      await service.findAll(null, 1, 10);

      expect(prisma.book_categories.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { deleted_at: null } }),
      );
    });
  });

  describe("findOne", () => {
    it("returns category with resolved translation in requested lang", async () => {
      const category = {
        ...baseCategory,
        book_category_translations: [
          { lang: "ar", title: "فقه", slug: "fiqh" },
          { lang: "en", title: "Jurisprudence", slug: "jurisprudence" },
        ],
      };
      prisma.book_categories.findFirst.mockResolvedValue(category);

      const result = await service.findOne("cat-1", "en");

      expect(prisma.book_categories.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "cat-1", deleted_at: null },
          include: { book_category_translations: true },
        }),
      );
      expect(result.data.id).toBe("cat-1");
      expect(result.data.translation.lang).toBe("en");
    });

    it("falls back to first translation when requested lang is missing", async () => {
      const category = {
        ...baseCategory,
        book_category_translations: [{ lang: "ar", title: "فقه", slug: "fiqh" }],
      };
      prisma.book_categories.findFirst.mockResolvedValue(category);

      const result = await service.findOne("cat-1", "fr");

      expect(result.data.translation.lang).toBe("ar");
    });

    it("throws NotFoundException when not found", async () => {
      prisma.book_categories.findFirst.mockResolvedValue(null);

      await expect(service.findOne("ghost", null)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe("create", () => {
    it("creates category with translations in a transaction", async () => {
      mockTx.book_categories.create.mockResolvedValue(baseCategory);
      mockTx.book_category_translations.createMany.mockResolvedValue({});
      prisma.$transaction.mockImplementation((cb: any) => cb(mockTx));

      const result = await service.create(
        { translations: [{ lang: "ar", title: "فقه", slug: "fiqh" }] },
        "actor-1",
      );

      expect(mockTx.book_categories.create).toHaveBeenCalled();
      expect(mockTx.book_category_translations.createMany).toHaveBeenCalled();
      expect(result.data.id).toBe("cat-1");
    });
  });

  describe("update", () => {
    it("upserts translations for existing category", async () => {
      prisma.book_categories.findFirst.mockResolvedValue(baseCategory);

      const result = await service.update(
        "cat-1",
        { translations: [{ lang: "ar", title: "فقه", slug: "fiqh" }] },
        "actor-1",
      );

      expect(prisma.book_category_translations.upsert).toHaveBeenCalled();
      expect(result.message).toBe("Category updated");
    });

    it("throws NotFoundException when not found", async () => {
      prisma.book_categories.findFirst.mockResolvedValue(null);

      await expect(service.update("ghost", {}, "actor-1")).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe("softDelete", () => {
    it("soft-deletes the category when no books reference it", async () => {
      prisma.book_categories.findFirst.mockResolvedValue(baseCategory);
      prisma.books.count.mockResolvedValue(0);

      const result = await service.softDelete("cat-1", "actor-1");

      expect(prisma.book_categories.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { deleted_at: expect.any(Date) } }),
      );
      expect(result.message).toBe("Category deleted");
    });

    it("throws ConflictException when category has books", async () => {
      prisma.book_categories.findFirst.mockResolvedValue(baseCategory);
      prisma.books.count.mockResolvedValue(2);

      await expect(service.softDelete("cat-1", "actor-1")).rejects.toThrow(
        ConflictException,
      );
    });

    it("throws NotFoundException when not found", async () => {
      prisma.book_categories.findFirst.mockResolvedValue(null);

      await expect(service.softDelete("ghost", "actor-1")).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
