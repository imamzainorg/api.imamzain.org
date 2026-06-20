import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { ContestService } from "./contest.service";
import { PrismaService } from "../prisma/prisma.service";

const ATTEMPT_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

const mockQuestions = [
  { id: "1", correct_answer: "C" },
  { id: "2", correct_answer: "C" },
];

describe("ContestService", () => {
  let service: ContestService;
  let prisma: any;
  let txQueryRaw: jest.Mock;
  let txExecuteRaw: jest.Mock;

  beforeEach(async () => {
    txQueryRaw = jest.fn();
    txExecuteRaw = jest.fn().mockResolvedValue(1);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContestService,
        {
          provide: PrismaService,
          useValue: {
            $queryRaw: jest.fn(),
            $transaction: jest.fn((fn) =>
              fn({ $queryRaw: txQueryRaw, $executeRaw: txExecuteRaw }),
            ),
            qutuf_sajjadiya_contest_attempts: {
              findFirst: jest.fn().mockResolvedValue(null),
              findMany: jest.fn(),
              count: jest.fn(),
            },
            audit_logs: { create: jest.fn().mockResolvedValue({}) },
          },
        },
      ],
    }).compile();

    service = module.get(ContestService);
    prisma = module.get(PrismaService);
  });

  afterEach(() => jest.clearAllMocks());

  describe("listQuestions", () => {
    it("returns questions without correct_answer", async () => {
      const publicQuestions = mockQuestions.map(({ correct_answer, ...q }) => q);
      prisma.$queryRaw.mockResolvedValueOnce(publicQuestions);

      const result = await service.listQuestions();

      expect(result.data.length).toBe(2);
      expect(Object.keys(result.data[0])).not.toContain("correct_answer");
    });
  });

  describe("start", () => {
    it("creates attempt with phone when no prior identity exists", async () => {
      prisma.qutuf_sajjadiya_contest_attempts.findFirst.mockResolvedValue(null);
      prisma.$queryRaw.mockResolvedValueOnce([{ id: ATTEMPT_ID }]);

      const result = await service.start(
        { name: "Ahmad", contact: "+9647801234567", contactType: "phone" },
        "127.0.0.1",
        "TestAgent",
      );

      expect(result.data.attempt_id).toBe(ATTEMPT_ID);
    });

    it("creates attempt with email when no prior identity exists", async () => {
      prisma.qutuf_sajjadiya_contest_attempts.findFirst.mockResolvedValue(null);
      prisma.$queryRaw.mockResolvedValueOnce([{ id: ATTEMPT_ID }]);

      const result = await service.start(
        { name: "Ahmad", contact: "test@mail.com", contactType: "email" },
        "127.0.0.1",
        "TestAgent",
      );

      expect(result.data.attempt_id).toBe(ATTEMPT_ID);
    });

    it("rejects malformed phone", async () => {
      await expect(
        service.start(
          { name: "Ahmad", contact: "not-a-phone-!!!", contactType: "phone" },
          "127.0.0.1",
          "agent",
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it("rejects malformed email", async () => {
      await expect(
        service.start(
          { name: "Ahmad", contact: "not-an-email", contactType: "email" },
          "127.0.0.1",
          "agent",
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it("rejects when the contact value already submitted as either phone or email", async () => {
      prisma.qutuf_sajjadiya_contest_attempts.findFirst.mockResolvedValue({ id: "existing" });

      await expect(
        service.start(
          { name: "Ahmad", contact: "+9647801234567", contactType: "phone" },
          "127.0.0.1",
          "agent",
        ),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe("submit", () => {
    function setUpHappyPath(attemptScore: number | null = null) {
      // Outer query for the question list.
      prisma.$queryRaw.mockResolvedValueOnce(mockQuestions);
      // Inner (in-transaction) query for the attempt row.
      txQueryRaw.mockResolvedValueOnce([{ id: ATTEMPT_ID, final_score: attemptScore }]);
    }

    it("throws ConflictException when answer count mismatches question count", async () => {
      prisma.$queryRaw.mockResolvedValueOnce(mockQuestions);

      await expect(
        service.submit({ attempt_id: ATTEMPT_ID, answers: [{ question_id: "1", answer: "C" }] }),
      ).rejects.toThrow(ConflictException);
    });

    it("throws NotFoundException if attempt does not exist", async () => {
      prisma.$queryRaw.mockResolvedValueOnce(mockQuestions);
      txQueryRaw.mockResolvedValueOnce([]);

      await expect(
        service.submit({
          attempt_id: ATTEMPT_ID,
          answers: [
            { question_id: "1", answer: "C" },
            { question_id: "2", answer: "C" },
          ],
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it("throws ConflictException if already submitted", async () => {
      prisma.$queryRaw.mockResolvedValueOnce(mockQuestions);
      txQueryRaw.mockResolvedValueOnce([{ id: ATTEMPT_ID, final_score: 5 }]);

      await expect(
        service.submit({
          attempt_id: ATTEMPT_ID,
          answers: [
            { question_id: "1", answer: "C" },
            { question_id: "2", answer: "C" },
          ],
        }),
      ).rejects.toThrow(ConflictException);
    });

    it("calculates partial score correctly", async () => {
      setUpHappyPath();

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
      setUpHappyPath();

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
      setUpHappyPath();

      const result = await service.submit({
        attempt_id: ATTEMPT_ID,
        answers: [
          { question_id: "1", answer: "C" },
          { question_id: "2", answer: "C" },
        ],
      });

      expect(result.data.final_score).toBe(2);
    });

    it("rejects an incomplete submission padded with duplicate question_ids", async () => {
      prisma.$queryRaw.mockResolvedValueOnce(mockQuestions);

      // Two entries for the same question leave question 2 unanswered. The
      // completeness gate now counts UNIQUE VALID answers, so this is rejected
      // instead of being finalized with a genuinely missing answer.
      await expect(
        service.submit({
          attempt_id: ATTEMPT_ID,
          answers: [
            { question_id: "1", answer: "C" },
            { question_id: "1", answer: "C" },
          ],
        }),
      ).rejects.toThrow(ConflictException);
    });

    it("counts a duplicated question only once in a complete submission", async () => {
      setUpHappyPath();

      // q1 appears twice (first occurrence wins) and q2 once — every question
      // is answered, so the submission is complete and the duplicate can't
      // inflate the score.
      const result = await service.submit({
        attempt_id: ATTEMPT_ID,
        answers: [
          { question_id: "1", answer: "C" },
          { question_id: "1", answer: "A" },
          { question_id: "2", answer: "A" },
        ],
      });

      expect(result.data.final_score).toBe(1); // q1 correct (first=C), q2 wrong
    });

    it("rejects when the conditional final_score UPDATE matches no rows", async () => {
      prisma.$queryRaw.mockResolvedValueOnce(mockQuestions);
      txQueryRaw.mockResolvedValueOnce([{ id: ATTEMPT_ID, final_score: null }]);
      txExecuteRaw.mockResolvedValueOnce(1).mockResolvedValueOnce(0);

      await expect(
        service.submit({
          attempt_id: ATTEMPT_ID,
          answers: [
            { question_id: "1", answer: "C" },
            { question_id: "2", answer: "C" },
          ],
        }),
      ).rejects.toThrow(ConflictException);
    });

    it("accepts a valid attempt_token", async () => {
      prisma.qutuf_sajjadiya_contest_attempts.findFirst.mockResolvedValue(null);
      prisma.$queryRaw.mockResolvedValueOnce([{ id: ATTEMPT_ID }]);
      const started = await service.start(
        { name: "Ahmad", contact: "+9647801234567", contactType: "phone" },
        "127.0.0.1",
        "TestAgent",
      );

      setUpHappyPath();
      const result = await service.submit({
        attempt_id: ATTEMPT_ID,
        attempt_token: started.data.attempt_token,
        answers: [
          { question_id: "1", answer: "C" },
          { question_id: "2", answer: "C" },
        ],
      });

      expect(result.data.final_score).toBe(2);
    });

    it("rejects an invalid attempt_token with 401", async () => {
      prisma.$queryRaw.mockResolvedValueOnce(mockQuestions);
      const { UnauthorizedException } = await import("@nestjs/common");

      await expect(
        service.submit({
          attempt_id: ATTEMPT_ID,
          attempt_token: "definitely-not-the-right-hmac",
          answers: [
            { question_id: "1", answer: "C" },
            { question_id: "2", answer: "C" },
          ],
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it("still accepts submissions without an attempt_token (backwards compatibility)", async () => {
      setUpHappyPath();

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
