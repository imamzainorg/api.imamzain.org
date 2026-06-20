import { Test, TestingModule } from "@nestjs/testing";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { PostsService } from "./posts.service";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../common/audit/audit.service";

const basePost = {
  id: "post-1",
  category_id: "cat-1",
  cover_image_id: null,
  is_published: true,
  published_at: new Date(),
  views: 10,
  created_by: "user-1",
  created_at: new Date(),
  updated_at: new Date(),
  deleted_at: null,
  post_translations: [
    {
      lang: "ar",
      title: "عنوان",
      body: "محتوى",
      slug: "unwaan",
      is_default: true,
    },
    {
      lang: "en",
      title: "Title",
      body: "Body",
      slug: "title",
      is_default: false,
    },
  ],
  post_categories: { post_category_translations: [] },
  media: null,
  post_attachments: [],
};

describe("PostsService", () => {
  let service: PostsService;
  let prisma: any;
  let audit: any;

  const mockTx = {
    posts: { create: jest.fn(), update: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    post_translations: {
      createMany: jest.fn(),
      upsert: jest.fn(),
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({}),
      count: jest.fn().mockResolvedValue(1),
    },
    post_attachments: { createMany: jest.fn(), deleteMany: jest.fn() },
    $executeRaw: jest.fn().mockResolvedValue(1),
  };

  beforeEach(async () => {
    audit = {
      write: jest.fn().mockResolvedValue(true),
      writeMany: jest.fn().mockResolvedValue(true),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PostsService,
        {
          provide: PrismaService,
          useValue: {
            posts: {
              findMany: jest.fn(),
              findFirst: jest.fn(),
              count: jest.fn(),
              update: jest.fn().mockResolvedValue({}),
              updateMany: jest.fn().mockResolvedValue({ count: 1 }),
            },
            post_translations: {
              findFirst: jest.fn(),
              findMany: jest.fn().mockResolvedValue([]),
            },
            post_categories: { findFirst: jest.fn() },
            media: {
              findUnique: jest.fn(),
              findMany: jest.fn().mockResolvedValue([]),
            },
            audit_logs: { create: jest.fn().mockResolvedValue({}) },
            // Default handles the callback form (with the advisory-lock SELECT)
            // used by withAdvisoryLock to gate the runScheduledPublish cron.
            // create/restore tests override this with their own mockTx.
            $transaction: jest.fn((arg: any) =>
              typeof arg === 'function'
                ? arg({ $queryRaw: jest.fn().mockResolvedValue([{ locked: true }]) })
                : Promise.all(arg),
            ),
          },
        },
        { provide: AuditService, useValue: audit },
      ],
    }).compile();

    service = module.get<PostsService>(PostsService);
    prisma = module.get(PrismaService);
  });

  afterEach(() => jest.clearAllMocks());

  describe("findAll", () => {
    it("returns only published posts for public view", async () => {
      prisma.posts.findMany.mockResolvedValue([basePost]);
      prisma.posts.count.mockResolvedValue(1);

      await service.findAll({}, null, false);

      expect(prisma.posts.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ is_published: true }),
        }),
      );
    });

    it("returns all posts including unpublished for admin", async () => {
      prisma.posts.findMany.mockResolvedValue([basePost]);
      prisma.posts.count.mockResolvedValue(1);

      await service.findAll({}, null, true);

      const call = prisma.posts.findMany.mock.calls[0][0];
      expect(call.where).not.toHaveProperty("is_published");
    });

    it("attaches resolved translation to each post", async () => {
      prisma.posts.findMany.mockResolvedValue([basePost]);
      prisma.posts.count.mockResolvedValue(1);

      const result = await service.findAll({}, "ar", false);

      expect(result.data.items[0]!.translation!.lang).toBe("ar");
    });

    it("falls back to default translation when lang not matched", async () => {
      prisma.posts.findMany.mockResolvedValue([basePost]);
      prisma.posts.count.mockResolvedValue(1);

      const result = await service.findAll({}, "fr", false);

      expect(result.data.items[0]!.translation!.is_default).toBe(true);
    });

    it("returns paginated result", async () => {
      prisma.posts.findMany.mockResolvedValue([basePost]);
      prisma.posts.count.mockResolvedValue(25);

      const result = await service.findAll({ page: 2, limit: 10 }, null);

      expect(result.data.pagination).toEqual({
        page: 2,
        limit: 10,
        total: 25,
        pages: 3,
      });
    });
  });

  describe("findOne", () => {
    it("returns post with translation and fires view increment", async () => {
      prisma.posts.findFirst.mockResolvedValue(basePost);

      const result = await service.findOne("post-1", "ar");

      expect(result.data.id).toBe("post-1");
      expect(result.data.translation!.lang).toBe("ar");
    });

    it("throws NotFoundException when post not found", async () => {
      prisma.posts.findFirst.mockResolvedValue(null);

      await expect(service.findOne("ghost", null)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe("findBySlug", () => {
    it("returns post resolved from slug in a single query", async () => {
      prisma.post_translations.findFirst.mockResolvedValue({
        post_id: "post-1",
        posts: basePost,
      });

      const result = await service.findBySlug("unwaan", "ar");

      expect(result.data.id).toBe("post-1");
      // findOne (a second posts.findFirst) must NOT fire — single query.
      expect(prisma.posts.findFirst).not.toHaveBeenCalled();
    });

    it("throws NotFoundException when slug not found", async () => {
      prisma.post_translations.findFirst.mockResolvedValue(null);

      await expect(
        service.findBySlug("nonexistent-slug", null),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe("trackView", () => {
    it("uses a single conditional updateMany and returns the message on hit", async () => {
      prisma.posts.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.trackView("post-1");

      expect(prisma.posts.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: "post-1",
            deleted_at: null,
            is_published: true,
          }),
          data: { views: { increment: 1 } },
        }),
      );
      expect(result.message).toBe("View tracked");
    });

    it("throws NotFoundException when no row matched", async () => {
      prisma.posts.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.trackView("ghost")).rejects.toThrow(NotFoundException);
    });
  });

  describe("create", () => {
    it("creates post with translations and returns hydrated detail", async () => {
      prisma.post_categories.findFirst.mockResolvedValue({ id: "cat-1" });
      const created = { id: "post-new" };
      mockTx.posts.create.mockResolvedValue(created);
      mockTx.post_translations.createMany.mockResolvedValue({});
      prisma.$transaction.mockImplementation((cb: any) => cb(mockTx));
      // After the transaction commits the service refetches the post with full
      // includes so the response carries translations + attachments — same shape
      // a GET /posts/:id would return.
      prisma.posts.findFirst.mockResolvedValue({ ...basePost, id: "post-new" });

      const result = await service.create(
        {
          category_id: "cat-1",
          translations: [
            {
              lang: "ar",
              title: "عنوان",
              body: "نص",
              slug: "unwaan",
              is_default: true,
            },
          ],
        },
        "user-1",
        null,
      );

      expect(mockTx.posts.create).toHaveBeenCalled();
      expect(mockTx.post_translations.createMany).toHaveBeenCalled();
      expect(result.data.id).toBe("post-new");
      expect(result.data.post_translations).toBeDefined();
      expect(result.data.translation).toBeDefined();
    });

    it("throws NotFoundException when category not found", async () => {
      prisma.post_categories.findFirst.mockResolvedValue(null);

      await expect(
        service.create(
          {
            category_id: "bad-cat",
            translations: [
              {
                lang: "ar",
                title: "t",
                body: "b",
                slug: "s",
                is_default: true,
              },
            ],
          },
          "user-1",
          null,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it("throws BadRequestException when no default translation", async () => {
      prisma.post_categories.findFirst.mockResolvedValue({ id: "cat-1" });

      await expect(
        service.create(
          {
            category_id: "cat-1",
            translations: [
              {
                lang: "ar",
                title: "t",
                body: "b",
                slug: "s",
                is_default: false,
              },
              {
                lang: "en",
                title: "t",
                body: "b",
                slug: "s",
                is_default: false,
              },
            ],
          },
          "user-1",
          null,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it("throws BadRequestException when more than one default translation", async () => {
      prisma.post_categories.findFirst.mockResolvedValue({ id: "cat-1" });

      await expect(
        service.create(
          {
            category_id: "cat-1",
            translations: [
              {
                lang: "ar",
                title: "t",
                body: "b",
                slug: "s",
                is_default: true,
              },
              {
                lang: "en",
                title: "t",
                body: "b",
                slug: "s",
                is_default: true,
              },
            ],
          },
          "user-1",
          null,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it("throws NotFoundException when cover_image_id not found", async () => {
      prisma.post_categories.findFirst.mockResolvedValue({ id: "cat-1" });
      prisma.media.findUnique.mockResolvedValue(null);

      await expect(
        service.create(
          {
            category_id: "cat-1",
            cover_image_id: "bad-media",
            translations: [
              {
                lang: "ar",
                title: "t",
                body: "b",
                slug: "s",
                is_default: true,
              },
            ],
          },
          "user-1",
          null,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it("stamps published_at when created already-published without a timestamp", async () => {
      prisma.post_categories.findFirst.mockResolvedValue({ id: "cat-1" });
      mockTx.posts.create.mockResolvedValue({ id: "post-new" });
      mockTx.post_translations.createMany.mockResolvedValue({});
      prisma.$transaction.mockImplementation((cb: any) => cb(mockTx));
      prisma.posts.findFirst.mockResolvedValue({ ...basePost, id: "post-new" });

      await service.create(
        {
          category_id: "cat-1",
          is_published: true,
          translations: [
            { lang: "ar", title: "t", body: "b", slug: "s", is_default: true },
          ],
        },
        "user-1",
        null,
      );

      const call = mockTx.posts.create.mock.calls[0][0];
      expect(call.data.is_published).toBe(true);
      expect(call.data.published_at).toBeInstanceOf(Date);
    });

    it("leaves published_at null for a draft", async () => {
      prisma.post_categories.findFirst.mockResolvedValue({ id: "cat-1" });
      mockTx.posts.create.mockResolvedValue({ id: "post-new" });
      mockTx.post_translations.createMany.mockResolvedValue({});
      prisma.$transaction.mockImplementation((cb: any) => cb(mockTx));
      prisma.posts.findFirst.mockResolvedValue({ ...basePost, id: "post-new" });

      await service.create(
        {
          category_id: "cat-1",
          translations: [
            { lang: "ar", title: "t", body: "b", slug: "s", is_default: true },
          ],
        },
        "user-1",
        null,
      );

      const call = mockTx.posts.create.mock.calls[0][0];
      expect(call.data.is_published).toBe(false);
      expect(call.data.published_at).toBeNull();
    });
  });

  describe("update — published_at stamping", () => {
    it("stamps published_at when publishing a draft that has no timestamp", async () => {
      prisma.posts.findFirst.mockResolvedValue({
        ...basePost,
        is_published: false,
        published_at: null,
      });
      prisma.$transaction.mockImplementation((cb: any) => cb(mockTx));

      await service.update("post-1", { is_published: true }, "user-1", null);

      const call = mockTx.posts.update.mock.calls[0][0];
      expect(call.data.is_published).toBe(true);
      expect(call.data.published_at).toBeInstanceOf(Date);
    });

    it("backfills published_at on an unrelated edit when a published post has none", async () => {
      prisma.posts.findFirst.mockResolvedValue({
        ...basePost,
        is_published: true,
        published_at: null,
      });
      prisma.$transaction.mockImplementation((cb: any) => cb(mockTx));

      await service.update("post-1", { is_featured: true }, "user-1", null);

      const call = mockTx.posts.update.mock.calls[0][0];
      expect(call.data.published_at).toBeInstanceOf(Date);
    });

    it("does not overwrite a valid existing published_at on an unrelated edit", async () => {
      const existing = new Date("2020-01-01T00:00:00.000Z");
      prisma.posts.findFirst.mockResolvedValue({
        ...basePost,
        is_published: true,
        published_at: existing,
      });
      prisma.$transaction.mockImplementation((cb: any) => cb(mockTx));

      await service.update("post-1", { is_featured: true }, "user-1", null);

      const call = mockTx.posts.update.mock.calls[0][0];
      expect(call.data.published_at).toBeUndefined();
    });

    it("does not stamp published_at when unpublishing", async () => {
      prisma.posts.findFirst.mockResolvedValue({
        ...basePost,
        is_published: true,
        published_at: new Date(),
      });
      prisma.$transaction.mockImplementation((cb: any) => cb(mockTx));

      await service.update("post-1", { is_published: false }, "user-1", null);

      const call = mockTx.posts.update.mock.calls[0][0];
      expect(call.data.is_published).toBe(false);
      expect(call.data.published_at).toBeUndefined();
    });
  });

  describe("togglePublish", () => {
    it("publishes post and sets published_at when not previously set", async () => {
      prisma.posts.findFirst.mockResolvedValue({
        ...basePost,
        is_published: false,
        published_at: null,
      });

      const result = await service.togglePublish(
        "post-1",
        { is_published: true },
        "user-1",
        null,
      );

      expect(prisma.posts.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            is_published: true,
            published_at: expect.any(Date),
          }),
        }),
      );
      expect(result.message).toBe("Post published");
    });

    it("does not overwrite existing published_at when re-publishing", async () => {
      const existingDate = new Date("2023-01-01");
      prisma.posts.findFirst.mockResolvedValue({
        ...basePost,
        published_at: existingDate,
      });

      await service.togglePublish("post-1", { is_published: true }, "user-1", null);

      const call = prisma.posts.update.mock.calls[0][0];
      expect(call.data.published_at).toBeUndefined();
    });

    it("unpublishes post", async () => {
      prisma.posts.findFirst.mockResolvedValue(basePost);

      const result = await service.togglePublish(
        "post-1",
        { is_published: false },
        "user-1",
        null,
      );

      expect(result.message).toBe("Post unpublished");
    });

    it("throws NotFoundException when post not found", async () => {
      prisma.posts.findFirst.mockResolvedValue(null);

      await expect(
        service.togglePublish("ghost", { is_published: true }, "user-1", null),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe("softDelete", () => {
    it("sets deleted_at on the post and frees up translation slugs", async () => {
      prisma.posts.findFirst.mockResolvedValue(basePost);
      prisma.$transaction.mockImplementation((cb: any) => cb(mockTx));

      const result = await service.softDelete("post-1", "user-1");

      expect(mockTx.posts.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ deleted_at: expect.any(Date) }),
        }),
      );
      // Slug suffixing is now a single raw UPDATE per softDelete call,
      // replacing the per-translation findMany + update loop.
      expect(mockTx.$executeRaw).toHaveBeenCalledTimes(1);
      expect(result.message).toBe("Post deleted");
    });

    it("throws NotFoundException when post not found", async () => {
      prisma.posts.findFirst.mockResolvedValue(null);

      await expect(service.softDelete("ghost", "user-1")).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe("runScheduledPublish", () => {
    it("does nothing when no posts are due", async () => {
      prisma.posts.findMany.mockResolvedValue([]);

      await service.runScheduledPublish();

      expect(prisma.posts.updateMany).not.toHaveBeenCalled();
      expect(audit.writeMany).not.toHaveBeenCalled();
    });

    it("flips is_published in one updateMany and batches the audit log", async () => {
      prisma.posts.findMany.mockResolvedValue([{ id: "post-1" }, { id: "post-2" }]);

      await service.runScheduledPublish();

      expect(prisma.posts.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            deleted_at: null,
            is_published: false,
            published_at: expect.objectContaining({ not: null, lte: expect.any(Date) }),
          }),
        }),
      );
      // One bulk update, one batched audit write — not N of each.
      expect(prisma.posts.updateMany).toHaveBeenCalledTimes(1);
      expect(prisma.posts.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: { in: ["post-1", "post-2"] } },
          data: expect.objectContaining({ is_published: true }),
        }),
      );
      expect(audit.writeMany).toHaveBeenCalledTimes(1);
      expect(audit.writeMany.mock.calls[0][0]).toHaveLength(2);
    });
  });
});
