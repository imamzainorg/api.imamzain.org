import { Test, TestingModule } from "@nestjs/testing";
import { ConflictException, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PostCategoriesService } from "./post-categories.service";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../common/audit/audit.service";
import { setActiveLanguages } from "../common/utils/translation.util";

const baseCategory = { id: "cat-1", deleted_at: null };

describe("PostCategoriesService", () => {
  let service: PostCategoriesService;
  let prisma: any;

  const mockTx = {
    post_categories: { create: jest.fn(), update: jest.fn().mockResolvedValue({}) },
    post_category_translations: {
      createMany: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({}),
      findFirst: jest.fn().mockResolvedValue(null),
    },
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
              count: jest.fn().mockResolvedValue(0),
            },
            post_category_translations: {
              upsert: jest.fn().mockResolvedValue({}),
              findFirst: jest.fn().mockResolvedValue(null),
            },
            posts: { count: jest.fn() },
            audit_logs: { create: jest.fn().mockResolvedValue({}) },
            $transaction: jest.fn(),
          },
        },
        { provide: AuditService, useValue: { write: jest.fn().mockResolvedValue(true) } },
      ],
    }).compile();

    service = module.get<PostCategoriesService>(PostCategoriesService);
    prisma = module.get(PrismaService);
  });

  afterEach(() => jest.clearAllMocks());

  describe("findAll", () => {
    it("resolves translation to requested lang when present", async () => {
      const category = {
        ...baseCategory,
        post_category_translations: [
          { lang: "ar", title: "فئة", slug: "fia" },
          { lang: "en", title: "Category", slug: "cat" },
        ],
      };
      prisma.post_categories.findMany.mockResolvedValue([category]);

      const result = await service.findAll("ar", 1, 10);

      expect(prisma.post_categories.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          include: { post_category_translations: true },
          orderBy: [{ created_at: "desc" }, { id: "asc" }],
        }),
      );
      expect(result.data.items[0]!.translation!.lang).toBe("ar");
    });

    it("falls back to first translation when requested lang is missing", async () => {
      const category = {
        ...baseCategory,
        post_category_translations: [{ lang: "en", title: "Category", slug: "cat" }],
      };
      prisma.post_categories.findMany.mockResolvedValue([category]);

      const result = await service.findAll("fr", 1, 10);

      expect(result.data.items[0]!.translation!.lang).toBe("en");
    });

    it("loads all translations and orders deterministically", async () => {
      prisma.post_categories.findMany.mockResolvedValue([
        { ...baseCategory, post_category_translations: [] },
      ]);

      await service.findAll(null, 1, 10);

      expect(prisma.post_categories.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          include: { post_category_translations: true },
          orderBy: [{ created_at: "desc" }, { id: "asc" }],
        }),
      );
    });

    it("only queries non-deleted categories", async () => {
      prisma.post_categories.findMany.mockResolvedValue([]);

      await service.findAll(null, 1, 10);

      expect(prisma.post_categories.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { deleted_at: null } }),
      );
    });
  });

  describe("findOne", () => {
    it("returns category with resolved translation in requested lang", async () => {
      const category = {
        ...baseCategory,
        post_category_translations: [
          { lang: "ar", title: "فئة", slug: "fia" },
          { lang: "en", title: "Category", slug: "cat" },
        ],
      };
      prisma.post_categories.findFirst.mockResolvedValue(category);

      const result = await service.findOne("cat-1", "en");

      expect(prisma.post_categories.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "cat-1", deleted_at: null },
          include: { post_category_translations: true },
        }),
      );
      expect(result.data.id).toBe("cat-1");
      expect(result.data.translation!.lang).toBe("en");
    });

    it("falls back to first translation when requested lang is missing", async () => {
      const category = {
        ...baseCategory,
        post_category_translations: [{ lang: "ar", title: "فئة", slug: "fia" }],
      };
      prisma.post_categories.findFirst.mockResolvedValue(category);

      const result = await service.findOne("cat-1", "fr");

      expect(result.data.translation!.lang).toBe("ar");
    });

    it("throws NotFoundException when not found", async () => {
      prisma.post_categories.findFirst.mockResolvedValue(null);

      await expect(service.findOne("ghost", null)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe("create", () => {
    it("creates category with translations and returns hydrated detail", async () => {
      mockTx.post_categories.create.mockResolvedValue(baseCategory);
      mockTx.post_category_translations.createMany.mockResolvedValue({});
      prisma.$transaction.mockImplementation((cb: any) => cb(mockTx));
      // findOne hydration after audit write.
      prisma.post_categories.findFirst.mockResolvedValue({
        ...baseCategory,
        post_category_translations: [{ lang: "ar", title: "فئة", slug: "fia" }],
      });

      const result = await service.create(
        { translations: [{ lang: "ar", title: "فئة", slug: "fia" }] },
        "actor-1",
      );

      // The translation write is where a bug would actually corrupt data —
      // check the exact row, not just "createMany was called somehow".
      expect(mockTx.post_category_translations.createMany).toHaveBeenCalledWith({
        data: [{ category_id: "cat-1", lang: "ar", title: "فئة", slug: "fia", description: null }],
      });
      expect(result.data.id).toBe("cat-1");
      expect(result.data.post_category_translations).toHaveLength(1);
      expect(result.data.translation).toBeDefined();
    });
  });

  describe("update", () => {
    it("upserts translations for existing category", async () => {
      prisma.post_categories.findFirst.mockResolvedValue(baseCategory);

      const result = await service.update(
        "cat-1",
        { translations: [{ lang: "ar", title: "فئة", slug: "fia" }] },
        "actor-1",
      );

      // The upsert's where/create/update payload is what actually decides
      // which row gets touched and what it ends up containing.
      expect(prisma.post_category_translations.upsert).toHaveBeenCalledWith({
        where: { category_id_lang: { category_id: "cat-1", lang: "ar" } },
        create: { category_id: "cat-1", lang: "ar", title: "فئة", slug: "fia", description: null },
        update: { title: "فئة", slug: "fia", description: null },
      });
      expect(result.message).toBe("Category updated");
    });

    it("throws NotFoundException when not found", async () => {
      prisma.post_categories.findFirst.mockResolvedValue(null);

      await expect(service.update("ghost", {}, "actor-1")).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe("softDelete", () => {
    it("deletes category when no posts reference it", async () => {
      prisma.post_categories.findFirst.mockResolvedValue(baseCategory);
      prisma.posts.count.mockResolvedValue(0);
      mockTx.post_category_translations.findMany.mockResolvedValue([]);
      prisma.$transaction.mockImplementation((cb: any) => cb(mockTx));

      const result = await service.softDelete("cat-1", "actor-1");

      expect(mockTx.post_categories.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { deleted_at: expect.any(Date) } }),
      );
      expect(result.message).toBe("Category deleted");
    });

    it("throws ConflictException when category has posts", async () => {
      prisma.post_categories.findFirst.mockResolvedValue(baseCategory);
      prisma.posts.count.mockResolvedValue(3);

      await expect(service.softDelete("cat-1", "actor-1")).rejects.toThrow(
        ConflictException,
      );
    });

    it("throws NotFoundException when not found", async () => {
      prisma.post_categories.findFirst.mockResolvedValue(null);

      await expect(service.softDelete("ghost", "actor-1")).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe("deterministic translation fallback (Q7)", () => {
    it("falls back to the site language whatever order the rows come back in", async () => {
      const make = (langs: string[]) => ({
        ...baseCategory,
        post_category_translations: langs.map((lang) => ({ lang, title: lang, slug: lang })),
      });
      prisma.post_categories.findMany.mockResolvedValue([make(["fa", "en", "ar"]), make(["ar", "fa", "en"])]);

      const result = await service.findAll("fr", 1, 10);

      expect(result.data.items.map((i: any) => i.translation.lang)).toEqual(["ar", "ar"]);
    });

    it("falls back to the lowest language code when the site language is absent", async () => {
      prisma.post_categories.findFirst.mockResolvedValue({
        ...baseCategory,
        post_category_translations: [
          { lang: "fa", title: "fa", slug: "fa" },
          { lang: "en", title: "en", slug: "en" },
        ],
      });

      const result = await service.findOne("cat-1", "fr");

      expect(result.data.translation!.lang).toBe("en");
    });
  });

  describe("retired languages (S24)", () => {
    const category = {
      ...baseCategory,
      post_category_translations: [
        { lang: "ar", title: "فئة", slug: "fia" },
        { lang: "fa", title: "دسته", slug: "daste" },
      ],
    };

    afterEach(() => setActiveLanguages(null));

    it("public reads never resolve a retired language", async () => {
      setActiveLanguages(["ar"]);
      prisma.post_categories.findMany.mockResolvedValue([category]);
      prisma.post_categories.findFirst.mockResolvedValue(category);

      const list = await service.findAll("fa", 1, 10);
      const one = await service.findOne("cat-1", "fa");

      expect(list.data.items[0]!.translation!.lang).toBe("ar");
      expect(one.data.translation!.lang).toBe("ar");
      // The raw rows stay listed so the CMS edit form can show every language.
      expect(one.data.post_category_translations).toHaveLength(2);
    });

    it("admin views (trash, and the hydrate after create / update) still resolve it", async () => {
      setActiveLanguages(["ar"]);
      prisma.post_categories.findMany.mockResolvedValue([
        { ...category, deleted_at: new Date(), post_category_translations: [{ lang: "fa", title: "دسته", slug: "daste" }] },
      ]);
      prisma.post_categories.count.mockResolvedValue(1);
      prisma.post_categories.findFirst.mockResolvedValue({ ...category, post_category_translations: [{ lang: "fa", title: "دسته", slug: "daste" }] });
      prisma.$transaction.mockImplementation((arg: any) => (typeof arg === "function" ? arg(mockTx) : Promise.resolve(arg)));
      mockTx.post_categories.create.mockResolvedValue(baseCategory);

      const trash = await service.findTrash(1, 10);
      const created = await service.create({ translations: [{ lang: "fa", title: "دسته", slug: "daste" }] }, "actor-1");
      const updated = await service.update("cat-1", { translations: [{ lang: "fa", title: "دسته", slug: "daste" }] }, "actor-1");

      expect(trash.data.items[0]!.translation!.lang).toBe("fa");
      expect(created.data.translation!.lang).toBe("fa");
      expect(updated.data.translation!.lang).toBe("fa");
    });
  });

  describe("unique-index conflicts (Q8)", () => {
    const p2002 = (target: unknown) =>
      new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
        code: "P2002",
        clientVersion: "test",
        meta: { target },
      });
    const input = [{ lang: "ar", title: "فئة", slug: "fia" }];

    async function conflictOf(promise: Promise<unknown>): Promise<ConflictException> {
      const err = await promise.then(
        () => null,
        (e) => e,
      );
      expect(err).toBeInstanceOf(ConflictException);
      return err as ConflictException;
    }

    beforeEach(() => {
      prisma.$transaction.mockImplementation((arg: any) => (typeof arg === "function" ? arg(mockTx) : Promise.resolve(arg)));
      mockTx.post_categories.create.mockResolvedValue(baseCategory);
    });

    it("create: a taken (lang, slug) names the slug and carries a stable code", async () => {
      mockTx.post_category_translations.createMany.mockRejectedValue(p2002(["lang", "slug"]));
      prisma.post_category_translations.findFirst.mockResolvedValue({ lang: "ar", slug: "fia" });

      const err = await conflictOf(service.create({ translations: input }, "actor-1"));

      expect(err.getResponse()).toEqual({
        message: 'Slug "fia" (ar) is already used by another category',
        code: "SLUG_ALREADY_USED",
      });
      // On create there is no category of its own to exclude from the lookup.
      expect(prisma.post_category_translations.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { OR: [{ lang: "ar", slug: "fia" }] } }),
      );
    });

    it("create: recognises the constraint-name form of the target", async () => {
      mockTx.post_category_translations.createMany.mockRejectedValue(p2002("post_category_translations_lang_slug_key"));

      const err = await conflictOf(service.create({ translations: input }, "actor-1"));

      // The lookup found nothing (race): the message still names the field.
      expect(err.getResponse()).toEqual({
        message: "A slug in this request is already used by another category in the same language",
        code: "SLUG_ALREADY_USED",
      });
    });

    it("create: the same language sent twice is a duplicate-language conflict, not a slug one", async () => {
      mockTx.post_category_translations.createMany.mockRejectedValue(p2002(["category_id", "lang"]));

      const err = await conflictOf(service.create({ translations: input }, "actor-1"));

      expect((err.getResponse() as any).code).toBe("DUPLICATE_TRANSLATION_LANG");
      expect(prisma.post_category_translations.findFirst).not.toHaveBeenCalled();
    });

    it("create: a P2002 on an unknown index and non-unique errors pass through untouched", async () => {
      const unknown = p2002(["something_else"]);
      mockTx.post_category_translations.createMany.mockRejectedValueOnce(unknown);
      await expect(service.create({ translations: input }, "actor-1")).rejects.toBe(unknown);

      const boom = new Error("connection lost");
      mockTx.post_category_translations.createMany.mockRejectedValueOnce(boom);
      await expect(service.create({ translations: input }, "actor-1")).rejects.toBe(boom);
    });

    it("update: a taken slug is reported, ignoring the category's own rows in the lookup", async () => {
      prisma.post_categories.findFirst.mockResolvedValue(baseCategory);
      prisma.$transaction.mockRejectedValue(p2002(["lang", "slug"]));
      prisma.post_category_translations.findFirst.mockResolvedValue({ lang: "ar", slug: "fia" });

      const err = await conflictOf(service.update("cat-1", { translations: input }, "actor-1"));

      expect((err.getResponse() as any).code).toBe("SLUG_ALREADY_USED");
      expect(prisma.post_category_translations.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { OR: [{ lang: "ar", slug: "fia" }], NOT: { category_id: "cat-1" } } }),
      );
    });
  });
});
