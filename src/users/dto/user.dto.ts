import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import {
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from "class-validator";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "../../common/validators/password-policy";

// Usernames are stored byte-exact, so a stray leading/trailing space would mint
// a look-alike account ("admin" vs "admin "). Passwords are never trimmed.
const trimmed = ({ value }: { value: unknown }) => (typeof value === "string" ? value.trim() : value);

export class CreateUserDto {
  @ApiProperty({ example: "editor01", minLength: 3, maxLength: 50 })
  @Transform(trimmed)
  @IsString()
  @MinLength(3)
  @MaxLength(50)
  username!: string;

  @ApiProperty({ example: "correct-horse-battery", minLength: PASSWORD_MIN_LENGTH, maxLength: PASSWORD_MAX_LENGTH })
  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH)
  @MaxLength(PASSWORD_MAX_LENGTH)
  password!: string;
}

export class UpdateUserDto {
  @ApiPropertyOptional({ example: "editor02", minLength: 3, maxLength: 50 })
  @Transform(trimmed)
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
    description: `New password to assign. Min ${PASSWORD_MIN_LENGTH} chars; bcrypt truncates at 72 bytes so the max is generously bounded.`,
    minLength: PASSWORD_MIN_LENGTH,
    maxLength: PASSWORD_MAX_LENGTH,
  })
  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH)
  @MaxLength(PASSWORD_MAX_LENGTH)
  new_password!: string;
}
