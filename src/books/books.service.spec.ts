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
  parent_id: null,
  is_publication: false,
  book_translations: [
    { lang: "ar", title: "كتاب", author: "مؤلف", is_default: true },
    { lang: "en", title: "Book", author: "Author", is_default: false },
  ],
  media: { id: "media-1", url: "https://cdn.example.com/cover.jpg" },
  book_categories: { book_category_translations: [] },
  // findMany (list/trash) shape:
  _count: { parts_rel: 0 },
  // findFirst (detail) shape:
  parts_rel: [],
  parent: null,
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

    it("excludes series parts and reports parts_count for a series parent", async () => {
      const seriesParent = { ...baseBook, id: "parent-1", _count: { parts_rel: 12 } };
      prisma.books.findMany.mockResolvedValue([seriesParent]);
      prisma.books.count.mockResolvedValue(1);

      const result = await service.findAll({}, "ar");

      expect(prisma.books.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ parent_id: null }) }),
      );
      expect(result.data.items[0]!.parts_count).toBe(12);
      expect((result.data.items[0] as any)._count).toBeUndefined();
    });

    it("filters by is_publication when provided", async () => {
      prisma.books.findMany.mockResolvedValue([]);
      prisma.books.count.mockResolvedValue(0);

      await service.findAll({ is_publication: true } as any, "ar");

      expect(prisma.books.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ is_publication: true }) }),
      );
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

    it("returns parts[] ordered by part_number and parts_count for a series parent", async () => {
      const partA = { id: "part-1", slug: null, part_number: 1, pages: 100, pdf_url: "https://cdn.example.com/1.pdf", media: baseBook.media, book_translations: [{ lang: "ar", title: "السلسلة", is_default: true }] };
      const partB = { id: "part-2", slug: null, part_number: 2, pages: 120, pdf_url: "https://cdn.example.com/2.pdf", media: baseBook.media, book_translations: [{ lang: "ar", title: "السلسلة", is_default: true }] };
      prisma.books.findFirst.mockResolvedValue({ ...baseBook, id: "parent-1", parts_rel: [partA, partB], parent: null });

      const result = await service.findOne("parent-1", "ar");

      expect(result.data.parts_count).toBe(2);
      expect(result.data.parts).toHaveLength(2);
      expect(result.data.parts![0].part_number).toBe(1);
      expect(result.data.parts![0].translation!.title).toBe("السلسلة");
      expect(result.data.parent).toBeUndefined();
    });

    it("returns a parent back-reference and no parts[] when the book is itself a part", async () => {
      const parentRef = { id: "parent-1", slug: null, book_translations: [{ lang: "ar", title: "السلسلة", is_default: true }] };
      prisma.books.findFirst.mockResolvedValue({ ...baseBook, id: "part-1", part_number: 2, parts_rel: [], parent: parentRef });

      const result = await service.findOne("part-1", "ar");

      expect(result.data.parts).toBeUndefined();
      expect(result.data.parts_count).toBe(0);
      expect(result.data.parent).toBeDefined();
      expect(result.data.parent!.translation!.title).toBe("السلسلة");
    });

    it("returns neither parts[] nor parent for a plain standalone book", async () => {
      prisma.books.findFirst.mockResolvedValue(baseBook);

      const result = await service.findOne("book-1", "ar");

      expect(result.data.parts).toBeUndefined();
      expect(result.data.parent).toBeUndefined();
      expect(result.data.parts_count).toBe(0);
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

    it("throws NotFoundException when parent_id does not reference an existing book", async () => {
      prisma.book_categories.findFirst.mockResolvedValue({ id: "cat-1" });
      prisma.media.findUnique.mockResolvedValue({ id: "media-1" });
      prisma.books.findFirst.mockResolvedValue(null); // assertUsableParent lookup

      await expect(
        service.create(
          { category_id: "cat-1", cover_image_id: "media-1", parent_id: "ghost", translations: [{ lang: "ar", title: "t", is_default: true }] },
          "u1",
          null,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it("throws BadRequestException when parent_id points at a book that is itself a part", async () => {
      prisma.book_categories.findFirst.mockResolvedValue({ id: "cat-1" });
      prisma.media.findUnique.mockResolvedValue({ id: "media-1" });
      prisma.books.findFirst.mockResolvedValue({ id: "nested", parent_id: "grandparent-1" });

      await expect(
        service.create(
          { category_id: "cat-1", cover_image_id: "media-1", parent_id: "nested", translations: [{ lang: "ar", title: "t", is_default: true }] },
          "u1",
          null,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it("persists parent_id and is_publication", async () => {
      prisma.book_categories.findFirst.mockResolvedValue({ id: "cat-1" });
      prisma.media.findUnique.mockResolvedValue({ id: "media-1" });
      prisma.books.findFirst
        .mockResolvedValueOnce({ id: "parent-1", parent_id: null }) // assertUsableParent
        .mockResolvedValue(baseBook); // findOne's post-create hydrate
      mockTx.books.create.mockResolvedValue(baseBook);
      mockTx.book_translations.createMany.mockResolvedValue({});
      prisma.$transaction.mockImplementation((cb: any) => cb(mockTx));

      await service.create(
        {
          category_id: "cat-1",
          cover_image_id: "media-1",
          parent_id: "parent-1",
          is_publication: true,
          translations: [{ lang: "ar", title: "t", is_default: true }],
        },
        "u1",
        null,
      );

      expect(mockTx.books.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ parent_id: "parent-1", is_publication: true }) }),
      );
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

    it("throws BadRequestException when parent_id equals the book's own id", async () => {
      prisma.books.findFirst.mockResolvedValue(baseBook);

      await expect(
        service.update("book-1", { parent_id: "book-1" } as any, "u1", null),
      ).rejects.toThrow(BadRequestException);
    });

    it("throws BadRequestException when the book already has its own parts", async () => {
      prisma.books.findFirst.mockResolvedValue(baseBook);
      prisma.books.count.mockResolvedValueOnce(3); // childCount

      await expect(
        service.update("book-1", { parent_id: "some-other-book" } as any, "u1", null),
      ).rejects.toThrow(BadRequestException);
    });

    it("throws NotFoundException when the target parent_id doesn't exist", async () => {
      prisma.books.findFirst
        .mockResolvedValueOnce(baseBook) // existence check
        .mockResolvedValueOnce(null); // assertUsableParent
      prisma.books.count.mockResolvedValueOnce(0); // childCount

      await expect(
        service.update("book-1", { parent_id: "ghost" } as any, "u1", null),
      ).rejects.toThrow(NotFoundException);
    });

    it("connects a parent when parent_id is set", async () => {
      prisma.books.findFirst
        .mockResolvedValueOnce(baseBook) // existence check
        .mockResolvedValueOnce({ id: "parent-1", parent_id: null }) // assertUsableParent
        .mockResolvedValue(baseBook); // findOne hydrate
      prisma.books.count.mockResolvedValueOnce(0); // childCount
      mockTx.books.update.mockResolvedValue({});
      prisma.$transaction.mockImplementation((cb: any) => cb(mockTx));

      await service.update("book-1", { parent_id: "parent-1" } as any, "u1", null);

      expect(mockTx.books.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ parent: { connect: { id: "parent-1" } } }) }),
      );
    });

    it("disconnects the parent when parent_id is set to null", async () => {
      prisma.books.findFirst.mockResolvedValue(baseBook);
      mockTx.books.update.mockResolvedValue({});
      prisma.$transaction.mockImplementation((cb: any) => cb(mockTx));

      await service.update("book-1", { parent_id: null } as any, "u1", null);

      expect(mockTx.books.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ parent: { disconnect: true } }) }),
      );
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
