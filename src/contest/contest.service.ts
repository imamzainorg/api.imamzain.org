import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
  UnauthorizedException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import * as crypto from "crypto";
import { PrismaService } from "../prisma/prisma.service";
import { buildPaginationMeta } from "../common/utils/pagination.util";
import { StartContestDto, SubmitContestDto } from "./dto/contest.dto";

const PHONE_RE = /^\+?[\d\s-]{7,20}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function resolveAttemptSecret(): string {
  const secret = process.env.CONTEST_ATTEMPT_SECRET ?? process.env.JWT_SECRET;
  if (!secret) {
    // Empty string here would produce HMAC tokens an attacker can forge.
    // Refuse to boot so the misconfig is caught immediately.
    throw new Error("CONTEST_ATTEMPT_SECRET (or JWT_SECRET) is required");
  }
  return secret;
}

export interface CachedQuestion {
  id: string;
  question: string;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
}

@Injectable()
export class ContestService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ContestService.name);
  private readonly attemptSecret = resolveAttemptSecret();

  /**
   * Pre-warm both question caches at boot so the first /questions or /submit
   * call doesn't read the full questions table from cold storage.
   */
  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.getQuestions();
      await this.getCorrectAnswers();
    } catch (err) {
      this.logger.warn(`Contest cache pre-warm failed: ${err}`);
    }
  }

  // Question rows are immutable from this API (no admin endpoint mutates
  // qutuf_sajjadiya_contest_questions). Cache the public columns at first
  // touch and the correct-answer map for scoring. Memory cost is tiny
  // (~50 rows) and every /submit avoids a full-table read.
  private questionsCache: CachedQuestion[] | null = null;
  private correctAnswersCache: Map<string, string> | null = null;

  constructor(private readonly prisma: PrismaService) {}

  private async getQuestions(): Promise<CachedQuestion[]> {
    if (this.questionsCache) return this.questionsCache;
    const rows = await this.prisma.$queryRaw<CachedQuestion[]>`
      SELECT id, question, option_a, option_b, option_c, option_d
      FROM qutuf_sajjadiya_contest_questions
      ORDER BY id ASC
    `;
    this.questionsCache = rows;
    return rows;
  }

  private async getCorrectAnswers(): Promise<Map<string, string>> {
    if (this.correctAnswersCache) return this.correctAnswersCache;
    const rows = await this.prisma.$queryRaw<Array<{ id: string; correct_answer: string }>>`
      SELECT id, correct_answer FROM qutuf_sajjadiya_contest_questions
    `;
    this.correctAnswersCache = new Map(rows.map((r) => [String(r.id), r.correct_answer]));
    return this.correctAnswersCache;
  }

  /**
   * HMAC of the attempt_id, returned at /start and verified at /submit.
   * Keeps a stolen or guessed attempt_id from being submittable without
   * also possessing the corresponding token. The secret is server-side
   * only; the token itself is safe to hand back to the client.
   */
  private signAttemptToken(attemptId: string): string {
    return crypto
      .createHmac("sha256", this.attemptSecret)
      .update(attemptId)
      .digest("hex");
  }

  private verifyAttemptToken(attemptId: string, token: string): boolean {
    const expected = this.signAttemptToken(attemptId);
    const a = Buffer.from(expected, "utf8");
    const b = Buffer.from(token, "utf8");
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  }

  async findAllAttempts(page: number, limit: number, submitted?: boolean) {
    const skip = (page - 1) * limit;

    const where: Prisma.qutuf_sajjadiya_contest_attemptsWhereInput = {};
    if (submitted === true) where.submitted_at = { not: null };
    if (submitted === false) where.submitted_at = null;

    const [items, total] = await Promise.all([
      this.prisma.qutuf_sajjadiya_contest_attempts.findMany({
        where,
        orderBy: [{ started_at: "desc" }, { id: "asc" }],
        skip,
        take: limit,
        select: {
          id: true,
          name: true,
          phone: true,
          email: true,
          started_at: true,
          submitted_at: true,
          ip: true,
          user_agent: true,
          final_score: true,
        },
      }),
      this.prisma.qutuf_sajjadiya_contest_attempts.count({ where }),
    ]);

    return {
      message: "Attempts fetched",
      data: {
        items,
        pagination: buildPaginationMeta(page, limit, total),
      },
    };
  }

  async listQuestions() {
    const questions = await this.getQuestions();
    return { message: "Questions fetched", data: questions };
  }

  async start(dto: StartContestDto, ip: string, userAgent: string) {
    if (dto.contactType === "phone" && !PHONE_RE.test(dto.contact)) {
      throw new BadRequestException("Invalid phone number format");
    }
    if (dto.contactType === "email" && !EMAIL_RE.test(dto.contact)) {
      throw new BadRequestException("Invalid email format");
    }

    // Normalise to a canonical identity before dedup/insert so case and
    // formatting variants of the same person (Test@x.com vs test@x.com,
    // "+964 780 123" vs "+964780123") collapse to one. Both the fast-path
    // check and the stored column use the canonical value, so the partial
    // unique index enforces the same identity.
    const normalizedContact =
      dto.contactType === "email"
        ? dto.contact.trim().toLowerCase()
        : dto.contact.replace(/[\s-]/g, "");

    const phone = dto.contactType === "phone" ? normalizedContact : null;
    const email = dto.contactType === "email" ? normalizedContact : null;

    // The partial unique indexes uniq_contest_attempts_phone /
    // uniq_contest_attempts_email (migration 20260525120000_contest_contact_unique)
    // are the atomic backstop; this findFirst is a fast-path that returns the
    // friendly Arabic message before the insert. Search both columns so the
    // same string submitted as both contactType=phone and =email is caught.
    const existing = await this.prisma.qutuf_sajjadiya_contest_attempts.findFirst({
      where: { OR: [{ phone: normalizedContact }, { email: normalizedContact }] },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException(
        "لقد شاركتَ في المسابقة مسبقاً، لا يمكنك المشاركة مرة أخرى.",
      );
    }

    let rows: { id: string }[];
    try {
      rows = await this.prisma.$queryRaw`
        INSERT INTO qutuf_sajjadiya_contest_attempts
        (name, phone, email, started_at, submitted_at, ip, user_agent)
        VALUES (
          ${dto.name},
          ${phone},
          ${email},
          NOW(),
          NULL,
          ${ip},
          ${userAgent}
        )
        RETURNING id
      `;
    } catch (err) {
      // Concurrent /start with the same identity: the partial unique index
      // rejects the loser with P2002. Surface the same friendly Arabic message
      // the fast-path returns instead of the generic 409.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw new ConflictException(
          "لقد شاركتَ في المسابقة مسبقاً، لا يمكنك المشاركة مرة أخرى.",
        );
      }
      throw err;
    }

    const attemptId = rows[0].id;
    return {
      message: "Contest started",
      data: {
        attempt_id: attemptId,
        attempt_token: this.signAttemptToken(attemptId),
      },
    };
  }

  async submit(dto: SubmitContestDto) {
    // Verify the attempt_token if present. Currently optional so frontends
    // that haven't adopted token-binding keep working; once they have, flip
    // this to required (`if (!dto.attempt_token) throw new UnauthorizedException`).
    if (dto.attempt_token !== undefined) {
      if (!this.verifyAttemptToken(dto.attempt_id, dto.attempt_token)) {
        throw new UnauthorizedException("Invalid attempt token");
      }
    } else {
      // Surface adoption progress so we know when it's safe to make
      // attempt_token required.
      this.logger.warn(
        `Contest submit without attempt_token (attempt_id=${dto.attempt_id}); frontend should adopt token-binding`,
      );
    }

    const questionMap = await this.getCorrectAnswers();

    // Score by unique question_id only, so duplicate entries pointing at the
    // same question can't inflate the score (the previous bug let an attacker
    // submit N copies of one correct answer for N/N).
    const seen = new Set<string>();
    let finalScore = 0;
    const insertValues: {
      attempt_id: string;
      question_id: string;
      selected: string;
      is_correct: boolean;
    }[] = [];

    for (const answer of dto.answers) {
      const qid = String(answer.question_id);
      if (seen.has(qid)) continue;
      seen.add(qid);
      if (!questionMap.has(qid)) continue;

      const isCorrect = questionMap.get(qid) === answer.answer;
      if (isCorrect) finalScore++;

      insertValues.push({
        attempt_id: dto.attempt_id,
        question_id: qid,
        selected: answer.answer,
        is_correct: isCorrect,
      });
    }

    // Completeness check on the de-duplicated, VALID set — not the raw array.
    // insertValues holds one entry per unique known question_id, so requiring
    // it to equal the question count is the true "every question answered once
    // with a known id" gate. This closes the bypass where duplicate or unknown
    // question_ids padded the raw array to the right length while leaving real
    // questions unanswered.
    if (questionMap.size === 0 || insertValues.length !== questionMap.size) {
      throw new ConflictException("All questions must be answered");
    }

    const answerRows = Prisma.join(
      insertValues.map(
        (v) =>
          Prisma.sql`(gen_random_uuid(), ${v.attempt_id}::uuid, ${v.question_id}, ${v.selected}, ${v.is_correct})`,
      ),
      ", ",
    );

    // Wrap the existence check, the answer insert and the score finalization
    // in a single transaction. The conditional UPDATE returns 0 when another
    // submitter already finalized the same attempt, letting us reject the
    // duplicate cleanly instead of silently overwriting their score.
    const updated = await this.prisma.$transaction(async (tx) => {
      const attempts: { id: string; final_score: number | null }[] = await tx.$queryRaw`
        SELECT id, final_score
        FROM qutuf_sajjadiya_contest_attempts
        WHERE id = ${dto.attempt_id}::uuid
        FOR UPDATE
      `;
      if (!attempts.length) {
        throw new NotFoundException("Attempt not found");
      }
      if (attempts[0].final_score !== null) {
        throw new ConflictException("This attempt has already been submitted");
      }

      await tx.$executeRaw(Prisma.sql`
        INSERT INTO qutuf_sajjadiya_contest_answers
          (id, attempt_id, question_id, selected, is_correct)
        VALUES ${answerRows}
        ON CONFLICT (attempt_id, question_id) DO NOTHING
      `);

      const result = await tx.$executeRaw`
        UPDATE qutuf_sajjadiya_contest_attempts
        SET final_score = ${finalScore}, submitted_at = NOW()
        WHERE id = ${dto.attempt_id}::uuid AND final_score IS NULL
      `;
      return result;
    });

    if (updated === 0) {
      throw new ConflictException("This attempt has already been submitted");
    }

    this.logger.debug(
      `Contest submission: attempt=${dto.attempt_id} answered=${insertValues.length}/${questionMap.size}`,
    );

    return {
      message: "Contest submitted",
      data: {
        final_score: finalScore,
        total_questions: questionMap.size,
      },
    };
  }
}
