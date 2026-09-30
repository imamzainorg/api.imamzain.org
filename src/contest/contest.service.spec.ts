import * as crypto from "crypto";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { ContestService } from "./contest.service";
import { PrismaService } from "../prisma/prisma.service";
import { deriveKey, KEY_INFO } from "../common/utils/derive-key.util";

// ContestService resolves its HMAC secret in a field initializer at construction
// time, so the secret must exist before the service is instantiated. CI has no
// .env — set a deterministic test secret here so the suite is independent of the
// ambient environment. (Don't clobber a real JWT_SECRET if one is present.)
if (!process.env.CONTEST_ATTEMPT_SECRET && !process.env.JWT_SECRET) {
  process.env.CONTEST_ATTEMPT_SECRET = "test-contest-secret";
}

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
            // Open by default so every test below this one that doesn't care about
            // the open/closed gate keeps exercising start()/submit() as before; the
            // dedicated 'contest open/closed' suite overrides this per test.
            site_settings: { findUnique: jest.fn().mockResolvedValue({ value: "true" }) },
            audit_logs: { create: jest.fn().mockResolvedValue({}) },
          },
        },
      ],
    }).compile();

    service = module.get(ContestService);
    prisma = module.get(PrismaService);
  });

  afterEach(() => {
    delete process.env.CONTEST_REVEAL_SCORE;
    jest.clearAllMocks();
  });

  describe("attempt-token secret", () => {
    const original = { own: process.env.CONTEST_ATTEMPT_SECRET, jwt: process.env.JWT_SECRET };
    afterEach(() => {
      if (original.own === undefined) delete process.env.CONTEST_ATTEMPT_SECRET;
      else process.env.CONTEST_ATTEMPT_SECRET = original.own;
      if (original.jwt === undefined) delete process.env.JWT_SECRET;
      else process.env.JWT_SECRET = original.jwt;
    });

    const tokenFrom = async (env: { own?: string; jwt?: string }) => {
      if (env.own === undefined) delete process.env.CONTEST_ATTEMPT_SECRET;
      else process.env.CONTEST_ATTEMPT_SECRET = env.own;
      if (env.jwt === undefined) delete process.env.JWT_SECRET;
      else process.env.JWT_SECRET = env.jwt;
      const fresh = new ContestService({
        qutuf_sajjadiya_contest_attempts: { findFirst: jest.fn().mockResolvedValue({ id: ATTEMPT_ID, submitted_at: null, final_score: null }) },
        site_settings: { findUnique: jest.fn().mockResolvedValue({ value: "true" }) },
      } as never);
      const result = await fresh.start({ name: "A", contact: "+9647801234567", contactType: "phone" }, "127.0.0.1", "agent");
      return result.data.attempt_token;
    };

    it("falls back to JWT_SECRET when CONTEST_ATTEMPT_SECRET is BLANK, as .env.example ships it", async () => {
      const blank = await tokenFrom({ own: "", jwt: "jwt-secret-for-fallback-0123456789" });
      const unset = await tokenFrom({ jwt: "jwt-secret-for-fallback-0123456789" });

      expect(blank).toBe(unset);
    });

    it("uses the dedicated secret when set", async () => {
      const dedicated = await tokenFrom({ own: "dedicated", jwt: "jwt-secret-for-fallback-0123456789" });
      const jwtOnly = await tokenFrom({ jwt: "jwt-secret-for-fallback-0123456789" });

      expect(dedicated).not.toBe(jwtOnly);
    });

    it("refuses to construct with no secret at all", () => {
      delete process.env.CONTEST_ATTEMPT_SECRET;
      delete process.env.JWT_SECRET;

      expect(() => new ContestService({} as never)).toThrow(/required/);
    });

    describe("when only JWT_SECRET is set (HKDF-derived key, legacy tokens still verify)", () => {
      const JWT = "jwt-secret-for-fallback-0123456789";
      const legacyToken = crypto.createHmac("sha256", JWT).update(ATTEMPT_ID).digest("hex");
      const derivedToken = crypto
        .createHmac("sha256", deriveKey(JWT, KEY_INFO.contestAttempt))
        .update(ATTEMPT_ID)
        .digest("hex");

      // A token that passes the check reaches the completeness gate (409, no
      // answers sent); one that fails is refused earlier with 401.
      const submitWith = async (env: { own?: string; jwt?: string }, attempt_token: string) => {
        if (env.own === undefined) delete process.env.CONTEST_ATTEMPT_SECRET;
        else process.env.CONTEST_ATTEMPT_SECRET = env.own;
        if (env.jwt === undefined) delete process.env.JWT_SECRET;
        else process.env.JWT_SECRET = env.jwt;
        const fresh = new ContestService({
          site_settings: { findUnique: jest.fn().mockResolvedValue({ value: "true" }) },
          $queryRaw: jest.fn().mockResolvedValue([{ id: "1", correct_answer: "C" }]),
        } as never);
        return fresh.submit({ attempt_id: ATTEMPT_ID, attempt_token, answers: [] }).catch((e) => e);
      };

      it("mints the HKDF-derived token, not the raw-JWT_SECRET one", async () => {
        const minted = await tokenFrom({ jwt: JWT });

        expect(minted).toBe(derivedToken);
        expect(minted).not.toBe(legacyToken);
      });

      it("accepts a token it minted itself", async () => {
        expect(await submitWith({ jwt: JWT }, derivedToken)).toBeInstanceOf(ConflictException);
      });

      it("still accepts a token minted with the raw JWT_SECRET before the change", async () => {
        expect(await submitWith({ jwt: JWT }, legacyToken)).toBeInstanceOf(ConflictException);
      });

      it("rejects a tampered token", async () => {
        const tampered = `${derivedToken.slice(0, -1)}${derivedToken.endsWith("0") ? "1" : "0"}`;

        expect(await submitWith({ jwt: JWT }, tampered)).toBeInstanceOf(UnauthorizedException);
      });

      it("rejects a token minted for another purpose from the same JWT_SECRET", async () => {
        const otherPurpose = crypto
          .createHmac("sha256", deriveKey(JWT, KEY_INFO.newsletterUnsubscribe))
          .update(ATTEMPT_ID)
          .digest("hex");

        expect(await submitWith({ jwt: JWT }, otherPurpose)).toBeInstanceOf(UnauthorizedException);
      });
    });

    describe("when CONTEST_ATTEMPT_SECRET is set (behaviour unchanged)", () => {
      const JWT = "jwt-secret-for-fallback-0123456789";

      it("signs with the dedicated secret itself, exactly as before", async () => {
        const minted = await tokenFrom({ own: "dedicated", jwt: JWT });

        expect(minted).toBe(crypto.createHmac("sha256", "dedicated").update(ATTEMPT_ID).digest("hex"));
      });

      it("does not fall back to JWT_SECRET-based tokens", async () => {
        process.env.CONTEST_ATTEMPT_SECRET = "dedicated";
        process.env.JWT_SECRET = JWT;
        const fresh = new ContestService({
          site_settings: { findUnique: jest.fn().mockResolvedValue({ value: "true" }) },
          $queryRaw: jest.fn().mockResolvedValue([{ id: "1", correct_answer: "C" }]),
        } as never);
        const legacy = crypto.createHmac("sha256", JWT).update(ATTEMPT_ID).digest("hex");

        const err = await fresh.submit({ attempt_id: ATTEMPT_ID, attempt_token: legacy, answers: [] }).catch((e) => e);

        expect(err).toBeInstanceOf(UnauthorizedException);
      });
    });
  });

  describe("contest open/closed", () => {
    const startDto = { name: "Ahmad", contact: "+9647801234567", contactType: "phone" as const };
    const submitDto = {
      attempt_id: ATTEMPT_ID,
      answers: [
        { question_id: "1", answer: "C" },
        { question_id: "2", answer: "C" },
      ],
    };

    it("start() is refused with 403 CONTEST_CLOSED when no site_settings row exists at all", async () => {
      prisma.site_settings.findUnique.mockResolvedValue(null);

      const err = await service.start(startDto, "127.0.0.1", "agent").catch((e) => e);

      expect(err).toBeInstanceOf(ForbiddenException);
      expect(err.getResponse()).toMatchObject({ code: "CONTEST_CLOSED" });
      // Fails before touching the attempts table at all.
      expect(prisma.qutuf_sajjadiya_contest_attempts.findFirst).not.toHaveBeenCalled();
    });

    it("start() is refused when the setting is explicitly \"false\"", async () => {
      prisma.site_settings.findUnique.mockResolvedValue({ value: "false" });

      await expect(service.start(startDto, "127.0.0.1", "agent")).rejects.toThrow(ForbiddenException);
    });

    it("start() is refused for any value other than the literal string \"true\" (fail closed on a typo)", async () => {
      prisma.site_settings.findUnique.mockResolvedValue({ value: "TRUE" });

      await expect(service.start(startDto, "127.0.0.1", "agent")).rejects.toThrow(ForbiddenException);
    });

    it("start() proceeds normally once the setting is \"true\"", async () => {
      prisma.site_settings.findUnique.mockResolvedValue({ value: "true" });
      prisma.$queryRaw.mockResolvedValueOnce([{ id: ATTEMPT_ID }]);

      const result = await service.start(startDto, "127.0.0.1", "agent");

      expect(result.data.attempt_id).toBe(ATTEMPT_ID);
    });

    it("submit() is refused with the same 403 before any token or answer processing", async () => {
      prisma.site_settings.findUnique.mockResolvedValue(null);

      const err = await service.submit(submitDto).catch((e) => e);

      expect(err).toBeInstanceOf(ForbiddenException);
      expect(err.getResponse()).toMatchObject({ code: "CONTEST_CLOSED" });
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it("submit() proceeds normally once the setting is \"true\"", async () => {
      prisma.site_settings.findUnique.mockResolvedValue({ value: "true" });
      prisma.$queryRaw.mockResolvedValueOnce(mockQuestions);
      txQueryRaw.mockResolvedValueOnce([{ id: ATTEMPT_ID, final_score: null }]);

      const result = await service.submit(submitDto);

      expect(result.data.final_score).toBe(2);
    });

    it("checks the setting on every call — it is not cached at construction time", async () => {
      prisma.site_settings.findUnique.mockResolvedValueOnce({ value: "true" }).mockResolvedValueOnce({ value: "false" });
      prisma.$queryRaw.mockResolvedValueOnce([{ id: "other-id" }]);

      await service.start({ ...startDto, contact: "+9647809999999" }, "127.0.0.1", "agent");
      await expect(service.start(startDto, "127.0.0.1", "agent")).rejects.toThrow(ForbiddenException);
    });
  });

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

    it("a NEW attempt reports resumed: false", async () => {
      prisma.qutuf_sajjadiya_contest_attempts.findFirst.mockResolvedValue(null);
      prisma.$queryRaw.mockResolvedValueOnce([{ id: ATTEMPT_ID }]);

      const result = await service.start(
        { name: "Ahmad", contact: "+9647801234567", contactType: "phone" },
        "127.0.0.1",
        "agent",
      );

      expect(result.data.resumed).toBe(false);
    });
  });

  describe("start — idempotent for an unsubmitted attempt", () => {
    const opened = { id: ATTEMPT_ID, submitted_at: null, final_score: null };
    const dto = { name: "Ahmad", contact: "+9647801234567", contactType: "phone" as const };

    it("hands back the SAME attempt instead of locking the participant out after a lost response", async () => {
      prisma.qutuf_sajjadiya_contest_attempts.findFirst.mockResolvedValue(opened);

      const result = await service.start(dto, "127.0.0.1", "agent");

      expect(result.message).toBe("Contest resumed");
      expect(result.data).toEqual({ attempt_id: ATTEMPT_ID, attempt_token: expect.any(String), resumed: true });
      // No second row: nothing was inserted.
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });

    it("returns the very token the first /start returned, and it verifies at /submit", async () => {
      prisma.qutuf_sajjadiya_contest_attempts.findFirst.mockResolvedValueOnce(null);
      prisma.$queryRaw.mockResolvedValueOnce([{ id: ATTEMPT_ID }]);
      const first = await service.start(dto, "127.0.0.1", "agent");

      prisma.qutuf_sajjadiya_contest_attempts.findFirst.mockResolvedValueOnce(opened);
      const again = await service.start(dto, "127.0.0.1", "agent");

      expect(again.data.attempt_token).toBe(first.data.attempt_token);

      prisma.$queryRaw.mockResolvedValueOnce(mockQuestions);
      txQueryRaw.mockResolvedValueOnce([{ id: ATTEMPT_ID, final_score: null }]);
      const submitted = await service.submit({
        attempt_id: ATTEMPT_ID,
        attempt_token: again.data.attempt_token,
        answers: [
          { question_id: "1", answer: "C" },
          { question_id: "2", answer: "C" },
        ],
      });
      expect(submitted.data.final_score).toBe(2);
    });

    it.each([
      ["submitted_at is set", { id: ATTEMPT_ID, submitted_at: new Date(), final_score: null }],
      ["final_score is set", { id: ATTEMPT_ID, submitted_at: null, final_score: 0 }],
      ["the row carries neither field", { id: ATTEMPT_ID }],
    ])("still answers 409 once the attempt is final (%s)", async (_label, row) => {
      prisma.qutuf_sajjadiya_contest_attempts.findFirst.mockResolvedValue(row);

      await expect(service.start(dto, "127.0.0.1", "agent")).rejects.toThrow(ConflictException);
    });

    it("a /start that loses the unique-index race resumes the winner's attempt (double click)", async () => {
      const { Prisma } = await import("@prisma/client");
      prisma.qutuf_sajjadiya_contest_attempts.findFirst
        .mockResolvedValueOnce(null) // fast path: nobody yet
        .mockResolvedValueOnce(opened); // after the P2002: the winner is visible
      prisma.$queryRaw.mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError("Unique violation", { code: "P2002", clientVersion: "0.0.0-test" }),
      );

      const result = await service.start(dto, "127.0.0.1", "agent");

      expect(result.data).toEqual({ attempt_id: ATTEMPT_ID, attempt_token: expect.any(String), resumed: true });
    });

    it("answers 409 when the race winner had already submitted", async () => {
      const { Prisma } = await import("@prisma/client");
      prisma.qutuf_sajjadiya_contest_attempts.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: ATTEMPT_ID, submitted_at: new Date(), final_score: 1 });
      prisma.$queryRaw.mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError("Unique violation", { code: "P2002", clientVersion: "0.0.0-test" }),
      );

      await expect(service.start(dto, "127.0.0.1", "agent")).rejects.toThrow(ConflictException);
    });

    it("answers 409 when the unique index fired but no row is visible", async () => {
      const { Prisma } = await import("@prisma/client");
      prisma.qutuf_sajjadiya_contest_attempts.findFirst.mockResolvedValue(null);
      prisma.$queryRaw.mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError("Unique violation", { code: "P2002", clientVersion: "0.0.0-test" }),
      );

      await expect(service.start(dto, "127.0.0.1", "agent")).rejects.toThrow(ConflictException);
    });

    it("lets any other database error through", async () => {
      prisma.qutuf_sajjadiya_contest_attempts.findFirst.mockResolvedValue(null);
      prisma.$queryRaw.mockRejectedValueOnce(new Error("connection lost"));

      await expect(service.start(dto, "127.0.0.1", "agent")).rejects.toThrow("connection lost");
    });
  });

  describe("start — one identity, however it is written", () => {
    it("looks in both columns for the canonical + form AND the legacy 00 form of a phone number", async () => {
      prisma.qutuf_sajjadiya_contest_attempts.findFirst.mockResolvedValue(null);
      prisma.$queryRaw.mockResolvedValueOnce([{ id: ATTEMPT_ID }]);

      await service.start({ name: "Ahmad", contact: "+964 780-123 4567", contactType: "phone" }, "127.0.0.1", "agent");

      const variants = ["+9647801234567", "009647801234567"];
      expect(prisma.qutuf_sajjadiya_contest_attempts.findFirst.mock.calls[0][0].where).toEqual({
        OR: [{ phone: { in: variants } }, { email: { in: variants } }],
      });
    });

    it("a 00-prefixed number is the same person as the + form (it used to slip past the check)", async () => {
      prisma.qutuf_sajjadiya_contest_attempts.findFirst.mockResolvedValue({
        id: "existing",
        submitted_at: new Date(),
        final_score: 3,
      });

      await expect(
        service.start({ name: "Ahmad", contact: "00964 780 123 4567", contactType: "phone" }, "127.0.0.1", "agent"),
      ).rejects.toThrow(ConflictException);

      const [{ where }] = prisma.qutuf_sajjadiya_contest_attempts.findFirst.mock.calls[0];
      expect(where.OR[0].phone.in).toContain("+9647801234567");
    });

    it("stores the canonical + form and a lower-cased e-mail", async () => {
      prisma.qutuf_sajjadiya_contest_attempts.findFirst.mockResolvedValue(null);
      prisma.$queryRaw.mockResolvedValue([{ id: ATTEMPT_ID }]);

      await service.start({ name: "A", contact: "00964 780 123 4567", contactType: "phone" }, "127.0.0.1", "agent");
      await service.start({ name: "A", contact: "Test@Mail.COM", contactType: "email" }, "127.0.0.1", "agent");

      // $queryRaw is a tagged template: (strings, name, phone, email, ip, userAgent).
      const [phoneInsert, emailInsert] = prisma.$queryRaw.mock.calls;
      expect(phoneInsert.slice(1)).toEqual(["A", "+9647801234567", null, "127.0.0.1", "agent"]);
      expect(emailInsert.slice(1)).toEqual(["A", null, "test@mail.com", "127.0.0.1", "agent"]);
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

    describe("score reveal", () => {
      const perfect = {
        attempt_id: ATTEMPT_ID,
        answers: [
          { question_id: "1", answer: "C" },
          { question_id: "2", answer: "C" },
        ],
      };

      it("tells the participant their score by default", async () => {
        setUpHappyPath();

        const result = await service.submit(perfect);

        expect(result.data).toEqual({ final_score: 2, total_questions: 2, score_revealed: true });
      });

      it("withholds the score when CONTEST_REVEAL_SCORE=false — but still STORES it for the committee", async () => {
        process.env.CONTEST_REVEAL_SCORE = "false";
        setUpHappyPath();

        const result = await service.submit(perfect);

        expect(result.data).toEqual({ final_score: null, total_questions: 2, score_revealed: false });
        // 2nd $executeRaw is the UPDATE ... SET final_score = ${score}: (strings, score, attemptId).
        expect(txExecuteRaw.mock.calls[1][1]).toBe(2);
      });

      it("is not fooled into a different reveal state by a wrong answer", async () => {
        process.env.CONTEST_REVEAL_SCORE = "false";
        setUpHappyPath();

        const result = await service.submit({
          ...perfect,
          answers: [
            { question_id: "1", answer: "A" },
            { question_id: "2", answer: "B" },
          ],
        });

        expect(result.data.final_score).toBeNull();
        expect(txExecuteRaw.mock.calls[1][1]).toBe(0);
      });
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
