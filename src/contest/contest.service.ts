import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { StartContestDto, SubmitContestDto } from "./dto/contest.dto";

const PHONE_RE = /^\+?[\d\s-]{7,20}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

@Injectable()
export class ContestService {
  private readonly logger = new Logger(ContestService.name);

  constructor(private readonly prisma: PrismaService) {}

  async findAllAttempts(page: number, limit: number, submitted?: boolean) {
    const skip = (page - 1) * limit;

    const where: any = {};
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
        pagination: { page, limit, total, pages: Math.ceil(total / limit) },
      },
    };
  }

  async listQuestions() {
    const questions: any[] = await this.prisma.$queryRaw`
      SELECT id, question, option_a, option_b, option_c, option_d
      FROM qutuf_sajjadiya_contest_questions
      ORDER BY id ASC
    `;
    return { message: "Questions fetched", data: questions };
  }

  async start(dto: StartContestDto, ip: string, userAgent: string) {
    if (dto.contactType === "phone" && !PHONE_RE.test(dto.contact)) {
      throw new BadRequestException("Invalid phone number format");
    }
    if (dto.contactType === "email" && !EMAIL_RE.test(dto.contact)) {
      throw new BadRequestException("Invalid email format");
    }

    const phone = dto.contactType === "phone" ? dto.contact : null;
    const email = dto.contactType === "email" ? dto.contact : null;

    // The DB has no unique index on (phone) or (email), so enforce
    // one-attempt-per-identity at the service level. Search both columns
    // for the supplied value so the same string submitted as both
    // contactType=phone and contactType=email is still caught.
    const existing = await this.prisma.qutuf_sajjadiya_contest_attempts.findFirst({
      where: { OR: [{ phone: dto.contact }, { email: dto.contact }] },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException(
        "لقد شاركتَ في المسابقة مسبقاً، لا يمكنك المشاركة مرة أخرى.",
      );
    }

    const rows: { id: string }[] = await this.prisma.$queryRaw`
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

    return { message: "Contest started", data: { attempt_id: rows[0].id } };
  }

  async submit(dto: SubmitContestDto) {
    const questions: { id: string; correct_answer: string }[] = await this.prisma.$queryRaw`
      SELECT id, correct_answer
      FROM qutuf_sajjadiya_contest_questions
    `;

    if (dto.answers.length !== questions.length) {
      throw new ConflictException("All questions must be answered");
    }

    const questionMap = new Map(
      questions.map((q) => [String(q.id), q.correct_answer]),
    );

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

    if (insertValues.length === 0) {
      throw new BadRequestException("No valid answers provided");
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
      `Contest submission: attempt=${dto.attempt_id} answered=${insertValues.length}/${questions.length}`,
    );

    return {
      success: true,
      message: "Contest submitted",
      data: {
        final_score: finalScore,
        total_questions: questions.length,
      },
    };
  }
}
