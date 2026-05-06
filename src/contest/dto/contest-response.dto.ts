import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationMetaDto } from '../../common/dto/api-response.dto';

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

class AttemptListDataDto {
  @ApiProperty({ type: [ContestAttemptDto] })
  items: ContestAttemptDto[];

  @ApiProperty({ type: PaginationMetaDto })
  pagination: PaginationMetaDto;
}

export class AttemptListResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
  timestamp: string;

  @ApiProperty({ example: 'Attempts fetched' })
  message: string;

  @ApiProperty({ type: AttemptListDataDto })
  data: AttemptListDataDto;
}

class ContestQuestionDto {
  @ApiProperty({ example: 'uuid-...' })
  id: string;

  @ApiProperty({ example: 'ما هو اسم الإمام الأول؟' })
  text: string;

  @ApiProperty({ type: [String], example: ['علي بن أبي طالب', 'الحسن', 'الحسين', 'محمد الباقر'] })
  options: string[];
}

export class QuestionListResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
  timestamp: string;

  @ApiProperty({ example: 'Questions fetched' })
  message: string;

  @ApiProperty({ type: [ContestQuestionDto] })
  data: ContestQuestionDto[];
}

class StartContestDataDto {
  @ApiProperty({ example: 'uuid-...' })
  attempt_id: string;
}

export class StartContestResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
  timestamp: string;

  @ApiProperty({ example: 'Contest started' })
  message: string;

  @ApiProperty({ type: StartContestDataDto })
  data: StartContestDataDto;
}

class SubmitContestDataDto {
  @ApiProperty({ example: 8 })
  final_score: number;

  @ApiProperty({ example: 10 })
  total_questions: number;
}

export class SubmitContestResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
  timestamp: string;

  @ApiProperty({ example: 'Contest submitted' })
  message: string;

  @ApiProperty({ type: SubmitContestDataDto })
  data: SubmitContestDataDto;
}
