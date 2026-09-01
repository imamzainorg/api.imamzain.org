import { Test, TestingModule } from "@nestjs/testing";
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { BooksService } from "./books.service";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../common/audit/audit.service";
import { R2Service } from "../storage/r2.service";

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
  let r2: any;

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
        { provide: AuditService, useValue: { write: jest.fn().mockResolvedValue(true) } },
        {
          provide: R2Service,
          useValue: {
            presignDocumentUpload: jest.fn().mockResolvedValue({
              uploadUrl: 'https://r2.example.com/signed',
              key: 'books/pdf/uuid/book.pdf',
              publicUrl: 'https://cdn.imamzain.org/books/pdf/uuid/book.pdf',
              maxBytes: 150 * 1024 * 1024,
            }),
          },
        },
      ],
    }).compile();

    service = module.get<BooksService>(BooksService);
    prisma = module.get(PrismaService);
    r2 = module.get(R2Service);
  });

  afterEach(() => jest.clearAllMocks());

  describe("findAll", () => {
    it("returns paginated books with resolved translation", async () => {
      prisma.books.findMany.mockResolvedValue([baseBook]);
      prisma.books.count.mockResolvedValue(1);

      const result = await service.findAll({ page: 1, limit: 10 }, "ar");

      expect(result.data.items[0]!.translation!.lang).toBe("ar");
      expect(result.data.pagination.total).toBe(1);
    });

    it("falls back to default translation when lang not matched", async () => {
      prisma.books.findMany.mockResolvedValue([baseBook]);
      prisma.books.count.mockResolvedValue(1);

      const result = await service.findAll({}, "fr");

      expect(result.data.items[0]!.translation!.is_default).toBe(true);
    });
  });

  describe("findOne", () => {
    it("returns book and fires view increment", async () => {
      prisma.books.findFirst.mockResolvedValue(baseBook);

      const result = await service.findOne("book-1", "en");

      expect(result.data.translation!.lang).toBe("en");
    });

    it("throws NotFoundException when book not found", async () => {
      prisma.books.findFirst.mockResolvedValue(null);

      await expect(service.findOne("ghost", null)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe("requestPdfUploadUrl", () => {
    it("delegates to r2.presignDocumentUpload with the books PDF prefix and 150 MB cap", async () => {
      const result = await service.requestPdfUploadUrl({ filename: "book.pdf" });

      expect(r2.presignDocumentUpload).toHaveBeenCalledWith("book.pdf", "books/pdf/", 150 * 1024 * 1024);
      expect(result.message).toBe("Upload URL generated");
      expect(result.data.publicUrl).toContain("books/pdf/");
    });
  });

  describe("create", () => {
    it("creates book and returns hydrated detail", async () => {
      prisma.book_categories.findFirst.mockResolvedValue({ id: "cat-1" });
      prisma.media.findUnique.mockResolvedValue({ id: "media-1" });
      mockTx.books.create.mockResolvedValue(baseBook);
      mockTx.book_translations.createMany.mockResolvedValue({});
      prisma.$transaction.mockImplementation((cb: any) => cb(mockTx));
      // After the tx commits, create refetches the book with includes — same
      // shape findOne returns. Mock findFirst to back that hydrate call.
      prisma.books.findFirst.mockResolvedValue(baseBook);

      const result = await service.create(
        {
          category_id: "cat-1",
          cover_image_id: "media-1",
          translations: [{ lang: "ar", title: "كتاب", is_default: true }],
        },
        "user-1",
        null,
      );

      expect(result.data.id).toBe("book-1");
      expect(result.data.book_translations).toBeDefined();
      expect(result.data.translation).toBeDefined();
    });

    it("persists document_languages, defaulting to an empty array", async () => {
      prisma.book_categories.findFirst.mockResolvedValue({ id: "cat-1" });
      prisma.media.findUnique.mockResolvedValue({ id: "media-1" });
      mockTx.books.create.mockResolvedValue(baseBook);
      mockTx.book_translations.createMany.mockResolvedValue({});
      prisma.$transaction.mockImplementation((cb: any) => cb(mockTx));
      prisma.books.findFirst.mockResolvedValue(baseBook);

      const translations = [{ lang: "ar", title: "كتاب", is_default: true }];

      await service.create(
        { category_id: "cat-1", cover_image_id: "media-1", translations, document_languages: ["ar", "fa"] },
        "user-1",
        null,
      );
      expect(mockTx.books.create).toHaveBeenLastCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ document_languages: ["ar", "fa"] }) }),
      );

      // Omitted by the caller — the column is NOT NULL, so it must default to []
      await service.create(
        { category_id: "cat-1", cover_image_id: "media-1", translations },
        "user-1",
        null,
      );
      expect(mockTx.books.create).toHaveBeenLastCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ document_languages: [] }) }),
      );
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
          null,
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
          null,
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
          null,
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
          null,
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe("update", () => {
    it("updates book and returns hydrated detail", async () => {
      // Default mock covers both the initial existence check and findOne's hydrate.
      prisma.books.findFirst.mockResolvedValue(baseBook);
      mockTx.books.update.mockResolvedValue({});
      mockTx.book_translations.upsert.mockResolvedValue({});
      prisma.$transaction.mockImplementation((cb: any) => cb(mockTx));

      const result = await service.update("book-1", { pages: 300 }, "user-1", null);

      expect(result.message).toBe("Book updated");
      expect(result.data.id).toBe("book-1");
    });

    it("throws NotFoundException when book not found", async () => {
      prisma.books.findFirst.mockResolvedValue(null);

      await expect(service.update("ghost", {}, "u1", null)).rejects.toThrow(
        NotFoundException,
      );
    });

    it("throws ConflictException on duplicate ISBN", async () => {
      prisma.books.findFirst.mockResolvedValueOnce(baseBook);
      prisma.books.findUnique.mockResolvedValueOnce({ id: "book-2", isbn: "978-0-00-000000-0" });

      await expect(
        service.update("book-1", { isbn: "978-0-00-000000-0" }, "u1", null),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe("softDelete", () => {
    it("sets deleted_at and frees up the isbn and slug", async () => {
      prisma.books.findFirst.mockResolvedValue({ ...baseBook, slug: "kitab" });

      const result = await service.softDelete("book-1", "user-1");

      expect(prisma.books.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            deleted_at: expect.any(Date),
            isbn: expect.stringContaining("__del_"),
            slug: expect.stringContaining("kitab__del_"),
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
