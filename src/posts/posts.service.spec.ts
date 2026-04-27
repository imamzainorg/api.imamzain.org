import { Test, TestingModule } from "@nestjs/testing"
import { BadRequestException, NotFoundException } from "@nestjs/common"
import { PostsService } from "./posts.service"
import { PrismaService } from "../prisma/prisma.service"

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
}

describe("PostsService", () => {
	let service: PostsService
	let prisma: any

	const mockTx = {
		posts: { create: jest.fn(), update: jest.fn() },
		post_translations: { createMany: jest.fn(), upsert: jest.fn() },
		post_attachments: { createMany: jest.fn(), deleteMany: jest.fn() },
	}

	beforeEach(async () => {
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
						},
						post_translations: { findFirst: jest.fn() },
						post_categories: { findFirst: jest.fn() },
						media: { findUnique: jest.fn() },
						audit_logs: { create: jest.fn().mockResolvedValue({}) },
						$transaction: jest.fn(),
					},
				},
			],
		}).compile()

		service = module.get<PostsService>(PostsService)
		prisma = module.get(PrismaService)
	})

	afterEach(() => jest.clearAllMocks())

	describe("findAll", () => {
		it("returns only published posts for public view", async () => {
			prisma.posts.findMany.mockResolvedValue([basePost])
			prisma.posts.count.mockResolvedValue(1)

			await service.findAll({}, null, false)

			expect(prisma.posts.findMany).toHaveBeenCalledWith(
				expect.objectContaining({
					where: expect.objectContaining({ is_published: true }),
				}),
			)
		})

		it("returns all posts including unpublished for admin", async () => {
			prisma.posts.findMany.mockResolvedValue([basePost])
			prisma.posts.count.mockResolvedValue(1)

			await service.findAll({}, null, true)

			const call = prisma.posts.findMany.mock.calls[0][0]
			expect(call.where).not.toHaveProperty("is_published")
		})

		it("attaches resolved translation to each post", async () => {
			prisma.posts.findMany.mockResolvedValue([basePost])
			prisma.posts.count.mockResolvedValue(1)

			const result = await service.findAll({}, "ar", false)

			expect(result.data.items[0].translation.lang).toBe("ar")
		})

		it("falls back to default translation when lang not matched", async () => {
			prisma.posts.findMany.mockResolvedValue([basePost])
			prisma.posts.count.mockResolvedValue(1)

			const result = await service.findAll({}, "fr", false)

			expect(result.data.items[0].translation.is_default).toBe(true)
		})

		it("returns paginated result", async () => {
			prisma.posts.findMany.mockResolvedValue([basePost])
			prisma.posts.count.mockResolvedValue(25)

			const result = await service.findAll({ page: 2, limit: 10 }, null)

			expect(result.data.pagination).toEqual({
				page: 2,
				limit: 10,
				total: 25,
				pages: 3,
			})
		})
	})

	describe("findOne", () => {
		it("returns post with translation and fires view increment", async () => {
			prisma.posts.findFirst.mockResolvedValue(basePost)

			const result = await service.findOne("post-1", "ar")

			expect(result.data.id).toBe("post-1")
			expect(result.data.translation.lang).toBe("ar")
			expect(prisma.posts.update).toHaveBeenCalledWith(
				expect.objectContaining({ data: { views: { increment: 1 } } }),
			)
		})

		it("throws NotFoundException when post not found", async () => {
			prisma.posts.findFirst.mockResolvedValue(null)

			await expect(service.findOne("ghost", null)).rejects.toThrow(
				NotFoundException,
			)
		})
	})

	describe("findBySlug", () => {
		it("delegates to findOne after finding post_id from slug", async () => {
			prisma.post_translations.findFirst.mockResolvedValue({
				post_id: "post-1",
			})
			prisma.posts.findFirst.mockResolvedValue(basePost)

			const result = await service.findBySlug("unwaan", "ar")

			expect(result.data.id).toBe("post-1")
		})

		it("throws NotFoundException when slug not found", async () => {
			prisma.post_translations.findFirst.mockResolvedValue(null)

			await expect(
				service.findBySlug("nonexistent-slug", null),
			).rejects.toThrow(NotFoundException)
		})
	})

	describe("create", () => {
		it("creates post with translations inside a transaction", async () => {
			prisma.post_categories.findFirst.mockResolvedValue({ id: "cat-1" })
			const created = { id: "post-new" }
			mockTx.posts.create.mockResolvedValue(created)
			mockTx.post_translations.createMany.mockResolvedValue({})
			prisma.$transaction.mockImplementation((cb) => cb(mockTx))

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
			)

			expect(mockTx.posts.create).toHaveBeenCalled()
			expect(mockTx.post_translations.createMany).toHaveBeenCalled()
			expect(result.data.id).toBe("post-new")
		})

		it("throws NotFoundException when category not found", async () => {
			prisma.post_categories.findFirst.mockResolvedValue(null)

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
				),
			).rejects.toThrow(NotFoundException)
		})

		it("throws BadRequestException when no default translation", async () => {
			prisma.post_categories.findFirst.mockResolvedValue({ id: "cat-1" })

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
				),
			).rejects.toThrow(BadRequestException)
		})

		it("throws BadRequestException when more than one default translation", async () => {
			prisma.post_categories.findFirst.mockResolvedValue({ id: "cat-1" })

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
				),
			).rejects.toThrow(BadRequestException)
		})

		it("throws NotFoundException when cover_image_id not found", async () => {
			prisma.post_categories.findFirst.mockResolvedValue({ id: "cat-1" })
			prisma.media.findUnique.mockResolvedValue(null)

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
				),
			).rejects.toThrow(NotFoundException)
		})
	})

	describe("togglePublish", () => {
		it("publishes post and sets published_at when not previously set", async () => {
			prisma.posts.findFirst.mockResolvedValue({
				...basePost,
				is_published: false,
				published_at: null,
			})

			const result = await service.togglePublish(
				"post-1",
				{ is_published: true },
				"user-1",
			)

			expect(prisma.posts.update).toHaveBeenCalledWith(
				expect.objectContaining({
					data: expect.objectContaining({
						is_published: true,
						published_at: expect.any(Date),
					}),
				}),
			)
			expect(result.message).toBe("Post published")
		})

		it("does not overwrite existing published_at when re-publishing", async () => {
			const existingDate = new Date("2023-01-01")
			prisma.posts.findFirst.mockResolvedValue({
				...basePost,
				published_at: existingDate,
			})

			await service.togglePublish(
				"post-1",
				{ is_published: true },
				"user-1",
			)

			const call = prisma.posts.update.mock.calls[0][0]
			expect(call.data.published_at).toBeUndefined()
		})

		it("unpublishes post", async () => {
			prisma.posts.findFirst.mockResolvedValue(basePost)

			const result = await service.togglePublish(
				"post-1",
				{ is_published: false },
				"user-1",
			)

			expect(result.message).toBe("Post unpublished")
		})

		it("throws NotFoundException when post not found", async () => {
			prisma.posts.findFirst.mockResolvedValue(null)

			await expect(
				service.togglePublish(
					"ghost",
					{ is_published: true },
					"user-1",
				),
			).rejects.toThrow(NotFoundException)
		})
	})

	describe("softDelete", () => {
		it("sets deleted_at on the post", async () => {
			prisma.posts.findFirst.mockResolvedValue(basePost)

			const result = await service.softDelete("post-1", "user-1")

			expect(prisma.posts.update).toHaveBeenCalledWith(
				expect.objectContaining({
					data: { deleted_at: expect.any(Date) },
				}),
			)
			expect(result.message).toBe("Post deleted")
		})

		it("throws NotFoundException when post not found", async () => {
			prisma.posts.findFirst.mockResolvedValue(null)

			await expect(service.softDelete("ghost", "user-1")).rejects.toThrow(
				NotFoundException,
			)
		})
	})
})
