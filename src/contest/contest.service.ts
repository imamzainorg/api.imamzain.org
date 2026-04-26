import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SubmitContestDto } from './dto/contest.dto';

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

  async submit(dto: SubmitContestDto, ip: string, userAgent: string) {
    const questions: any[] = await this.prisma.$queryRaw`
      SELECT id, correct_answer FROM qutuf_sajjadiya_contest_questions
    `;

    const questionMap = new Map(questions.map((q) => [String(q.id), q.correct_answer]));

    let finalScore = 0;
    for (const answer of dto.answers) {
      const correctAnswer = questionMap.get(answer.question_id);
      if (correctAnswer && answer.answer === correctAnswer) {
        finalScore++;
      }
    }

    const rows: any[] = await this.prisma.$queryRaw`
      INSERT INTO qutuf_sajjadiya_contest_answers (name, email, started_at, ip, user_agent, final_score)
      VALUES (${dto.name ?? null}, ${dto.email ?? null}, ${dto.started_at ? new Date(dto.started_at) : null}, ${ip}, ${userAgent}, ${finalScore})
      RETURNING id
    `;

    const submissionId = rows[0]?.id ?? null;

    try {
      await this.prisma.audit_logs.create({
        data: {
          user_id: null,
          action: 'CONTEST_SUBMITTED',
          resource_type: 'contest_answer',
          resource_id: null,
          changes: { method: 'POST', path: '/api/v1/contest/submit', final_score: finalScore },
        },
      });
    } catch {}

    return {
      message: 'Contest submitted',
      data: { id: submissionId, final_score: finalScore, total_questions: questions.length },
    };
  }
}
