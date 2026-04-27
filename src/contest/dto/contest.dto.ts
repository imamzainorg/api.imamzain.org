import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsEmail, IsIn, IsISO8601, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';

export class SubmitAnswerDto {
  @ApiProperty({ example: '1', description: 'Question ID as returned by GET /api/v1/contest/questions' })
  @IsString()
  question_id: string;

  @ApiProperty({ enum: ['A', 'B', 'C', 'D'], example: 'C', description: 'Selected option (uppercase)' })
  @IsIn(['A', 'B', 'C', 'D'])
  answer: string;
}

export class SubmitContestDto {
  @ApiPropertyOptional({ example: 'Ahmad Hassan', maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({ example: 'contestant@example.com', format: 'email' })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiProperty({ type: [SubmitAnswerDto], description: 'One entry per question; unanswered questions score 0' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SubmitAnswerDto)
  @ArrayMinSize(1)
  answers: SubmitAnswerDto[];

  @ApiPropertyOptional({ example: '2025-01-15T10:00:00Z', description: 'ISO 8601 timestamp when the contestant started the quiz' })
  @IsOptional()
  @IsISO8601()
  started_at?: string;
}
