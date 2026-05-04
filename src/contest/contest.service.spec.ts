import { ConflictException, NotFoundException } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { ContestService } from "./contest.service";
import { PrismaService } from "../prisma/prisma.service";

const ATTEMPT_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

const mockQuestions = [
  {
    id: "1",
    question: "Q1",
    option_a: "A",
    option_b: "B",
    option_c: "C",
    option_d: "D",
    correct_answer: "C",
  },
  {
    id: "2",
    question: "Q2",
    option_a: "A",
    option_b: "B",
    option_c: "C",
    option_d: "D",
    correct_answer: "C",
  },
];

describe("ContestService", () => {
  let service: ContestService;
  let prisma: any;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContestService,
        {
          provide: PrismaService,
          useValue: {
            $queryRaw: jest.fn(),
            $transaction: jest.fn((fn) => fn({ $executeRaw: jest.fn().mockResolvedValue(undefined) })),
            $executeRaw: jest.fn(),
            qutuf_sajjadiya_contest_answers: {
              createMany: jest.fn().mockResolvedValue({ count: 2 }),
            },
            audit_logs: {
              create: jest.fn().mockResolvedValue({}),
            },
          },
        },
      ],
    }).compile();

    service = module.get(ContestService);
    prisma = module.get(PrismaService);
  });

  afterEach(() => jest.clearAllMocks());

  /* ---------------- LIST QUESTIONS ---------------- */

  describe("listQuestions", () => {
    it("returns questions without correct_answer", async () => {
      const publicQuestions = mockQuestions.map(
        ({ correct_answer, ...q }) => q,
      );
      prisma.$queryRaw.mockResolvedValueOnce(publicQuestions);

      const result = await service.listQuestions();

      expect(result.data.length).toBe(2);
      expect(Object.keys(result.data[0])).not.toContain("correct_answer");
    });
  });

  /* ---------------- START ---------------- */

  describe("start", () => {
    it("creates attempt with phone", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([{ id: ATTEMPT_ID }]);

      const result = await service.start(
        { name: "Ahmad", contact: "+9647001234567", contactType: "phone" },
        "127.0.0.1",
        "TestAgent",
      );

      expect(result.data.attempt_id).toBe(ATTEMPT_ID);
    });

    it("creates attempt with email", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([{ id: ATTEMPT_ID }]);

      const result = await service.start(
        { name: "Ahmad", contact: "test@mail.com", contactType: "email" },
        "127.0.0.1",
        "TestAgent",
      );

      expect(result.data.attempt_id).toBe(ATTEMPT_ID);
    });
  });

  /* ---------------- SUBMIT ---------------- */

  describe("submit", () => {
    it("throws NotFoundException if attempt does not exist", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([]);

      await expect(
        service.submit({
          attempt_id: ATTEMPT_ID,
          answers: [],
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it("throws ConflictException if already submitted", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([
        { id: ATTEMPT_ID, final_score: 10 },
      ]);

      await expect(
        service.submit({
          attempt_id: ATTEMPT_ID,
          answers: [],
        }),
      ).rejects.toThrow(ConflictException);
    });

    it("calculates partial score correctly (no strict validation here)", async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([{ id: ATTEMPT_ID, final_score: null }])
        .mockResolvedValueOnce(mockQuestions);

      const result = await service.submit({
        attempt_id: ATTEMPT_ID,
        answers: [
          { question_id: "1", answer: "C" },
          { question_id: "2", answer: "A" },
        ],
      });

      expect(result.data.final_score).toBe(1);
      expect(result.data.total_questions).toBe(2);
    });

    it("returns zero score when all answers are wrong", async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([{ id: ATTEMPT_ID, final_score: null }])
        .mockResolvedValueOnce(mockQuestions);

      const result = await service.submit({
        attempt_id: ATTEMPT_ID,
        answers: [
          { question_id: "1", answer: "A" },
          { question_id: "2", answer: "B" },
        ],
      });

      expect(result.data.final_score).toBe(0);
    });

    it("returns perfect score when all answers are correct", async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([{ id: ATTEMPT_ID, final_score: null }])
        .mockResolvedValueOnce(mockQuestions);

      const result = await service.submit({
        attempt_id: ATTEMPT_ID,
        answers: [
          { question_id: "1", answer: "C" },
          { question_id: "2", answer: "C" },
        ],
      });

      expect(result.data.final_score).toBe(2);
    });
  });
});
