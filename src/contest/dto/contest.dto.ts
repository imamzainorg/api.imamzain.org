import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform, Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from "class-validator";
import { PaginationDto } from "../../common/dto/pagination.dto";

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

  @ApiPropertyOptional({
    example: "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
    description:
      "HMAC token returned by POST /start as `attempt_token`. Currently optional for backwards compatibility with frontends that haven't adopted token-binding yet; when present, it must match the server-side HMAC of the attempt_id or the submit is rejected with 401. Future versions will make this required.",
  })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  attempt_token?: string;

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

export class AttemptQueryDto extends PaginationDto {
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
