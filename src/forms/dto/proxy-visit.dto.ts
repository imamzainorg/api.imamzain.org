import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  MinLength,
} from "class-validator";

export class CreateProxyVisitDto {
  @ApiProperty({
    example: "Ali Hassan Al-Karbalayi",
    minLength: 2,
    maxLength: 100,
  })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  visitor_name!: string;

  @ApiProperty({
    example: "+9647801234567",
    description: "E.164 format required (e.g. +9647801234567)",
  })
  @IsString()
  @Matches(/^\+[1-9]\d{1,14}$/, {
    message: "Phone must be in E.164 format e.g. +9647801234567",
  })
  visitor_phone!: string;

  @ApiProperty({
    example: "IQ",
    minLength: 2,
    maxLength: 2,
    description: "ISO 3166-1 alpha-2 country code (uppercase)",
  })
  @IsString()
  @Length(2, 2)
  @Matches(/^[A-Z]{2}$/)
  visitor_country!: string;
}

export class UpdateProxyVisitDto {
  @ApiPropertyOptional({
    enum: ["PENDING", "APPROVED", "COMPLETED", "REJECTED"],
    example: "APPROVED",
  })
  @IsOptional()
  @IsIn(["PENDING", "APPROVED", "COMPLETED", "REJECTED"])
  status?: string;

  @ApiPropertyOptional({
    example: "2025-01-15T14:30:00Z",
    description: "ISO 8601 timestamp; defaults to now if omitted",
  })
  @IsOptional()
  @IsISO8601()
  processed_at?: string;
}
