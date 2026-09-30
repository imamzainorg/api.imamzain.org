import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { IsBoolean, IsEmail, IsOptional, IsString, MaxLength } from "class-validator";
import { PaginationDto } from "../../common/dto/pagination.dto";
import { toQueryBoolean } from "../../common/validators/query-boolean";
import { SearchTerm } from "../../common/validators/search-term";

// 254 is the longest address SMTP allows (RFC 5321). Trimmed so a pasted
// trailing space does not create a second, never-confirmable row.
const trimmed = ({ value }: { value: unknown }) => (typeof value === "string" ? value.trim() : value);

export class SubscribeDto {
  @ApiProperty({ example: "reader@example.com", format: "email", maxLength: 254 })
  @Transform(trimmed)
  @IsEmail({}, { message: "Please provide a valid email address" })
  @MaxLength(254)
  email!: string;
}

export class ConfirmSubscriptionDto {
  @ApiProperty({ example: "reader@example.com", format: "email", maxLength: 254 })
  @Transform(trimmed)
  @IsEmail({}, { message: "Please provide a valid email address" })
  @MaxLength(254)
  email!: string;

  @ApiProperty({
    example: "9c1f...e4",
    description:
      "Confirmation token from the link in the confirmation e-mail (the `token` query parameter). Bound to the newest confirmation e-mail sent to that address: requesting a new one invalidates older links.",
  })
  @IsString()
  @MaxLength(256)
  token!: string;
}

export class UnsubscribeDto {
  @ApiProperty({ example: "reader@example.com", format: "email", maxLength: 254 })
  @Transform(trimmed)
  @IsEmail({}, { message: "Please provide a valid email address" })
  @MaxLength(254)
  email!: string;

  @ApiProperty({
    example: "f3a8...c2",
    description:
      "Unsubscribe token from the unsubscribe link in a newsletter e-mail (the `token` query parameter). Required to prove ownership and prevent mass-unsubscribe by email enumeration.",
  })
  @IsString()
  @MaxLength(256)
  token!: string;
}

export class SubscriberQueryDto extends PaginationDto {
  @ApiPropertyOptional({
    example: "reader@example.com",
    description: "Partial email search. 2–200 characters after trimming; a blank value is ignored.",
    minLength: 2,
    maxLength: 200,
  })
  @SearchTerm()
  search?: string;

  @ApiPropertyOptional({ example: true, description: "Filter by active status. Omit to return all." })
  @IsOptional()
  @IsBoolean()
  @Transform(toQueryBoolean)
  is_active?: boolean;
}
