import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform, Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from "class-validator";

export class StartContestDto {
  @ApiProperty({ example: "Ahmad Hassan Al-Karbalayi", maxLength: 150 })
  @IsString()
  @MaxLength(150)
  name!: string;

  @ApiProperty({
    example: "+9647801234567",
    description:
      "Phone number (E.164-ish: optional + and digits) or email address. The service validates the format against `contactType`.",
  })
  @IsString()
  @MaxLength(200)
  contact!: string;

  @ApiProperty({
    enum: ["phone", "email"],
    example: "phone",
    description: "Type of contact provided",
  })
  @IsIn(["phone", "email"])
  contactType!: "phone" | "email";
}

export class SubmitAnswerDto {
  @ApiProperty({
    example: "1",
    description: "Question ID as returned by GET /questions",
  })
  @IsString()
  @MaxLength(64)
  question_id!: string;

  @ApiProperty({
    enum: ["A", "B", "C", "D"],
    example: "C",
    description: "Selected option (uppercase)",
  })
  @IsIn(["A", "B", "C", "D"])
  answer!: string;
}

export class SubmitContestDto {
  @ApiProperty({
    example: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
    description: "Attempt ID received from POST /start",
  })
  @IsUUID()
  attempt_id!: string;

  @ApiProperty({
    type: [SubmitAnswerDto],
    description:
      "One entry per question. Duplicate question_id entries are ignored at scoring time; the count must match the total number of questions.",
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SubmitAnswerDto)
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  answers!: SubmitAnswerDto[];
}

export class AttemptQueryDto {
  @ApiPropertyOptional({ example: 1, minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ example: 20, minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @ApiPropertyOptional({ example: true, description: "Filter by submission status" })
  @IsOptional()
  @Transform(({ value }) => {
    if (value === true || value === "true") return true;
    if (value === false || value === "false") return false;
    return undefined;
  })
  @IsBoolean()
  submitted?: boolean;
}
