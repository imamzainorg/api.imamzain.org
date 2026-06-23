import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ApiEnvelope, ApiPaginatedData } from '../../common/dto/api-envelope';

class ContestAttemptDto {
  @ApiProperty({ example: 'uuid-...' })
  id: string;

  @ApiProperty({ example: 'أحمد محمد' })
  full_name: string;

  @ApiPropertyOptional({ example: '+9647801234567' })
  phone?: string;

  @ApiPropertyOptional({ example: 0 })
  score?: number;

  @ApiProperty({ example: false })
  is_submitted: boolean;

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
  created_at: string;
}

class AttemptListDataDto extends ApiPaginatedData(ContestAttemptDto) {}

export class AttemptListResponseDto extends ApiEnvelope(AttemptListDataDto, 'Attempts fetched') {}

class ContestQuestionDto {
  @ApiProperty({ example: 'uuid-...' })
  id: string;

  @ApiProperty({ example: 'ما هو اسم الإمام الأول؟' })
  text: string;

  @ApiProperty({ type: [String], example: ['علي بن أبي طالب', 'الحسن', 'الحسين', 'محمد الباقر'] })
  options: string[];
}

export class QuestionListResponseDto extends ApiEnvelope([ContestQuestionDto], 'Questions fetched') {}

class StartContestDataDto {
  @ApiProperty({ example: 'uuid-...' })
  attempt_id: string;

  @ApiProperty({
    example: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
    description:
      "HMAC token bound to attempt_id. Send back in the POST /submit body as `attempt_token`. Optional today, will become required once the frontend rolls out token support.",
  })
  attempt_token: string;
}

export class StartContestResponseDto extends ApiEnvelope(StartContestDataDto, 'Contest started') {}

class SubmitContestDataDto {
  @ApiProperty({ example: 8 })
  final_score: number;

  @ApiProperty({ example: 10 })
  total_questions: number;
}

export class SubmitContestResponseDto extends ApiEnvelope(SubmitContestDataDto, 'Contest submitted') {}
