import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from "class-validator";

export class CreateUserDto {
  @ApiProperty({ example: "editor01", minLength: 3, maxLength: 50 })
  @IsString()
  @MinLength(3)
  @MaxLength(50)
  username!: string;

  @ApiProperty({ example: "secret123", minLength: 6 })
  @IsString()
  @MinLength(6)
  password!: string;
}

export class UpdateUserDto {
  @ApiPropertyOptional({ example: "editor02", minLength: 3, maxLength: 50 })
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(50)
  username?: string;
}

export class AssignRoleDto {
  @ApiProperty({
    example: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    format: "uuid",
  })
  @IsUUID()
  role_id!: string;
}

export class AdminResetPasswordDto {
  @ApiProperty({
    example: "new-strong-password",
    description: "New password to assign. Min 6 chars; bcrypt truncates at 72 bytes so the max is generously bounded.",
    minLength: 6,
    maxLength: 128,
  })
  @IsString()
  @MinLength(6)
  @MaxLength(128)
  new_password!: string;
}
