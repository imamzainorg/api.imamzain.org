import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from "class-validator";

export class StartContestDto {
  @ApiProperty({ example: "Ahmad Hassan Al-Karbalayi", maxLength: 150 })
  @IsString()
  @MaxLength(150)
  name: string;

  @ApiProperty({
    example: "+9647801234567",
    description: "Phone number or email address provided by the contestant",
  })
  @IsString()
  @MaxLength(200)
  contact: string;

  @ApiProperty({
    enum: ["phone", "email"],
    example: "phone",
    description: "Type of contact provided",
  })
  @IsIn(["phone", "email"])
  contactType: "phone" | "email";
}

export class SubmitAnswerDto {
  @ApiProperty({
    example: "1",
    description: "Question ID as returned by GET /questions",
  })
  @IsString()
  question_id: string;

  @ApiProperty({
    enum: ["A", "B", "C", "D"],
    example: "C",
    description: "Selected option (uppercase)",
  })
  @IsIn(["A", "B", "C", "D"])
  answer: string;
}

export class SubmitContestDto {
  @ApiProperty({
    example: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
    description: "Attempt ID received from POST /start",
  })
  @IsUUID()
  attempt_id: string;

  @ApiProperty({
    type: [SubmitAnswerDto],
    description: "One entry per question; unanswered questions score 0",
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SubmitAnswerDto)
  @ArrayMinSize(1)
  answers: SubmitAnswerDto[];
}
