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
import { PUBLIC_MEDIA_SELECT } from "../common/crud/media-selects";

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

/**
 * Stand-in for Prisma's argument handling, so a spec can assert on the shape a
 * caller would receive rather than only on the query. `select` keeps just the
 * listed keys; `include` keeps every scalar and re-projects the listed relations.
 */
function project(row: any, args: { select?: any; include?: any }): any {
  if (Array.isArray(row)) return row.map((r) => project(r, args));
  if (row === null || typeof row !== "object" || row instanceof Date) return row;
  const pick = (spec: any, key: string) => (spec[key] === true ? row[key] : project(row[key], spec[key]));
  if (args.select) {
    return Object.fromEntries(Object.keys(args.select).filter((k) => args.select[k]).map((k) => [k, pick(args.select, k)]));
  }
  const out = { ...row };
  for (const k of Object.keys(args.include ?? {})) out[k] = pick(args.include, k);
  return out;
}

// A row as the database holds it: staff ids and the full media record included.
const fullBook = {
  ...baseBook,
  added_by: "staff-uuid-1",
  parts: null,
  media: {
    id: "media-1",
    url: "https://cdn.example.com/cover.jpg",
    filename: "cover.jpg",
    alt_text: null,
    mime_type: "image/jpeg",
    width: 1200,
    height: 1800,
    file_size: 123456n,
    created_at: new Date("2024-01-01T00:00:00Z"),
    uploaded_by: "staff-uuid-2",
    media_variants: [{ id: "v1", width: 320, url: "https://cdn.example.com/v320.webp", format: "webp", file_size: 900n, media_id: "media-1" }],
  },
};

describe("BooksService", () => {
  let service: BooksService;
  let prisma: any;
  let r2: any;
  let audit: any;

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
            media: { findUnique: jest.fn(), findMany: jest.fn() },
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
    audit = module.get(AuditService);
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

    it("hides a part from the public when its series is unpublished or trashed", async () => {
      // The filtered `parent` back-ref comes back null when the parent is hidden.
      const orphanedPart = { ...baseBook, id: "part-1", parent_id: "parent-1", parent: null };
      prisma.books.findFirst.mockResolvedValue(orphanedPart);

      await expect(service.findOne("part-1", "ar")).rejects.toThrow(NotFoundException);
      // …but the CMS can still open it.
      await expect(service.findOne("part-1", "ar", true)).resolves.toBeDefined();
    });

    it("orders parts by part_number with a stable tiebreak", async () => {
      prisma.books.findFirst.mockResolvedValue(baseBook);

      await service.findOne("book-1", "ar");

      const { select } = prisma.books.findFirst.mock.calls[0][0];
      expect(select.parts_rel.orderBy).toEqual([{ part_number: "asc" }, { created_at: "asc" }, { id: "asc" }]);
    });
  });

  describe("findOne — public vs admin shape", () => {
    beforeEach(() => {
      prisma.books.findFirst.mockImplementation(async (args: any) => project(fullBook, args));
    });

    it("never sends the public the staff id or the raw media record", async () => {
      const { data } = await service.findOne("book-1", "ar");

      expect(data).not.toHaveProperty("added_by");
      for (const hidden of ["file_size", "uploaded_by", "created_at"]) {
        expect(data.media).not.toHaveProperty(hidden);
      }
      expect(data.media.media_variants[0]).not.toHaveProperty("file_size");
      expect(data.media.media_variants[0]).not.toHaveProperty("media_id");
      // ...while the public fields (and the srcset-ready variants) survive.
      expect(data.media).toMatchObject({ id: "media-1", url: fullBook.media.url, width: 1200, height: 1800 });
      expect(data.media.media_variants).toEqual([
        { id: "v1", width: 320, url: "https://cdn.example.com/v320.webp", format: "webp" },
      ]);
      expect(data).toMatchObject({ id: "book-1", isbn: baseBook.isbn, views: 5, is_publication: false });
    });

    it("queries the public detail with an allow-list, never a wildcard include", async () => {
      await service.findOne("book-1", "ar");

      const args = prisma.books.findFirst.mock.calls[0][0];
      expect(args.include).toBeUndefined();
      expect(args.select.added_by).toBeUndefined();
      expect(args.select.media).toEqual({ select: PUBLIC_MEDIA_SELECT });
    });

    it("resolves a book by slug through the same public shape", async () => {
      prisma.books.findFirst
        .mockResolvedValueOnce({ id: "book-1" }) // slug lookup
        .mockImplementation(async (args: any) => project(fullBook, args));

      const { data } = await service.findBySlug("kitab", "ar");

      expect(data).not.toHaveProperty("added_by");
      expect(data.media).not.toHaveProperty("file_size");
    });

    it("keeps everything for the CMS (admin flag)", async () => {
      // The admin arm is a superset of the public one, so the union type hides its extras.
      const data: any = (await service.findOne("book-1", "ar", true)).data;

      expect(data.added_by).toBe("staff-uuid-1");
      expect(data.media.file_size).toBe(123456n);
      expect(data.media.uploaded_by).toBe("staff-uuid-2");
      expect(data.media.media_variants).toHaveLength(1);
      const args = prisma.books.findFirst.mock.calls[0][0];
      expect(args.select).toBeUndefined();
      expect(args.include.media).toBeDefined();
    });

    it("still hides a part of an unpublished series from the public, and still shows it to the CMS", async () => {
      prisma.books.findFirst.mockImplementation(async (args: any) =>
        project({ ...fullBook, parent_id: "parent-1", parent: null }, args),
      );

      await expect(service.findOne("book-1", "ar")).rejects.toThrow(NotFoundException);
      await expect(service.findOne("book-1", "ar", true)).resolves.toBeDefined();
    });
  });

  describe("parts_count on lists", () => {
    beforeEach(() => {
      prisma.books.findMany.mockResolvedValue([{ ...baseBook, _count: { parts_rel: 4 } }]);
      prisma.books.count.mockResolvedValue(1);
    });

    it("counts only published, live parts on the public list", async () => {
      const result = await service.findAll({}, "ar");

      expect(prisma.books.findMany.mock.calls[0][0].select._count).toEqual({
        select: { parts_rel: { where: { deleted_at: null, is_published: true } } },
      });
      expect(result.data.items[0]!.parts_count).toBe(4);
    });

    it("keeps unpublished parts in the admin list and the trash view (the CMS works on drafts)", async () => {
      await service.findAll({}, "ar", true);
      await service.findTrash(1, 20);

      const adminCount = { select: { parts_rel: { where: { deleted_at: null } } } };
      expect(prisma.books.findMany.mock.calls[0][0].select._count).toEqual(adminCount);
      expect(prisma.books.findMany.mock.calls[1][0].select._count).toEqual(adminCount);
    });

    it("uses the same visibility filter as the detail's parts relation", async () => {
      prisma.books.findFirst.mockResolvedValue(baseBook);
      await service.findAll({}, "ar");
      await service.findOne("book-1", "ar");

      const listWhere = prisma.books.findMany.mock.calls[0][0].select._count.select.parts_rel.where;
      const detailWhere = prisma.books.findFirst.mock.calls[0][0].select.parts_rel.where;
      expect(listWhere).toEqual(detailWhere);
    });
  });

  describe("trackView", () => {
    it("only counts a view for a part whose series is public", async () => {
      prisma.books.updateMany = jest.fn().mockResolvedValue({ count: 1 });

      await service.trackView("part-1");

      expect(prisma.books.updateMany.mock.calls[0][0].where).toEqual({
        id: "part-1",
        deleted_at: null,
        is_published: true,
        OR: [{ parent_id: null }, { parent: { deleted_at: null, is_published: true } }],
      });
    });
  });

  describe("togglePublish", () => {
    it("is a no-op when the book is already in the requested state (no write, no audit row)", async () => {
      prisma.books.findFirst.mockResolvedValue({ ...baseBook, is_published: true });

      const result = await service.togglePublish("book-1", true, "user-1", null);

      expect(result.message).toBe("Book already in requested state");
      expect(prisma.books.update).not.toHaveBeenCalled();
      expect(audit.write).not.toHaveBeenCalled();
    });

    it("flips the flag and writes one audit row when the state changes", async () => {
      prisma.books.findFirst.mockResolvedValue({ ...baseBook, is_published: false });

      const result = await service.togglePublish("book-1", true, "user-1", null);

      expect(result.message).toBe("Book published");
      expect(prisma.books.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: "book-1" }, data: expect.objectContaining({ is_published: true }) }),
      );
      expect(audit.write).toHaveBeenCalledTimes(1);
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
    it("returns the created row even when it is a draft (hydrates with the admin flag)", async () => {
      prisma.book_categories.findFirst.mockResolvedValue({ id: "cat-1" });
      prisma.media.findUnique.mockResolvedValue({ id: "media-1" });
      mockTx.books.create.mockResolvedValue({ ...baseBook, is_published: false });
      mockTx.book_translations.createMany.mockResolvedValue({});
      prisma.$transaction.mockImplementation((cb: any) => cb(mockTx));
      // A public-only hydrate (`is_published: true` in the where) finds nothing —
      // which used to turn a committed create into a 404.
      prisma.books.findFirst.mockImplementation(async (args: any) =>
        args?.where?.is_published === true ? null : { ...baseBook, is_published: false },
      );

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
      const calls = prisma.books.findFirst.mock.calls;
      expect(calls[calls.length - 1][0].where.is_published).toBeUndefined();
    });

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

    describe("og_image_id pre-check", () => {
      const withOg = (...ids: (string | undefined)[]) =>
        ids.map((og, i) => ({ lang: i === 0 ? "ar" : "en", title: "t", is_default: i === 0, og_image_id: og }));

      beforeEach(() => {
        prisma.book_categories.findFirst.mockResolvedValue({ id: "cat-1" });
        prisma.media.findUnique.mockResolvedValue({ id: "media-1" });
        mockTx.books.create.mockResolvedValue(baseBook);
        mockTx.book_translations.createMany.mockResolvedValue({});
        prisma.$transaction.mockImplementation((cb: any) => cb(mockTx));
        prisma.books.findFirst.mockResolvedValue(baseBook);
      });

      it("answers 404 with the posts/gallery message when an og image does not exist", async () => {
        prisma.media.findMany.mockResolvedValue([{ id: "og-1" }]); // og-2 is missing

        await expect(
          service.create(
            { category_id: "cat-1", cover_image_id: "media-1", translations: withOg("og-1", "og-2") },
            "u1",
            null,
          ),
        ).rejects.toThrow(new NotFoundException("One or more og_image_id values do not match any media record"));
        expect(prisma.media.findMany).toHaveBeenCalledWith({ where: { id: { in: ["og-1", "og-2"] } }, select: { id: true } });
        expect(prisma.$transaction).not.toHaveBeenCalled();
      });

      it("accepts existing og images, counting a repeated id once", async () => {
        prisma.media.findMany.mockResolvedValue([{ id: "og-1" }]);

        await expect(
          service.create(
            { category_id: "cat-1", cover_image_id: "media-1", translations: withOg("og-1", "og-1") },
            "u1",
            null,
          ),
        ).resolves.toBeDefined();
      });

      it("skips the lookup when no translation carries an og_image_id", async () => {
        await service.create({ category_id: "cat-1", cover_image_id: "media-1", translations: withOg(undefined) }, "u1", null);

        expect(prisma.media.findMany).not.toHaveBeenCalled();
      });
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

    const createBody = (fields: Record<string, unknown>) =>
      ({
        category_id: "cat-1",
        cover_image_id: "media-1",
        translations: [{ lang: "ar", title: "t", is_default: true }],
        ...fields,
      }) as any;

    it.each([
      ["part_number without parts", { part_number: 2 }],
      ["parts without part_number", { parts: 5 }],
      ["part_number above parts", { part_number: 6, parts: 5 }],
    ])("rejects %s with a 400 instead of tripping chk_books_parts", async (_label, fields) => {
      prisma.book_categories.findFirst.mockResolvedValue({ id: "cat-1" });
      prisma.media.findUnique.mockResolvedValue({ id: "media-1" });

      await expect(service.create(createBody(fields), "u1", null)).rejects.toThrow(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it("rejects a part number another live part of the series already uses", async () => {
      prisma.book_categories.findFirst.mockResolvedValue({ id: "cat-1" });
      prisma.media.findUnique.mockResolvedValue({ id: "media-1" });
      prisma.books.findFirst
        .mockResolvedValueOnce({ id: "parent-1", parent_id: null, is_published: true }) // assertUsableParent
        .mockResolvedValueOnce({ id: "part-already-3" }); // assertPartNumberAvailable

      await expect(
        service.create(createBody({ parent_id: "parent-1", part_number: 3, parts: 12 }), "u1", null),
      ).rejects.toThrow(ConflictException);
      expect(prisma.books.findFirst.mock.calls[1][0].where).toEqual(
        expect.objectContaining({ parent_id: "parent-1", part_number: 3, deleted_at: null }),
      );
    });

    it("reports a part-number race (P2002 on the partial unique index) as a part-number conflict", async () => {
      const { Prisma } = jest.requireActual("@prisma/client");
      prisma.book_categories.findFirst.mockResolvedValue({ id: "cat-1" });
      prisma.media.findUnique.mockResolvedValue({ id: "media-1" });
      prisma.books.findFirst
        .mockResolvedValueOnce({ id: "parent-1", parent_id: null, is_published: true })
        .mockResolvedValueOnce(null);
      prisma.$transaction.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
          code: "P2002",
          clientVersion: "test",
          meta: { target: "uq_books_parent_part_number" },
        }),
      );

      await expect(
        service.create(createBody({ parent_id: "parent-1", part_number: 3, parts: 12, slug: "vol-3" }), "u1", null),
      ).rejects.toThrow("That part number is already used by another part of this series");
    });

    it("defaults a new part's is_published to its series' state", async () => {
      prisma.book_categories.findFirst.mockResolvedValue({ id: "cat-1" });
      prisma.media.findUnique.mockResolvedValue({ id: "media-1" });
      prisma.books.findFirst
        .mockResolvedValueOnce({ id: "parent-1", parent_id: null, is_published: false }) // assertUsableParent
        .mockResolvedValue(baseBook); // hydrate
      mockTx.books.create.mockResolvedValue(baseBook);
      mockTx.book_translations.createMany.mockResolvedValue({});
      prisma.$transaction.mockImplementation((cb: any) => cb(mockTx));

      await service.create(createBody({ parent_id: "parent-1" }), "u1", null);

      expect(mockTx.books.create.mock.calls[0][0].data.is_published).toBe(false);
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

    it("answers 404 for an unknown og_image_id on update, before touching the row", async () => {
      prisma.books.findFirst.mockResolvedValue(baseBook);
      prisma.media.findMany.mockResolvedValue([]);

      await expect(
        service.update("book-1", { translations: [{ lang: "ar", title: "t", is_default: true, og_image_id: "ghost" }] }, "u1", null),
      ).rejects.toThrow("One or more og_image_id values do not match any media record");
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it("does not look up og images when the patch has no translations", async () => {
      prisma.books.findFirst.mockResolvedValue(baseBook);
      mockTx.books.update.mockResolvedValue({});
      prisma.$transaction.mockImplementation((cb: any) => cb(mockTx));

      await service.update("book-1", { pages: 10 }, "u1", null);

      expect(prisma.media.findMany).not.toHaveBeenCalled();
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

    it("validates part fields as they will be after the patch, not just what was sent", async () => {
      prisma.books.findFirst.mockResolvedValue({ ...baseBook, part_number: 4, parts: 5 });

      // parts alone → 3 < stored part_number 4
      await expect(service.update("book-1", { parts: 3 }, "u1", null)).rejects.toThrow(BadRequestException);
      // clearing only one of the pair
      await expect(service.update("book-1", { parts: null } as any, "u1", null)).rejects.toThrow(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it("rejects renumbering a part onto a number its series already uses", async () => {
      prisma.books.findFirst
        .mockResolvedValueOnce({ ...baseBook, parent_id: "parent-1", part_number: 2, parts: 12 }) // load
        .mockResolvedValueOnce({ id: "sibling" }); // assertPartNumberAvailable

      await expect(service.update("book-1", { part_number: 3 }, "u1", null)).rejects.toThrow(ConflictException);
      expect(prisma.books.findFirst.mock.calls[1][0].where).toEqual(
        expect.objectContaining({ parent_id: "parent-1", part_number: 3, NOT: { id: "book-1" } }),
      );
    });

    it("does not re-check the part number on an edit that leaves series and number alone", async () => {
      prisma.books.findFirst.mockResolvedValue({ ...baseBook, parent_id: "parent-1", part_number: 2, parts: 12 });
      mockTx.books.update.mockResolvedValue({});
      prisma.$transaction.mockImplementation((cb: any) => cb(mockTx));

      await service.update("book-1", { pages: 310 }, "u1", null);

      // load + hydrate only — no availability lookup
      expect(prisma.books.findFirst).toHaveBeenCalledTimes(2);
    });

    it("refuses to rename the slug of a published book, but allows giving it its first slug", async () => {
      prisma.books.findFirst.mockResolvedValueOnce({ ...baseBook, slug: "old-slug", is_published: true });
      await expect(service.update("book-1", { slug: "new-slug" }, "u1", null)).rejects.toMatchObject({
        status: 409,
        response: expect.objectContaining({ code: "SLUG_LOCKED_WHILE_PUBLISHED" }),
      });

      prisma.books.findFirst
        .mockResolvedValueOnce({ ...baseBook, slug: null, is_published: true }) // load
        .mockResolvedValueOnce(null) // slug availability
        .mockResolvedValue(baseBook); // hydrate
      mockTx.books.update.mockResolvedValue({});
      prisma.$transaction.mockImplementation((cb: any) => cb(mockTx));
      await expect(service.update("book-1", { slug: "first-slug" }, "u1", null)).resolves.toBeDefined();
    });
  });

  describe("restore", () => {
    const trashedPart = {
      ...baseBook,
      id: "part-1",
      isbn: null,
      slug: null,
      parent_id: "parent-1",
      part_number: 3,
      parts: 12,
      deleted_at: new Date(),
    };

    it("refuses to restore a part whose series is in the trash", async () => {
      prisma.books.findFirst.mockResolvedValue(trashedPart);
      prisma.book_categories.findFirst.mockResolvedValue({ id: "cat-1" });
      prisma.books.findUnique.mockResolvedValue({ deleted_at: new Date(), parent_id: null });

      await expect(service.restore("part-1", "u1")).rejects.toThrow(/restore the series first/);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it("refuses to restore a part whose series has since become a part itself", async () => {
      prisma.books.findFirst.mockResolvedValue(trashedPart);
      prisma.book_categories.findFirst.mockResolvedValue({ id: "cat-1" });
      prisma.books.findUnique.mockResolvedValue({ deleted_at: null, parent_id: "grandparent" });

      await expect(service.restore("part-1", "u1")).rejects.toThrow(ConflictException);
    });

    it("refuses to restore a part whose number was taken while it sat in the trash", async () => {
      prisma.books.findFirst.mockResolvedValue(trashedPart);
      prisma.book_categories.findFirst.mockResolvedValue({ id: "cat-1" });
      prisma.books.findUnique.mockResolvedValue({ deleted_at: null, parent_id: null });
      const tx = { books: { findFirst: jest.fn().mockResolvedValue({ id: "new-part-3" }), update: jest.fn() } };
      prisma.$transaction.mockImplementation((cb: any) => cb(tx));

      await expect(service.restore("part-1", "u1")).rejects.toThrow(/part number 3 is now used/);
      expect(tx.books.update).not.toHaveBeenCalled();
    });

    it("restores a part under a live top-level series", async () => {
      prisma.books.findFirst.mockResolvedValue(trashedPart);
      prisma.book_categories.findFirst.mockResolvedValue({ id: "cat-1" });
      prisma.books.findUnique.mockResolvedValue({ deleted_at: null, parent_id: null });
      const tx = { books: { findFirst: jest.fn().mockResolvedValue(null), update: jest.fn().mockResolvedValue({}) } };
      prisma.$transaction.mockImplementation((cb: any) => cb(tx));

      const result = await service.restore("part-1", "u1");

      expect(result.message).toBe("Book restored");
      expect(tx.books.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: "part-1" }, data: expect.objectContaining({ deleted_at: null }) }),
      );
    });
  });

  describe("softDelete", () => {
    it("refuses to trash a series parent while it still has live parts", async () => {
      prisma.books.findFirst.mockResolvedValue(baseBook);
      prisma.books.count.mockResolvedValue(12);

      await expect(service.softDelete("book-1", "user-1")).rejects.toThrow(/12 live part\(s\)/);
      expect(prisma.books.update).not.toHaveBeenCalled();
      expect(prisma.books.count).toHaveBeenCalledWith({ where: { parent_id: "book-1", deleted_at: null } });
    });

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
