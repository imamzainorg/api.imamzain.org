import { Test, TestingModule } from "@nestjs/testing";
import { NotFoundException } from "@nestjs/common";
import { AcademicPaperCategoriesService } from "./academic-paper-categories.service";
import { PrismaService } from "../prisma/prisma.service";

const baseCategory = {
  id: "cat-1",
  deleted_at: null,
  academic_paper_category_translations: [],
};

describe("AcademicPaperCategoriesService", () => {
  let service: AcademicPaperCategoriesService;
  let prisma: any;

  const mockTx = {
    academic_paper_categories: { create: jest.fn() },
    academic_paper_category_translations: { createMany: jest.fn() },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AcademicPaperCategoriesService,
        {
          provide: PrismaService,
          useValue: {
            academic_paper_categories: {
              findMany: jest.fn(),
              findFirst: jest.fn(),
              update: jest.fn().mockResolvedValue({}),
            },
            academic_paper_category_translations: {
              upsert: jest.fn().mockResolvedValue({}),
            },
            audit_logs: { create: jest.fn().mockResolvedValue({}) },
            $transaction: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<AcademicPaperCategoriesService>(
      AcademicPaperCategoriesService,
    );
    prisma = module.get(PrismaService);
  });

  afterEach(() => jest.clearAllMocks());

  describe("findAll", () => {
    it("filters translations by lang when Accept-Language is set", async () => {
      const category = {
        ...baseCategory,
        academic_paper_category_translations: [
          { lang: "ar", title: "الفقه الإسلامي", slug: "fiqh-islami" },
        ],
      };
      prisma.academic_paper_categories.findMany.mockResolvedValue([category]);

      const result = await service.findAll("ar");

      expect(prisma.academic_paper_categories.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { deleted_at: null },
          include: {
            academic_paper_category_translations: { where: { lang: "ar" } },
          },
        }),
      );
      expect(result.data[0].academic_paper_category_translations[0].lang).toBe(
        "ar",
      );
    });

    it("returns all translations when no lang specified", async () => {
      prisma.academic_paper_categories.findMany.mockResolvedValue([
        baseCategory,
      ]);

      await service.findAll(null);

      expect(prisma.academic_paper_categories.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          include: { academic_paper_category_translations: true },
        }),
      );
    });

    it("only queries non-deleted categories", async () => {
      prisma.academic_paper_categories.findMany.mockResolvedValue([]);

      await service.findAll(null);

      expect(prisma.academic_paper_categories.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { deleted_at: null } }),
      );
    });
  });

  describe("findOne", () => {
    it("returns category with lang-filtered translations", async () => {
      const category = {
        ...baseCategory,
        academic_paper_category_translations: [
          {
            lang: "en",
            title: "Islamic Jurisprudence",
            slug: "islamic-jurisprudence",
          },
        ],
      };
      prisma.academic_paper_categories.findFirst.mockResolvedValue(category);

      const result = await service.findOne("cat-1", "en");

      expect(prisma.academic_paper_categories.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "cat-1", deleted_at: null },
          include: {
            academic_paper_category_translations: { where: { lang: "en" } },
          },
        }),
      );
      expect(result.data.id).toBe("cat-1");
      expect(result.data.academic_paper_category_translations[0].lang).toBe(
        "en",
      );
    });

    it("returns all translations when no lang specified", async () => {
      prisma.academic_paper_categories.findFirst.mockResolvedValue(
        baseCategory,
      );

      await service.findOne("cat-1", null);

      expect(prisma.academic_paper_categories.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          include: { academic_paper_category_translations: true },
        }),
      );
    });

    it("throws NotFoundException when not found", async () => {
      prisma.academic_paper_categories.findFirst.mockResolvedValue(null);

      await expect(service.findOne("ghost", null)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe("create", () => {
    it("creates category with translations in a transaction", async () => {
      mockTx.academic_paper_categories.create.mockResolvedValue(baseCategory);
      mockTx.academic_paper_category_translations.createMany.mockResolvedValue(
        {},
      );
      prisma.$transaction.mockImplementation((cb: any) => cb(mockTx));

      const result = await service.create(
        {
          translations: [
            { lang: "ar", title: "الفقه الإسلامي", slug: "fiqh-islami" },
          ],
        },
        "actor-1",
      );

      expect(mockTx.academic_paper_categories.create).toHaveBeenCalled();
      expect(
        mockTx.academic_paper_category_translations.createMany,
      ).toHaveBeenCalled();
      expect(result.data.id).toBe("cat-1");
    });
  });

  describe("update", () => {
    it("upserts translations for existing category", async () => {
      prisma.academic_paper_categories.findFirst.mockResolvedValue(
        baseCategory,
      );

      const result = await service.update(
        "cat-1",
        {
          translations: [
            { lang: "ar", title: "الفقه الإسلامي", slug: "fiqh-islami" },
          ],
        },
        "actor-1",
      );

      expect(
        prisma.academic_paper_category_translations.upsert,
      ).toHaveBeenCalled();
      expect(result.message).toBe("Category updated");
    });

    it("throws NotFoundException when not found", async () => {
      prisma.academic_paper_categories.findFirst.mockResolvedValue(null);

      await expect(service.update("ghost", {}, "actor-1")).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe("softDelete", () => {
    it("soft-deletes the category", async () => {
      prisma.academic_paper_categories.findFirst.mockResolvedValue(
        baseCategory,
      );

      const result = await service.softDelete("cat-1", "actor-1");

      expect(prisma.academic_paper_categories.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { deleted_at: expect.any(Date) } }),
      );
      expect(result.message).toBe("Category deleted");
    });

    it("throws NotFoundException when not found", async () => {
      prisma.academic_paper_categories.findFirst.mockResolvedValue(null);

      await expect(service.softDelete("ghost", "actor-1")).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
