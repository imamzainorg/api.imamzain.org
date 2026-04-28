import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StartContestDto, SubmitContestDto } from './dto/contest.dto';

@Injectable()
export class ContestService {
  constructor(private readonly prisma: PrismaService) {}

  async listQuestions() {
    const questions: any[] = await this.prisma.$queryRaw`
      SELECT id, question, option_a, option_b, option_c, option_d
      FROM qutuf_sajjadiya_contest_questions
      ORDER BY id ASC
    `;
    return { message: 'Questions fetched', data: questions };
  }

  async start(dto: StartContestDto, ip: string, userAgent: string) {
    const rows: any[] = await this.prisma.$queryRaw`
      INSERT INTO qutuf_sajjadiya_contest_answers (name, email, started_at, submitted_at, ip, user_agent)
      VALUES (
        ${dto.name ?? null},
        ${dto.contact ?? null},
        NOW(),
        NULL,
        ${ip},
        ${userAgent}
      )
      RETURNING id
    `;

    return { message: 'Contest started', data: { attempt_id: rows[0].id } };
  }

  async submit(dto: SubmitContestDto) {
    const attempts: any[] = await this.prisma.$queryRaw`
      SELECT id, final_score
      FROM qutuf_sajjadiya_contest_answers
      WHERE id = ${dto.attempt_id}::uuid
    `;

    if (!attempts.length) {
      throw new NotFoundException('Attempt not found');
    }

    if (attempts[0].final_score !== null) {
      throw new ConflictException('This attempt has already been submitted');
    }

    const questions: any[] = await this.prisma.$queryRaw`
      SELECT id, correct_answer FROM qutuf_sajjadiya_contest_questions
    `;

    const questionMap = new Map(questions.map((q) => [String(q.id), q.correct_answer]));

    let finalScore = 0;
    for (const answer of dto.answers) {
      const correctAnswer = questionMap.get(String(answer.question_id));
      if (correctAnswer && answer.answer === correctAnswer) {
        finalScore++;
      }
    }

    await this.prisma.$queryRaw`
      UPDATE qutuf_sajjadiya_contest_answers
      SET final_score = ${finalScore}, submitted_at = NOW()
      WHERE id = ${dto.attempt_id}::uuid
    `;

    try {
      await this.prisma.audit_logs.create({
        data: {
          action: 'CONTEST_SUBMITTED',
          resource_type: 'contest_answer',
          changes: { final_score: finalScore, total_questions: questions.length },
        },
      });
    } catch {}

    return {
      success: true,
      message: 'Contest submitted',
      data: { final_score: finalScore, total_questions: questions.length },
    };
  }
}
