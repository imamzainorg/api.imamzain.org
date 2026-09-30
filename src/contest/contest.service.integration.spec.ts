/**
 * Integration tests for the contest's identity handling and score reveal.
 *
 * Strategy: PrismaService → real database (DATABASE_TEST_URL); nothing else to
 * mock (ContestService only needs Prisma).
 *
 * What these confirm that the mocked unit tests cannot:
 *   - /start really is idempotent for an unsubmitted attempt: one row, the same
 *     attempt handed back — including when several requests race for the same
 *     new identity and the partial unique index turns all but one into P2002;
 *   - phone and e-mail variants of one person find the SAME row, in either
 *     column, including rows stored before "00" was folded into "+";
 *   - a submitted attempt stays final;
 *   - the score is stored in the database even when the reveal is switched off;
 *   - the real `contest_open` site_settings row (not a mock) gates start/submit,
 *     and a missing row reads as closed.
 *
 * Run with: npm run test:integration
 */
process.env.CONTEST_ATTEMPT_SECRET = process.env.CONTEST_ATTEMPT_SECRET ?? "integration-contest-secret";

import { ConflictException, ForbiddenException } from "@nestjs/common";
import { ContestService } from "./contest.service";
import { PrismaService } from "../prisma/prisma.service";
import { prisma } from "../../test/db-helpers";

const describeIfDb = process.env.DATABASE_TEST_URL ? describe : describe.skip;

describeIfDb("ContestService (integration)", () => {
  let service: ContestService;

  beforeAll(() => prisma.$connect());
  afterAll(() => prisma.$disconnect());

  const setContestOpen = (open: boolean) =>
    prisma.site_settings.upsert({
      where: { key: "contest_open" },
      create: { key: "contest_open", value: String(open), type: "boolean", is_public: true },
      update: { value: String(open) },
    });

  beforeEach(async () => {
    delete process.env.CONTEST_REVEAL_SCORE;
    await prisma.qutuf_sajjadiya_contest_answers.deleteMany();
    await prisma.qutuf_sajjadiya_contest_attempts.deleteMany();
    await prisma.qutuf_sajjadiya_contest_questions.deleteMany();
    await prisma.qutuf_sajjadiya_contest_questions.createMany({
      data: [
        { id: "1", question: "Q1", option_a: "a", option_b: "b", option_c: "c", option_d: "d", correct_answer: "C" },
        { id: "2", question: "Q2", option_a: "a", option_b: "b", option_c: "c", option_d: "d", correct_answer: "A" },
      ],
    });
    // Open by default so every existing test below — none of which is about the
    // open/closed gate — keeps exercising start()/submit() as before. The
    // dedicated describe block flips it back to closed / removes it.
    await setContestOpen(true);
    service = new ContestService(prisma as unknown as PrismaService);
  });

  const start = (contact: string, contactType: "phone" | "email" = "phone", name = "Ahmad") =>
    service.start({ name, contact, contactType }, "127.0.0.1", "jest");
  const attemptCount = () => prisma.qutuf_sajjadiya_contest_attempts.count();

  describe("start is idempotent for an unsubmitted attempt", () => {
    it("starting again returns the same attempt and token, and does not add a row", async () => {
      const first = await start("+9647801234567");
      const again = await start("+9647801234567");

      expect(first.data.resumed).toBe(false);
      expect(again.data).toEqual({ ...first.data, resumed: true });
      expect(await attemptCount()).toBe(1);
    });

    it("a resumed attempt can then be submitted with the token from either response", async () => {
      const first = await start("+9647801234567");
      const again = await start("+9647801234567");

      const result = await service.submit({
        attempt_id: again.data.attempt_id,
        attempt_token: first.data.attempt_token,
        answers: [
          { question_id: "1", answer: "C" },
          { question_id: "2", answer: "A" },
        ],
      });

      expect(result.data).toEqual({ final_score: 2, total_questions: 2, score_revealed: true });
    });

    it("five requests racing for one new identity all get the same attempt (the unique index settles it)", async () => {
      const results = await Promise.all(Array.from({ length: 5 }, () => start("racer@example.com", "email")));

      expect(new Set(results.map((r) => r.data.attempt_id)).size).toBe(1);
      expect(results.filter((r) => !r.data.resumed)).toHaveLength(1);
      expect(await attemptCount()).toBe(1);
    });

    it("a submitted attempt is final: starting again is a 409 and creates nothing", async () => {
      const first = await start("+9647801234567");
      await service.submit({
        attempt_id: first.data.attempt_id,
        answers: [
          { question_id: "1", answer: "A" },
          { question_id: "2", answer: "A" },
        ],
      });

      await expect(start("+9647801234567")).rejects.toThrow(ConflictException);
      expect(await attemptCount()).toBe(1);
    });

    it("a 0-scoring submitted attempt is still submitted (a score of 0 is not 'unset')", async () => {
      const first = await start("zero@example.com", "email");
      await service.submit({
        attempt_id: first.data.attempt_id,
        answers: [
          { question_id: "1", answer: "A" },
          { question_id: "2", answer: "B" },
        ],
      });
      const row = await prisma.qutuf_sajjadiya_contest_attempts.findUniqueOrThrow({ where: { id: first.data.attempt_id } });
      expect(row.final_score).toBe(0);

      await expect(start("zero@example.com", "email")).rejects.toThrow(ConflictException);
    });
  });

  describe("one identity, however it is written", () => {
    it("+964… and 00964… (with spaces or dashes) are the same phone", async () => {
      const first = await start("+964 780 123 4567");
      const second = await start("00964-780-123-4567");

      expect(second.data.attempt_id).toBe(first.data.attempt_id);
      expect(await attemptCount()).toBe(1);
      const row = await prisma.qutuf_sajjadiya_contest_attempts.findUniqueOrThrow({ where: { id: first.data.attempt_id } });
      expect(row.phone).toBe("+9647801234567"); // stored in the canonical form
    });

    it("finds a row stored BEFORE the 00 → + folding existed", async () => {
      const legacy = await prisma.qutuf_sajjadiya_contest_attempts.create({
        data: { name: "Old", phone: "009647801234567", started_at: new Date(), submitted_at: null },
      });

      const result = await start("+9647801234567");

      expect(result.data.attempt_id).toBe(legacy.id);
      expect(result.data.resumed).toBe(true);
      expect(await attemptCount()).toBe(1);
    });

    it("a legacy row that already submitted blocks the new spelling too", async () => {
      await prisma.qutuf_sajjadiya_contest_attempts.create({
        data: { name: "Old", phone: "009647801234567", started_at: new Date(), submitted_at: new Date(), final_score: 40 },
      });

      await expect(start("+9647801234567")).rejects.toThrow(ConflictException);
      expect(await attemptCount()).toBe(1);
    });

    it("e-mail case does not make a new identity", async () => {
      const first = await start("Person@Example.com", "email");
      const second = await start("person@example.COM", "email");

      expect(second.data.attempt_id).toBe(first.data.attempt_id);
      expect(await attemptCount()).toBe(1);
    });

    it("the same string as a phone and as an e-mail is caught in either column", async () => {
      const asEmail = await start("dual@example.com", "email");
      // A phone can't equal an e-mail string, but the lookup searches both columns.
      const existing = await prisma.qutuf_sajjadiya_contest_attempts.findFirst({
        where: { OR: [{ phone: { in: ["dual@example.com"] } }, { email: { in: ["dual@example.com"] } }] },
      });
      expect(existing!.id).toBe(asEmail.data.attempt_id);
    });

    it("different people are different attempts", async () => {
      const a = await start("+9647801234567");
      const b = await start("+9647809999999");

      expect(a.data.attempt_id).not.toBe(b.data.attempt_id);
      expect(await attemptCount()).toBe(2);
    });
  });

  describe("score reveal", () => {
    const answers = [
      { question_id: "1", answer: "C" },
      { question_id: "2", answer: "A" },
    ];

    it("stores the score and hides it from the participant when CONTEST_REVEAL_SCORE=false", async () => {
      process.env.CONTEST_REVEAL_SCORE = "false";
      const started = await start("+9647801234567");

      const result = await service.submit({ attempt_id: started.data.attempt_id, answers });

      expect(result.data).toEqual({ final_score: null, total_questions: 2, score_revealed: false });
      const row = await prisma.qutuf_sajjadiya_contest_attempts.findUniqueOrThrow({ where: { id: started.data.attempt_id } });
      expect(row.final_score).toBe(2); // the committee still has it
      expect(row.submitted_at).not.toBeNull();
    });

    it("the admin attempts list still carries the score", async () => {
      process.env.CONTEST_REVEAL_SCORE = "false";
      const started = await start("+9647801234567");
      await service.submit({ attempt_id: started.data.attempt_id, answers });

      const list = await service.findAllAttempts(1, 20, true);

      expect(list.data.items.map((i) => i.final_score)).toEqual([2]);
    });
  });

  describe("contest open/closed (real site_settings row)", () => {
    it("is closed when the row is missing entirely — not open by default", async () => {
      await prisma.site_settings.deleteMany({ where: { key: "contest_open" } });

      const err = await start("+9647801234567").catch((e) => e);

      expect(err).toBeInstanceOf(ForbiddenException);
      expect(err.getResponse()).toMatchObject({ code: "CONTEST_CLOSED" });
      expect(await attemptCount()).toBe(0);
    });

    it("is closed when explicitly set to false, and reopens the moment the row flips to true", async () => {
      await setContestOpen(false);
      await expect(start("+9647801234567")).rejects.toThrow(ForbiddenException);

      await setContestOpen(true);
      const result = await start("+9647801234567");

      expect(result.data.attempt_id).toBeDefined();
    });

    it("also blocks submit(), even for an attempt opened while the contest was still open", async () => {
      const started = await start("+9647801234567");
      await setContestOpen(false);

      const err = await service
        .submit({
          attempt_id: started.data.attempt_id,
          answers: [
            { question_id: "1", answer: "C" },
            { question_id: "2", answer: "A" },
          ],
        })
        .catch((e) => e);

      expect(err).toBeInstanceOf(ForbiddenException);
      const row = await prisma.qutuf_sajjadiya_contest_attempts.findUniqueOrThrow({ where: { id: started.data.attempt_id } });
      expect(row.submitted_at).toBeNull();
      expect(row.final_score).toBeNull();
    });
  });
});
