import {
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { StartContestDto, SubmitContestDto } from "./dto/contest.dto";

@Injectable()
export class ContestService {
  constructor(private readonly prisma: PrismaService) {}

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

    const rows: any[] = await this.prisma.$queryRaw`
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

    // Insert all answers (transaction recommended)
    await this.prisma.$transaction([
      this.prisma.qutuf_sajjadiya_contest_answers.createMany({
        data: values,
        skipDuplicates: true, // protects against re-submit edge cases
      }),

      this.prisma.$executeRaw`
      UPDATE qutuf_sajjadiya_contest_attempts
      SET final_score = ${finalScore}, submitted_at = NOW()
      WHERE id = ${dto.attempt_id}::uuid
    `,
    ]);

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
