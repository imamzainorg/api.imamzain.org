import { Test, TestingModule } from "@nestjs/testing";
import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PostsService } from "./posts.service";
import { ViewDedupService } from "./view-dedup.service";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../common/audit/audit.service";
import { PUBLIC_MEDIA_SELECT } from "../common/crud/media-selects";

const basePost = {
  id: "post-1",
  category_id: "cat-1",
  cover_image_id: null,
  slug: "unwaan",
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
      is_default: true,
    },
    {
      lang: "en",
      title: "Title",
      body: "Body",
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
  let viewDedup: any;

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
    viewDedup = {
      claim: jest.fn().mockResolvedValue(true),
      release: jest.fn().mockResolvedValue(undefined),
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
        { provide: ViewDedupService, useValue: viewDedup },
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

  describe("public vs admin detail shape (S23)", () => {
    it("public findOne selects explicit columns: no created_by, embedded media reduced to the public select", async () => {
      prisma.posts.findFirst.mockResolvedValue(basePost);

      await service.findOne("post-1", null, false);

      const args = prisma.posts.findFirst.mock.calls[0][0];
      expect(args.include).toBeUndefined();
      expect(args.select).toBeDefined();
      expect(args.select).not.toHaveProperty("created_by");
      expect(args.select.media).toEqual({ select: PUBLIC_MEDIA_SELECT });
      expect(args.select.post_attachments.select.media).toEqual({ select: PUBLIC_MEDIA_SELECT });
      expect(PUBLIC_MEDIA_SELECT).not.toHaveProperty("file_size");
      expect(PUBLIC_MEDIA_SELECT).not.toHaveProperty("uploaded_by");
    });

    it("public findBySlug uses the same column-listed shape", async () => {
      prisma.posts.findFirst.mockResolvedValue(basePost);

      await service.findBySlug("unwaan", null);

      const args = prisma.posts.findFirst.mock.calls[0][0];
      expect(args.include).toBeUndefined();
      expect(args.select).not.toHaveProperty("created_by");
      expect(args.select.media).toEqual({ select: PUBLIC_MEDIA_SELECT });
    });

    it("admin findOne keeps the full rows (include, whole media) so the CMS still sees created_by and file_size", async () => {
      prisma.posts.findFirst.mockResolvedValue(basePost);

      await service.findOne("post-1", null, true);

      const args = prisma.posts.findFirst.mock.calls[0][0];
      expect(args.select).toBeUndefined();
      expect(args.include.media.include).toBeDefined();
      expect(args.include.media.select).toBeUndefined();
      expect(args.include.post_attachments.include.media.include).toBeDefined();
    });

    it("passes whatever the query returned straight through, including created_by on the admin path", async () => {
      prisma.posts.findFirst.mockResolvedValue(basePost);

      const result = await service.findOne("post-1", null, true);

      expect(result.data).toMatchObject({ id: "post-1", created_by: "user-1" });
    });
  });

  describe("findBySlug", () => {
    it("returns post resolved from slug in a single query", async () => {
      prisma.posts.findFirst.mockResolvedValue(basePost);

      const result = await service.findBySlug("unwaan", "ar");

      expect(result.data.id).toBe("post-1");
      expect(prisma.posts.findFirst).toHaveBeenCalledTimes(1);
      expect(prisma.posts.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ slug: "unwaan", deleted_at: null, is_published: true }),
        }),
      );
    });

    it("throws NotFoundException when slug not found", async () => {
      prisma.posts.findFirst.mockResolvedValue(null);

      await expect(
        service.findBySlug("nonexistent-slug", null),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe("trackView", () => {
    it("uses a single conditional updateMany and returns the message on hit", async () => {
      prisma.posts.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.trackView("post-1", "203.0.113.7");

      expect(viewDedup.claim).toHaveBeenCalledWith("post", "post-1", "203.0.113.7");
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

    it("throws NotFoundException when no row matched, and gives the dedup claim back", async () => {
      prisma.posts.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.trackView("ghost", "203.0.113.7")).rejects.toThrow(NotFoundException);
      expect(viewDedup.release).toHaveBeenCalledWith("post", "ghost", "203.0.113.7");
    });

    it("gives the claim back when the update itself fails, so a retry still counts", async () => {
      prisma.posts.updateMany.mockRejectedValue(new Error("db down"));

      await expect(service.trackView("post-1", "203.0.113.7")).rejects.toThrow("db down");
      expect(viewDedup.release).toHaveBeenCalledWith("post", "post-1", "203.0.113.7");
    });

    it("a repeat inside the window answers with the same success response and does not increment", async () => {
      viewDedup.claim.mockResolvedValue(false);
      prisma.posts.count.mockResolvedValue(1);

      const result = await service.trackView("post-1", "203.0.113.7");

      expect(prisma.posts.updateMany).not.toHaveBeenCalled();
      expect(viewDedup.release).not.toHaveBeenCalled();
      expect(result).toEqual({ message: "View tracked", data: null });
    });

    it("a repeat still 404s when the post has since been unpublished or deleted", async () => {
      viewDedup.claim.mockResolvedValue(false);
      prisma.posts.count.mockResolvedValue(0);

      await expect(service.trackView("post-1", "203.0.113.7")).rejects.toThrow(NotFoundException);
      expect(prisma.posts.count).toHaveBeenCalledWith({
        where: expect.objectContaining({ id: "post-1", deleted_at: null, is_published: true }),
      });
    });
  });

  describe("create", () => {
    it("creates post with translations and returns hydrated detail", async () => {
      prisma.post_categories.findFirst.mockResolvedValue({ id: "cat-1" });
      const created = { id: "post-new" };
      mockTx.posts.create.mockResolvedValue(created);
      mockTx.post_translations.createMany.mockResolvedValue({});
      prisma.$transaction.mockImplementation((cb: any) => cb(mockTx));
      // First posts.findFirst call is the assertSlugAvailable pre-check (must
      // find nothing); the second is the post-transaction refetch with full
      // includes so the response carries translations + attachments — same
      // shape a GET /posts/:id would return.
      prisma.posts.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ ...basePost, id: "post-new" });

      const result = await service.create(
        {
          category_id: "cat-1",
          slug: "unwaan",
          translations: [
            {
              lang: "ar",
              title: "عنوان",
              body: "نص",
              is_default: true,
            },
          ],
        },
        "user-1",
        null,
      );

      // The actual row written, not just "create() ran somehow" — a mapping
      // bug (wrong dto field, missing default) would still pass a bare check.
      expect(mockTx.posts.create).toHaveBeenCalledWith({
        data: {
          category_id: "cat-1",
          cover_image_id: null,
          slug: "unwaan",
          is_published: false,
          is_featured: false,
          published_at: null,
          created_by: "user-1",
        },
      });
      expect(mockTx.post_translations.createMany).toHaveBeenCalledWith({
        data: [
          {
            post_id: "post-new",
            lang: "ar",
            title: "عنوان",
            summary: null,
            body: "نص",
            is_default: true,
            meta_title: null,
            meta_description: null,
            og_image_id: null,
          },
        ],
      });
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
            slug: "s",
            translations: [
              {
                lang: "ar",
                title: "t",
                body: "b",
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
            slug: "s",
            translations: [
              {
                lang: "ar",
                title: "t",
                body: "b",
                is_default: false,
              },
              {
                lang: "en",
                title: "t",
                body: "b",
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
            slug: "s",
            translations: [
              {
                lang: "ar",
                title: "t",
                body: "b",
                is_default: true,
              },
              {
                lang: "en",
                title: "t",
                body: "b",
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
            slug: "s",
            translations: [
              {
                lang: "ar",
                title: "t",
                body: "b",
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
      prisma.posts.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ ...basePost, id: "post-new" });

      await service.create(
        {
          category_id: "cat-1",
          slug: "s",
          is_published: true,
          translations: [
            { lang: "ar", title: "t", body: "b", is_default: true },
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
      prisma.posts.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ ...basePost, id: "post-new" });

      await service.create(
        {
          category_id: "cat-1",
          slug: "s",
          translations: [
            { lang: "ar", title: "t", body: "b", is_default: true },
          ],
        },
        "user-1",
        null,
      );

      const call = mockTx.posts.create.mock.calls[0][0];
      expect(call.data.is_published).toBe(false);
      expect(call.data.published_at).toBeNull();
    });

    async function createWith(fields: Record<string, unknown>) {
      prisma.post_categories.findFirst.mockResolvedValue({ id: "cat-1" });
      mockTx.posts.create.mockResolvedValue({ id: "post-new" });
      mockTx.post_translations.createMany.mockResolvedValue({});
      prisma.$transaction.mockImplementation((cb: any) => cb(mockTx));
      prisma.posts.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ ...basePost, id: "post-new" });

      await service.create(
        {
          category_id: "cat-1",
          slug: "s",
          translations: [{ lang: "ar", title: "t", body: "b", is_default: true }],
          ...fields,
        } as any,
        "user-1",
        null,
      );
      return mockTx.posts.create.mock.calls[0][0].data;
    }

    it("clamps a future published_at to now when the post is created already-published", async () => {
      const before = Date.now();
      const future = new Date(before + 7 * 86_400_000).toISOString();

      const data = await createWith({ is_published: true, published_at: future });

      expect(data.published_at.getTime()).toBeGreaterThanOrEqual(before);
      expect(data.published_at.getTime()).toBeLessThanOrEqual(Date.now());
    });

    it("keeps a future published_at on a draft — that is a schedule", async () => {
      const future = new Date(Date.now() + 7 * 86_400_000).toISOString();

      const data = await createWith({ is_published: false, published_at: future });

      expect(data.published_at).toEqual(new Date(future));
    });

    it("drops a past published_at on a draft so the publish cron cannot put it live", async () => {
      const data = await createWith({ is_published: false, published_at: "2020-01-01T00:00:00.000Z" });

      expect(data.is_published).toBe(false);
      expect(data.published_at).toBeNull();
    });

    it("keeps a past published_at on a post created already-published (backdating)", async () => {
      const data = await createWith({ is_published: true, published_at: "2020-01-01T00:00:00.000Z" });

      expect(data.published_at).toEqual(new Date("2020-01-01T00:00:00.000Z"));
    });
  });

  describe("og_image_id pre-check", () => {
    const translation = { lang: "ar", title: "t", body: "b", is_default: true, og_image_id: "og-1" };

    it("create answers 404 when an og_image_id matches no media row", async () => {
      prisma.post_categories.findFirst.mockResolvedValue({ id: "cat-1" });
      prisma.media.findMany.mockResolvedValue([]);

      await expect(
        service.create({ category_id: "cat-1", slug: "s", translations: [translation] } as any, "user-1", null),
      ).rejects.toThrow(new NotFoundException("One or more og_image_id values do not match any media record"));
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it("update answers 404 when an og_image_id matches no media row", async () => {
      prisma.posts.findFirst.mockResolvedValue({ ...basePost });
      prisma.media.findMany.mockResolvedValue([]);

      await expect(
        service.update("post-1", { translations: [translation] } as any, "user-1", null),
      ).rejects.toThrow(new NotFoundException("One or more og_image_id values do not match any media record"));
    });

    it("counts a repeated og_image_id once", async () => {
      prisma.post_categories.findFirst.mockResolvedValue({ id: "cat-1" });
      prisma.media.findMany.mockResolvedValue([{ id: "og-1" }]);
      prisma.posts.findFirst.mockResolvedValue(null);
      prisma.$transaction.mockRejectedValue(new Error("stop after the pre-check"));

      await expect(
        service.create(
          {
            category_id: "cat-1",
            slug: "s",
            translations: [translation, { ...translation, lang: "en", is_default: false }],
          } as any,
          "user-1",
          null,
        ),
      ).rejects.toThrow("stop after the pre-check");
    });
  });

  describe("unique violations (P2002) name the right collision", () => {
    const p2002 = (target: unknown) =>
      new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
        code: "P2002",
        clientVersion: "test",
        meta: { target },
      });

    async function createFailingWith(err: unknown) {
      prisma.post_categories.findFirst.mockResolvedValue({ id: "cat-1" });
      prisma.posts.findFirst.mockResolvedValue(null);
      prisma.$transaction.mockRejectedValue(err);
      return service
        .create(
          {
            category_id: "cat-1",
            slug: "my-slug",
            translations: [{ lang: "ar", title: "t", body: "b", is_default: true }],
          } as any,
          "user-1",
          null,
        )
        .then(
          () => {
            throw new Error("expected a rejection");
          },
          (e: unknown) => e as ConflictException,
        );
    }

    it.each([["the partial unique index name", "uq_posts_slug"], ["the column list", ["slug"]]])(
      "create reports a slug collision as the slug message (%s)",
      async (_label, target) => {
        const e = await createFailingWith(p2002(target));
        expect(e).toBeInstanceOf(ConflictException);
        expect(e.message).toBe('Slug "my-slug" is already used by another post');
      },
    );

    it("create does not blame the slug for a duplicated attachment key", async () => {
      const e = await createFailingWith(p2002(["post_id", "media_id"]));
      expect(e).toBeInstanceOf(ConflictException);
      expect(e.message).not.toMatch(/slug/i);
      expect(e.message).toMatch(/media file/);
    });

    it("create does not blame the slug for a duplicated translation language", async () => {
      const e = await createFailingWith(p2002("post_translations_pkey"));
      expect(e).toBeInstanceOf(ConflictException);
      expect(e.message).not.toMatch(/slug/i);
      expect(e.message).toMatch(/language/);
    });

    it("create gives an unknown unique violation a generic conflict message, never the slug one", async () => {
      const e = await createFailingWith(p2002(["something_else"]));
      expect(e).toBeInstanceOf(ConflictException);
      expect(e.message).not.toMatch(/slug/i);
    });

    it("create lets a non-P2002 error through untouched", async () => {
      const boom = new Error("connection lost");
      const e = await createFailingWith(boom);
      expect(e).toBe(boom);
    });

    it("update without a slug never says Slug \"undefined\"", async () => {
      prisma.posts.findFirst.mockResolvedValue({ ...basePost });
      prisma.$transaction.mockRejectedValue(p2002(["post_id", "media_id"]));

      const err: any = await service
        .update("post-1", { attachment_ids: ["m1"] } as any, "user-1", null)
        .catch((e) => e);

      expect(err).toBeInstanceOf(ConflictException);
      expect(err.message).not.toContain("undefined");
      expect(err.message).not.toMatch(/slug/i);
    });

    it("update reports a real slug collision with the slug it tried to set", async () => {
      prisma.posts.findFirst
        .mockResolvedValueOnce({ ...basePost, is_published: false, published_at: null })
        .mockResolvedValueOnce(null);
      prisma.$transaction.mockRejectedValue(p2002("uq_posts_slug"));

      const err: any = await service.update("post-1", { slug: "taken" }, "user-1", null).catch((e) => e);

      expect(err).toBeInstanceOf(ConflictException);
      expect(err.message).toBe('Slug "taken" is already used by another post');
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

    it("clears published_at when unpublishing so the scheduler cannot re-publish it", async () => {
      prisma.posts.findFirst.mockResolvedValue({
        ...basePost,
        is_published: true,
        published_at: new Date(),
      });
      prisma.$transaction.mockImplementation((cb: any) => cb(mockTx));

      await service.update("post-1", { is_published: false }, "user-1", null);

      const call = mockTx.posts.update.mock.calls[0][0];
      expect(call.data.is_published).toBe(false);
      expect(call.data.published_at).toBeNull();
    });

    it("keeps an explicit future published_at when unpublishing into a schedule", async () => {
      const future = new Date(Date.now() + 86_400_000).toISOString();
      prisma.posts.findFirst.mockResolvedValue({
        ...basePost,
        is_published: true,
        published_at: new Date(),
      });
      prisma.$transaction.mockImplementation((cb: any) => cb(mockTx));

      await service.update("post-1", { is_published: false, published_at: future }, "user-1", null);

      const call = mockTx.posts.update.mock.calls[0][0];
      expect(call.data.is_published).toBe(false);
      expect(call.data.published_at).toEqual(new Date(future));
    });

    it("leaves published_at untouched on an unrelated edit of a draft", async () => {
      prisma.posts.findFirst.mockResolvedValue({
        ...basePost,
        is_published: false,
        published_at: new Date(Date.now() + 86_400_000),
      });
      prisma.$transaction.mockImplementation((cb: any) => cb(mockTx));

      await service.update("post-1", { is_featured: true }, "user-1", null);

      const call = mockTx.posts.update.mock.calls[0][0];
      expect(call.data.published_at).toBeUndefined();
    });

    it("clears the stale date the CMS form re-sends when it unpublishes a live post", async () => {
      // The CMS edit form always submits is_published AND the stored
      // published_at. Storing that past date on an unpublished row is exactly
      // what the publish cron looks for — the post would be live again in a minute.
      const stored = new Date("2026-01-01T00:00:00.000Z");
      prisma.posts.findFirst.mockResolvedValue({ ...basePost, is_published: true, published_at: stored });
      prisma.$transaction.mockImplementation((cb: any) => cb(mockTx));

      await service.update("post-1", { is_published: false, published_at: stored.toISOString() }, "user-1", null);

      const call = mockTx.posts.update.mock.calls[0][0];
      expect(call.data.is_published).toBe(false);
      expect(call.data.published_at).toBeNull();
    });

    it("clamps published_at to now when a scheduled post is published early", async () => {
      const before = Date.now();
      prisma.posts.findFirst.mockResolvedValue({
        ...basePost,
        is_published: false,
        published_at: new Date(before + 7 * 86_400_000),
      });
      prisma.$transaction.mockImplementation((cb: any) => cb(mockTx));

      await service.update("post-1", { is_published: true }, "user-1", null);

      const at: Date = mockTx.posts.update.mock.calls[0][0].data.published_at;
      expect(at.getTime()).toBeGreaterThanOrEqual(before);
      expect(at.getTime()).toBeLessThanOrEqual(Date.now());
    });

    it("clamps a future published_at sent together with is_published: true", async () => {
      const before = Date.now();
      prisma.posts.findFirst.mockResolvedValue({ ...basePost, is_published: false, published_at: null });
      prisma.$transaction.mockImplementation((cb: any) => cb(mockTx));

      await service.update(
        "post-1",
        { is_published: true, published_at: new Date(before + 86_400_000).toISOString() },
        "user-1",
        null,
      );

      const at: Date = mockTx.posts.update.mock.calls[0][0].data.published_at;
      expect(at.getTime()).toBeLessThanOrEqual(Date.now());
    });

    it("does not cancel a due schedule when an unrelated edit lands before the cron tick", async () => {
      const due = new Date(Date.now() - 20_000);
      prisma.posts.findFirst.mockResolvedValue({ ...basePost, is_published: false, published_at: due });
      prisma.$transaction.mockImplementation((cb: any) => cb(mockTx));

      await service.update("post-1", { is_published: false, published_at: due.toISOString(), is_featured: true }, "user-1", null);

      expect(mockTx.posts.update.mock.calls[0][0].data.published_at).toBeUndefined();
    });
  });

  describe("update — slug of a published post", () => {
    it("refuses to rename the slug while the post stays published", async () => {
      prisma.posts.findFirst.mockResolvedValue({ ...basePost, is_published: true, slug: "unwaan" });

      await expect(service.update("post-1", { slug: "new-slug" }, "user-1", null)).rejects.toMatchObject({
        status: 409,
        response: expect.objectContaining({ code: "SLUG_LOCKED_WHILE_PUBLISHED" }),
      });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it("accepts the unchanged slug the CMS re-sends on every save", async () => {
      prisma.posts.findFirst
        .mockResolvedValueOnce({ ...basePost, is_published: true, slug: "unwaan" }) // load
        .mockResolvedValueOnce(null) // slug availability
        .mockResolvedValue({ ...basePost, is_published: true, slug: "unwaan" }); // hydrate
      prisma.$transaction.mockImplementation((cb: any) => cb(mockTx));

      await expect(service.update("post-1", { slug: "unwaan", is_featured: true }, "user-1", null)).resolves.toBeDefined();
    });

    it("allows the rename on a draft, and in the same request that unpublishes", async () => {
      prisma.$transaction.mockImplementation((cb: any) => cb(mockTx));

      prisma.posts.findFirst
        .mockResolvedValueOnce({ ...basePost, is_published: false, published_at: null, slug: "unwaan" })
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ ...basePost, slug: "new-slug" });
      await expect(service.update("post-1", { slug: "new-slug" }, "user-1", null)).resolves.toBeDefined();

      prisma.posts.findFirst
        .mockResolvedValueOnce({ ...basePost, is_published: true, slug: "unwaan" })
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ ...basePost, slug: "new-slug" });
      await expect(
        service.update("post-1", { slug: "new-slug", is_published: false }, "user-1", null),
      ).resolves.toBeDefined();
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

    it("keeps a past published_at when it publishes a draft that already carries one", async () => {
      const existingDate = new Date("2023-01-01");
      prisma.posts.findFirst.mockResolvedValue({
        ...basePost,
        is_published: false,
        published_at: existingDate,
      });

      await service.togglePublish("post-1", { is_published: true }, "user-1", null);

      const call = prisma.posts.update.mock.calls[0][0];
      expect(call.data.is_published).toBe(true);
      expect(call.data.published_at).toBeUndefined();
    });

    it("is a no-op when the post is already published: no write, no audit row, says so", async () => {
      prisma.posts.findFirst.mockResolvedValue({ ...basePost, is_published: true });

      const result = await service.togglePublish("post-1", { is_published: true }, "user-1", null);

      expect(prisma.posts.update).not.toHaveBeenCalled();
      expect(audit.write).not.toHaveBeenCalled();
      expect(result.message).toBe("Post already in requested state");
      expect(result.data.id).toBe("post-1");
    });

    it("is a no-op when the post is already unpublished — and leaves a schedule on it alone", async () => {
      const scheduled = new Date(Date.now() + 86_400_000);
      prisma.posts.findFirst.mockResolvedValue({ ...basePost, is_published: false, published_at: scheduled });

      const result = await service.togglePublish("post-1", { is_published: false }, "user-1", null);

      expect(prisma.posts.update).not.toHaveBeenCalled();
      expect(audit.write).not.toHaveBeenCalled();
      expect(result.message).toBe("Post already in requested state");
    });

    it("writes exactly one audit row per real transition", async () => {
      prisma.posts.findFirst.mockResolvedValue({ ...basePost, is_published: false, published_at: null });

      await service.togglePublish("post-1", { is_published: true }, "user-1", null);

      expect(audit.write).toHaveBeenCalledTimes(1);
      expect(audit.write).toHaveBeenCalledWith(
        expect.objectContaining({ actorId: "user-1", resourceId: "post-1", changes: expect.objectContaining({ is_published: true }) }),
      );
    });

    it("clamps published_at to now when a scheduled post is published early", async () => {
      const before = Date.now();
      prisma.posts.findFirst.mockResolvedValue({
        ...basePost,
        is_published: false,
        published_at: new Date(before + 7 * 86_400_000),
      });

      await service.togglePublish("post-1", { is_published: true }, "user-1", null);

      const at: Date = prisma.posts.update.mock.calls[0][0].data.published_at;
      expect(at.getTime()).toBeGreaterThanOrEqual(before);
      expect(at.getTime()).toBeLessThanOrEqual(Date.now());
    });

    it("unpublishes post and clears published_at so the scheduler cannot re-publish it", async () => {
      prisma.posts.findFirst.mockResolvedValue({ ...basePost, published_at: new Date("2023-01-01") });

      const result = await service.togglePublish(
        "post-1",
        { is_published: false },
        "user-1",
        null,
      );

      expect(prisma.posts.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ is_published: false, published_at: null }),
        }),
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
    it("sets deleted_at on the post and frees up its slug", async () => {
      prisma.posts.findFirst.mockResolvedValue(basePost);

      const result = await service.softDelete("post-1", "user-1");

      expect(prisma.posts.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            deleted_at: expect.any(Date),
            slug: expect.stringContaining("unwaan__del_"),
          }),
        }),
      );
      expect(result.message).toBe("Post deleted");
    });

    it("throws NotFoundException when post not found", async () => {
      prisma.posts.findFirst.mockResolvedValue(null);

      await expect(service.softDelete("ghost", "user-1")).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe("bulkSetPublish", () => {
    it("clears published_at on every post it unpublishes", async () => {
      prisma.posts.findMany.mockResolvedValue([
        { id: "post-1", is_published: true, published_at: new Date("2023-01-01") },
        { id: "post-2", is_published: false, published_at: null }, // already unpublished → skipped
      ]);
      prisma.$transaction.mockImplementation((cb: any) => cb(mockTx));

      const result = await service.bulkSetPublish({ ids: ["post-1", "post-2"], is_published: false }, "user-1");

      expect(mockTx.posts.updateMany).toHaveBeenCalledTimes(1);
      expect(mockTx.posts.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: { in: ["post-1"] } },
          data: expect.objectContaining({ is_published: false, published_at: null }),
        }),
      );
      expect(result.data).toEqual({ affected: 1, skipped: ["post-2"] });
    });

    it("stamps published_at only on posts that never had one when publishing", async () => {
      prisma.posts.findMany.mockResolvedValue([
        { id: "post-1", is_published: false, published_at: null },
        { id: "post-2", is_published: false, published_at: new Date("2023-01-01") },
      ]);
      prisma.$transaction.mockImplementation((cb: any) => cb(mockTx));

      await service.bulkSetPublish({ ids: ["post-1", "post-2"], is_published: true }, "user-1");

      const calls = mockTx.posts.updateMany.mock.calls.map((c: any[]) => c[0]);
      expect(calls).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ where: { id: { in: ["post-2"] } }, data: { is_published: true, updated_at: expect.any(Date) } }),
          expect.objectContaining({
            where: { id: { in: ["post-1"] } },
            data: expect.objectContaining({ is_published: true, published_at: expect.any(Date) }),
          }),
        ]),
      );
    });

    it("re-stamps a future-dated (scheduled) post when it is bulk-published early", async () => {
      prisma.posts.findMany.mockResolvedValue([
        { id: "post-1", is_published: false, published_at: new Date(Date.now() + 7 * 86_400_000) },
      ]);
      prisma.$transaction.mockImplementation((cb: any) => cb(mockTx));

      await service.bulkSetPublish({ ids: ["post-1"], is_published: true }, "user-1");

      expect(mockTx.posts.updateMany).toHaveBeenCalledTimes(1);
      const call = mockTx.posts.updateMany.mock.calls[0][0];
      expect(call.where).toEqual({ id: { in: ["post-1"] } });
      expect(call.data.published_at.getTime()).toBeLessThanOrEqual(Date.now());
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
