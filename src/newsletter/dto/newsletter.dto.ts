import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { IsBoolean, IsEmail, IsOptional, IsString } from "class-validator";
import { PaginationDto } from "../../common/dto/pagination.dto";

export class SubscribeDto {
  @ApiProperty({ example: "reader@example.com", format: "email" })
  @IsEmail({}, { message: "Please provide a valid email address" })
  email!: string;
}

export class UnsubscribeDto {
  @ApiProperty({ example: "reader@example.com", format: "email" })
  @IsEmail({}, { message: "Please provide a valid email address" })
  email!: string;
}

export class SubscriberQueryDto extends PaginationDto {
  @ApiPropertyOptional({ example: "reader@example.com", description: "Partial email search" })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ example: true, description: "Filter by active status. Omit to return all." })
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  })
  is_active?: boolean;
}
