import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsIn, IsOptional, IsString, IsUUID, MaxLength, ValidateNested } from 'class-validator';

export class StartContestDto {
  @ApiPropertyOptional({ example: 'Ahmad Hassan Al-Karbalayi', maxLength: 150 })
  @IsOptional()
  @IsString()
  @MaxLength(150)
  name?: string;

  @ApiPropertyOptional({ example: '+9647001234567', description: 'Phone number or email address provided by the contestant' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  contact?: string;

  @ApiPropertyOptional({ enum: ['phone', 'email'], example: 'phone', description: 'Type of contact provided' })
  @IsOptional()
  @IsIn(['phone', 'email'])
  contactType?: 'phone' | 'email';
}

export class SubmitAnswerDto {
  @ApiProperty({ example: '1', description: 'Question ID as returned by GET /questions' })
  @IsString()
  question_id: string;

  @ApiProperty({ enum: ['A', 'B', 'C', 'D'], example: 'C', description: 'Selected option (uppercase)' })
  @IsIn(['A', 'B', 'C', 'D'])
  answer: string;
}

export class SubmitContestDto {
  @ApiProperty({ example: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx', description: 'Attempt ID received from POST /start' })
  @IsUUID()
  attempt_id: string;

  @ApiProperty({ type: [SubmitAnswerDto], description: 'One entry per question; unanswered questions score 0' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SubmitAnswerDto)
  @ArrayMinSize(1)
  answers: SubmitAnswerDto[];
}
