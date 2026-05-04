import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { StartContestDto, SubmitContestDto } from "./dto/contest.dto";

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
        orderBy: { started_at: "desc" },
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
    const phone = dto.contactType === "phone" ? dto.contact : null;
    const email = dto.contactType === "email" ? dto.contact : null;

    let rows: any[];
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
    } catch (err: any) {
      if (err?.code === "P2010" && err?.meta?.code === "23505") {
        throw new ConflictException(
          "لقد شاركتَ في المسابقة مسبقاً، لا يمكنك المشاركة مرة أخرى.",
        );
      }
      throw err;
    }

    return { message: "Contest started", data: { attempt_id: rows[0].id } };
  }

  async submit(dto: SubmitContestDto) {
    const attempts: any[] = await this.prisma.$queryRaw`
    SELECT id, final_score
    FROM qutuf_sajjadiya_contest_attempts
    WHERE id = ${dto.attempt_id}::uuid
  `;

    if (!attempts.length) {
      throw new NotFoundException("Attempt not found");
    }

    if (attempts[0].final_score !== null) {
      throw new ConflictException("This attempt has already been submitted");
    }

    const questions: any[] = await this.prisma.$queryRaw`
    SELECT id, correct_answer
    FROM qutuf_sajjadiya_contest_questions
  `;

    if (dto.answers.length !== questions.length) {
      throw new ConflictException("All questions must be answered");
    }

    const questionMap = new Map(
      questions.map((q) => [String(q.id), q.correct_answer]),
    );

    let finalScore = 0;

    // Prepare bulk insert values
    const values: any[] = [];

    for (const answer of dto.answers) {
      const correctAnswer = questionMap.get(String(answer.question_id));
      const isCorrect = correctAnswer === answer.answer;

      if (isCorrect) finalScore++;

      values.push({
        attempt_id: dto.attempt_id,
        question_id: String(answer.question_id),
        selected: answer.answer,
        is_correct: isCorrect,
      });
    }

    console.log(
      `[submit] attempt=${dto.attempt_id} answers=${dto.answers.length} sample=${JSON.stringify(dto.answers[0])}`,
    );

    const answerRows = Prisma.join(
      values.map(
        (v) =>
          Prisma.sql`(gen_random_uuid(), ${v.attempt_id}::uuid, ${v.question_id}, ${v.selected}, ${v.is_correct})`,
      ),
      ", ",
    );

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw(Prisma.sql`
          INSERT INTO qutuf_sajjadiya_contest_answers
            (id, attempt_id, question_id, selected, is_correct)
          VALUES ${answerRows}
          ON CONFLICT (attempt_id, question_id) DO NOTHING
        `);

        await tx.$executeRaw`
          UPDATE qutuf_sajjadiya_contest_attempts
          SET final_score = ${finalScore}, submitted_at = NOW()
          WHERE id = ${dto.attempt_id}::uuid
        `;
      });
    } catch (err: any) {
      console.error(
        `[submit] transaction error attempt=${dto.attempt_id}:`,
        err?.message,
        "code:", err?.code,
        "meta:", JSON.stringify(err?.meta),
      );
      throw err;
    }

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
