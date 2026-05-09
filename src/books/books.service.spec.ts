import { Test, TestingModule } from "@nestjs/testing";
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { BooksService } from "./books.service";
import { PrismaService } from "../prisma/prisma.service";

const baseBook = {
  id: "book-1",
  category_id: "cat-1",
  cover_image_id: "media-1",
  isbn: "978-3-16-148410-0",
  pages: 200,
  publish_year: 2023,
  views: 5,
  deleted_at: null,
  book_translations: [
    { lang: "ar", title: "كتاب", author: "مؤلف", is_default: true },
    { lang: "en", title: "Book", author: "Author", is_default: false },
  ],
  media: { id: "media-1", url: "https://cdn.example.com/cover.jpg" },
  book_categories: { book_category_translations: [] },
};

describe("BooksService", () => {
  let service: BooksService;
  let prisma: any;

  const mockTx = {
    books: { create: jest.fn(), update: jest.fn() },
    book_translations: {
      createMany: jest.fn(),
      upsert: jest.fn(),
      count: jest.fn().mockResolvedValue(1),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BooksService,
        {
          provide: PrismaService,
          useValue: {
            books: {
              findMany: jest.fn(),
              findFirst: jest.fn(),
              findUnique: jest.fn(),
              count: jest.fn(),
              update: jest.fn().mockResolvedValue({}),
            },
            book_categories: { findFirst: jest.fn() },
            media: { findUnique: jest.fn() },
            audit_logs: { create: jest.fn().mockResolvedValue({}) },
            $transaction: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<BooksService>(BooksService);
    prisma = module.get(PrismaService);
  });

  afterEach(() => jest.clearAllMocks());

  describe("findAll", () => {
    it("returns paginated books with resolved translation", async () => {
      prisma.books.findMany.mockResolvedValue([baseBook]);
      prisma.books.count.mockResolvedValue(1);

      const result = await service.findAll({ page: 1, limit: 10 }, "ar");

      expect(result.data.items[0].translation.lang).toBe("ar");
      expect(result.data.pagination.total).toBe(1);
    });

    it("falls back to default translation when lang not matched", async () => {
      prisma.books.findMany.mockResolvedValue([baseBook]);
      prisma.books.count.mockResolvedValue(1);

      const result = await service.findAll({}, "fr");

      expect(result.data.items[0].translation.is_default).toBe(true);
    });
  });

  describe("findOne", () => {
    it("returns book and fires view increment", async () => {
      prisma.books.findFirst.mockResolvedValue(baseBook);

      const result = await service.findOne("book-1", "en");

      expect(result.data.translation.lang).toBe("en");
    });

    it("throws NotFoundException when book not found", async () => {
      prisma.books.findFirst.mockResolvedValue(null);

      await expect(service.findOne("ghost", null)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe("create", () => {
    it("creates book with translations in a transaction", async () => {
      prisma.book_categories.findFirst.mockResolvedValue({ id: "cat-1" });
      prisma.media.findUnique.mockResolvedValue({ id: "media-1" });
      prisma.books.findFirst.mockResolvedValue(null);
      mockTx.books.create.mockResolvedValue(baseBook);
      mockTx.book_translations.createMany.mockResolvedValue({});
      prisma.$transaction.mockImplementation((cb: any) => cb(mockTx));

      const result = await service.create(
        {
          category_id: "cat-1",
          cover_image_id: "media-1",
          translations: [{ lang: "ar", title: "كتاب", is_default: true }],
        },
        "user-1",
      );

      expect(result.data.id).toBe("book-1");
    });

    it("throws NotFoundException when category not found", async () => {
      prisma.book_categories.findFirst.mockResolvedValue(null);

      await expect(
        service.create(
          {
            category_id: "bad",
            cover_image_id: "m1",
            translations: [{ lang: "ar", title: "t", is_default: true }],
          },
          "u1",
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it("throws NotFoundException when cover_image not found", async () => {
      prisma.book_categories.findFirst.mockResolvedValue({ id: "cat-1" });
      prisma.media.findUnique.mockResolvedValue(null);

      await expect(
        service.create(
          {
            category_id: "cat-1",
            cover_image_id: "bad",
            translations: [{ lang: "ar", title: "t", is_default: true }],
          },
          "u1",
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it("throws ConflictException when ISBN already exists", async () => {
      prisma.book_categories.findFirst.mockResolvedValue({ id: "cat-1" });
      prisma.media.findUnique.mockResolvedValue({ id: "media-1" });
      prisma.books.findUnique.mockResolvedValue(baseBook);

      await expect(
        service.create(
          {
            category_id: "cat-1",
            cover_image_id: "media-1",
            isbn: "978-3-16-148410-0",
            translations: [{ lang: "ar", title: "t", is_default: true }],
          },
          "u1",
        ),
      ).rejects.toThrow(ConflictException);
    });

    it("throws BadRequestException when no default translation", async () => {
      prisma.book_categories.findFirst.mockResolvedValue({ id: "cat-1" });
      prisma.media.findUnique.mockResolvedValue({ id: "media-1" });
      prisma.books.findUnique.mockResolvedValue(null);

      await expect(
        service.create(
          {
            category_id: "cat-1",
            cover_image_id: "media-1",
            translations: [{ lang: "ar", title: "t", is_default: false }],
          },
          "u1",
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe("update", () => {
    it("updates book inside a transaction", async () => {
      prisma.books.findFirst
        .mockResolvedValueOnce(baseBook)
        .mockResolvedValue(null);
      mockTx.books.update.mockResolvedValue({});
      mockTx.book_translations.upsert.mockResolvedValue({});
      prisma.$transaction.mockImplementation((cb: any) => cb(mockTx));

      const result = await service.update("book-1", { pages: 300 }, "user-1");

      expect(result.message).toBe("Book updated");
    });

    it("throws NotFoundException when book not found", async () => {
      prisma.books.findFirst.mockResolvedValue(null);

      await expect(service.update("ghost", {}, "u1")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("throws ConflictException on duplicate ISBN", async () => {
      prisma.books.findFirst.mockResolvedValueOnce(baseBook);
      prisma.books.findUnique.mockResolvedValueOnce({ id: "book-2", isbn: "978-0-00-000000-0" });

      await expect(
        service.update("book-1", { isbn: "978-0-00-000000-0" }, "u1"),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe("softDelete", () => {
    it("sets deleted_at and frees up the isbn", async () => {
      prisma.books.findFirst.mockResolvedValue(baseBook);

      const result = await service.softDelete("book-1", "user-1");

      expect(prisma.books.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            deleted_at: expect.any(Date),
            isbn: expect.stringContaining("__del_"),
          }),
        }),
      );
      expect(result.message).toBe("Book deleted");
    });

    it("throws NotFoundException when not found", async () => {
      prisma.books.findFirst.mockResolvedValue(null);

      await expect(service.softDelete("ghost", "u1")).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
