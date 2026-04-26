import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsEmail, IsIn, IsISO8601, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';

export class SubmitAnswerDto {
  @IsString()
  question_id: string;

  @IsIn(['A', 'B', 'C', 'D'])
  answer: string;
}

export class SubmitContestDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SubmitAnswerDto)
  @ArrayMinSize(1)
  answers: SubmitAnswerDto[];

  @IsOptional()
  @IsISO8601()
  started_at?: string;
}
