import { Test, TestingModule } from "@nestjs/testing";
import { ConflictException, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { GalleryService } from "./gallery.service";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../common/audit/audit.service";
import { PUBLIC_MEDIA_SELECT } from "../common/crud/media-selects";
import { setActiveLanguages } from "../common/utils/translation.util";

const baseImage = {
  media_id: "media-1",
  category_id: "cat-1",
  author: "Photographer",
  tags: ["shrine", "pilgrimage"],
  locations: ["Karbala"],
  taken_at: null,
  deleted_at: null,
  created_at: new Date(),
  gallery_image_translations: [
    { lang: "ar", title: "صورة", description: null, is_default: true },
    { lang: "en", title: "Photo", description: null, is_default: false },
  ],
  media: { id: "media-1", url: "https://cdn.example.com/photo.jpg" },
  gallery_categories: { gallery_category_translations: [] },
};

describe("GalleryService", () => {
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
              findUnique: jest.fn(),
              count: jest.fn(),
              update: jest.fn().mockResolvedValue({}),
            },
            media: { findUnique: jest.fn() },
            audit_logs: { create: jest.fn().mockResolvedValue({}) },
            $transaction: jest.fn(),
          },
        },
        { provide: AuditService, useValue: { write: jest.fn().mockResolvedValue(true) } },
      ],
    }).compile();

    service = module.get<GalleryService>(GalleryService);
    prisma = module.get(PrismaService);
  });

  afterEach(() => {
    jest.clearAllMocks();
    setActiveLanguages(null);
  });

  describe("findAll", () => {
    it("returns paginated images with resolved translation", async () => {
      prisma.gallery_images.findMany.mockResolvedValue([baseImage]);
      prisma.gallery_images.count.mockResolvedValue(1);

      const result = await service.findAll({}, "ar");

      expect(result.data.items[0]!.translation!.lang).toBe("ar");
    });

    it("filters by category_id when provided", async () => {
      prisma.gallery_images.findMany.mockResolvedValue([]);
      prisma.gallery_images.count.mockResolvedValue(0);

      await service.findAll({ category_id: "cat-1" }, null);

      expect(prisma.gallery_images.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ category_id: "cat-1" }),
        }),
      );
    });

    it("filters by tags when provided", async () => {
      prisma.gallery_images.findMany.mockResolvedValue([]);
      prisma.gallery_images.count.mockResolvedValue(0);

      await service.findAll({ tags: ["shrine"] }, null);

      expect(prisma.gallery_images.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ tags: { hasEvery: ["shrine"] } }),
        }),
      );
    });
  });

  describe("findOne", () => {
    it("uses media_id as PK to find image", async () => {
      prisma.gallery_images.findFirst.mockResolvedValue(baseImage);

      await service.findOne("media-1", "en");

      expect(prisma.gallery_images.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { media_id: "media-1", deleted_at: null, is_published: true },
        }),
      );
    });

    it("throws NotFoundException when not found", async () => {
      prisma.gallery_images.findFirst.mockResolvedValue(null);

      await expect(service.findOne("ghost", null)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe("create", () => {
    it("returns the created row even when it is a draft (hydrates with the admin flag)", async () => {
      prisma.media.findUnique.mockResolvedValue({ id: "media-1" });
      mockTx.gallery_images.create.mockResolvedValue({ ...baseImage, is_published: false });
      mockTx.gallery_image_translations.createMany.mockResolvedValue({});
      prisma.$transaction.mockImplementation((cb: any) => cb(mockTx));
      // A public-only hydrate (`is_published: true` in the where) finds nothing —
      // which used to turn a committed create into a 404.
      prisma.gallery_images.findFirst.mockImplementation(async (args: any) =>
        args?.where?.is_published === true ? null : { ...baseImage, is_published: false },
      );

      const result = await service.create(
        { media_id: "media-1", translations: [{ lang: "ar", title: "صورة" }] },
        "user-1",
        null,
      );

      expect(result.message).toBe("Gallery image created");
      const calls = prisma.gallery_images.findFirst.mock.calls;
      expect(calls[calls.length - 1][0].where.is_published).toBeUndefined();
    });

    it("creates image and returns hydrated detail", async () => {
      prisma.media.findUnique.mockResolvedValue({ id: "media-1" });
      mockTx.gallery_images.create.mockResolvedValue(baseImage);
      mockTx.gallery_image_translations.createMany.mockResolvedValue({});
      prisma.$transaction.mockImplementation((cb: any) => cb(mockTx));
      // After the transaction commits, create refetches with includes so the
      // response matches what GET /gallery/:id returns.
      prisma.gallery_images.findFirst.mockResolvedValue(baseImage);

      const result = await service.create(
        {
          media_id: "media-1",
          translations: [{ lang: "ar", title: "صورة" }],
        },
        "user-1",
        null,
      );

      expect(mockTx.gallery_images.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ media_id: "media-1" }),
        }),
      );
      expect(result.message).toBe("Gallery image created");
      expect(result.data.gallery_image_translations).toBeDefined();
      expect(result.data.translation).toBeDefined();
    });

    it("throws NotFoundException when media not found", async () => {
      prisma.media.findUnique.mockResolvedValue(null);

      await expect(
        service.create({ media_id: "bad", translations: [] }, "user-1", null),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe("update", () => {
    it("updates image and returns hydrated detail", async () => {
      // Default mock covers both the initial existence check and findOne's hydrate.
      prisma.gallery_images.findFirst.mockResolvedValue(baseImage);
      mockTx.gallery_images.update.mockResolvedValue({});
      prisma.$transaction.mockImplementation((cb: any) => cb(mockTx));

      const result = await service.update(
        "media-1",
        { author: "New Author" },
        "user-1",
        null,
      );

      expect(mockTx.gallery_images.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { media_id: "media-1" } }),
      );
      expect(result.message).toBe("Gallery image updated");
      expect(result.data.media_id).toBe("media-1");
    });

    it("throws NotFoundException when not found", async () => {
      prisma.gallery_images.findFirst.mockResolvedValue(null);

      await expect(service.update("ghost", {}, "user-1", null)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe("softDelete", () => {
    it("sets deleted_at using media_id", async () => {
      prisma.gallery_images.findFirst.mockResolvedValue(baseImage);

      const result = await service.softDelete("media-1", "user-1");

      expect(prisma.gallery_images.update).toHaveBeenCalledWith({
        where: { media_id: "media-1" },
        data: { deleted_at: expect.any(Date) },
      });
      expect(result.message).toBe("Gallery image deleted");
    });

    it("throws NotFoundException when not found", async () => {
      prisma.gallery_images.findFirst.mockResolvedValue(null);

      await expect(service.softDelete("ghost", "user-1")).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe("public vs admin detail shape (S23)", () => {
    it("the public read selects explicit columns: no added_by, slim media", async () => {
      prisma.gallery_images.findFirst.mockResolvedValue(baseImage);

      await service.findOne("media-1", "ar");

      const args = prisma.gallery_images.findFirst.mock.calls[0][0];
      expect(args.include).toBeUndefined();
      expect(args.select).toBeDefined();
      expect(args.select.added_by).toBeUndefined();
      expect(args.select.users).toBeUndefined();
      expect(args.select.media).toEqual({ select: PUBLIC_MEDIA_SELECT });
      expect(Object.keys(args.select.media.select)).not.toEqual(
        expect.arrayContaining(["file_size", "uploaded_by"]),
      );
      // Everything the public site rendered before is still selected.
      expect(args.select).toEqual(
        expect.objectContaining({
          media_id: true,
          category_id: true,
          taken_at: true,
          author: true,
          tags: true,
          locations: true,
          views: true,
          is_published: true,
          gallery_image_translations: expect.anything(),
          gallery_categories: expect.anything(),
        }),
      );
    });

    it("the admin read keeps the whole row and the full media row (the CMS uses them)", async () => {
      prisma.gallery_images.findFirst.mockResolvedValue(baseImage);

      await service.findOne("media-1", "ar", true);

      const args = prisma.gallery_images.findFirst.mock.calls[0][0];
      expect(args.select).toBeUndefined();
      expect(args.include.media.include).toEqual(expect.objectContaining({ media_variants: expect.anything() }));
      expect(args.where).toEqual({ media_id: "media-1", deleted_at: null });
    });

    it("hydrating after a write (create/update/publish) uses the admin shape", async () => {
      prisma.gallery_images.findFirst.mockResolvedValue(baseImage);
      mockTx.gallery_images.update.mockResolvedValue({});
      prisma.$transaction.mockImplementation((cb: any) => cb(mockTx));

      await service.update("media-1", { author: "New" }, "user-1", null);

      const calls = prisma.gallery_images.findFirst.mock.calls;
      expect(calls[calls.length - 1][0].include).toBeDefined();
      expect(calls[calls.length - 1][0].select).toBeUndefined();
    });
  });

  describe("translation resolution", () => {
    const rows = [
      { lang: "fa", title: "fa", description: null },
      { lang: "en", title: "en", description: null },
      { lang: "ar", title: "ar", description: null },
    ];

    it("is deterministic when no translation is flagged default (Q7)", async () => {
      prisma.gallery_images.findMany.mockResolvedValue([
        { ...baseImage, gallery_image_translations: rows },
        { ...baseImage, gallery_image_translations: [...rows].reverse() },
      ]);
      prisma.gallery_images.count.mockResolvedValue(2);

      const result = await service.findAll({}, "fr");

      expect(result.data.items.map((i: any) => i.translation.lang)).toEqual(["ar", "ar"]);
    });

    it("never serves a translation in a retired language (S24)", async () => {
      setActiveLanguages(["ar", "en"]);
      prisma.gallery_images.findFirst.mockResolvedValue({ ...baseImage, gallery_image_translations: rows });

      const result = await service.findOne("media-1", "fa");

      expect(result.data.translation!.lang).toBe("ar");
    });

    it("admin reads are unaffected by retired languages (the CMS still shows the title)", async () => {
      setActiveLanguages(["ar", "en"]);
      prisma.gallery_images.findFirst.mockResolvedValue({ ...baseImage, gallery_image_translations: rows });
      prisma.gallery_images.findMany.mockResolvedValue([{ ...baseImage, gallery_image_translations: rows }]);
      prisma.gallery_images.count.mockResolvedValue(1);

      const one = await service.findOne("media-1", "fa", true);
      const list = await service.findAll({}, "fa", true);
      const trash = await service.findTrash(1, 20);

      expect(one.data.translation!.lang).toBe("fa");
      expect(list.data.items[0]!.translation!.lang).toBe("fa");
      // Trash is an admin view with no language: the deterministic fallback, retired rows included.
      expect(trash.data.items[0]!.translation!.lang).toBe("ar");
    });
  });

  describe("create: unique-key conflicts (Q8)", () => {
    const p2002 = (target: unknown) =>
      new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
        code: "P2002",
        clientVersion: "test",
        meta: { target },
      });
    const dto = { media_id: "media-1", translations: [{ lang: "ar", title: "صورة" }] };

    async function conflictOf(promise: Promise<unknown>): Promise<ConflictException> {
      const err = await promise.then(
        () => null,
        (e) => e,
      );
      expect(err).toBeInstanceOf(ConflictException);
      return err as ConflictException;
    }

    beforeEach(() => {
      prisma.media.findUnique.mockResolvedValue({ id: "media-1" });
      prisma.$transaction.mockImplementation((cb: any) => cb(mockTx));
    });

    it("a media that is already in the gallery gets a specific message and code", async () => {
      mockTx.gallery_images.create.mockRejectedValue(p2002(["media_id"]));
      prisma.gallery_images.findUnique.mockResolvedValue({ deleted_at: null });

      const err = await conflictOf(service.create(dto, "user-1", null));

      expect((err.getResponse() as any).code).toBe("GALLERY_IMAGE_EXISTS");
      expect((err.getResponse() as any).message).toMatch(/already in the gallery/);
    });

    it("a media whose entry sits in the trash says so (the primary key is never freed)", async () => {
      mockTx.gallery_images.create.mockRejectedValue(p2002("gallery_images_pkey"));
      prisma.gallery_images.findUnique.mockResolvedValue({ deleted_at: new Date() });

      const err = await conflictOf(service.create(dto, "user-1", null));

      expect((err.getResponse() as any).code).toBe("GALLERY_IMAGE_IN_TRASH");
      expect((err.getResponse() as any).message).toMatch(/restore it/);
    });

    it("the same language sent twice is a duplicate-language conflict", async () => {
      mockTx.gallery_images.create.mockResolvedValue(baseImage);
      mockTx.gallery_image_translations.createMany.mockRejectedValue(p2002(["media_id", "lang"]));

      const err = await conflictOf(service.create(dto, "user-1", null));

      expect((err.getResponse() as any).code).toBe("DUPLICATE_TRANSLATION_LANG");
      expect(prisma.gallery_images.findUnique).not.toHaveBeenCalled();
    });

    it("errors that are not unique violations are not rewritten", async () => {
      const boom = new Error("connection lost");
      mockTx.gallery_images.create.mockRejectedValue(boom);

      await expect(service.create(dto, "user-1", null)).rejects.toBe(boom);
    });
  });
});
