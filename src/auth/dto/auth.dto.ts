import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsOptional, IsString, MaxLength, MinLength } from "class-validator";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "../../common/validators/password-policy";

const PASSWORD_MIN = PASSWORD_MIN_LENGTH;
const PASSWORD_MAX = PASSWORD_MAX_LENGTH;

export class LoginDto {
  @ApiProperty({ example: "admin", minLength: 3, maxLength: 50 })
  @IsString()
  @MinLength(3)
  @MaxLength(50)
  username!: string;

  // No policy minimum here — only a non-empty check. The length floor applies
  // to passwords being SET; enforcing it at login would lock out every account
  // created before the floor was raised.
  @ApiProperty({ example: "correct-horse-battery", maxLength: PASSWORD_MAX })
  @IsString()
  @MinLength(1)
  @MaxLength(PASSWORD_MAX)
  password!: string;
}

export class ChangePasswordDto {
  @ApiProperty({ example: "current-secret", maxLength: PASSWORD_MAX })
  @IsString()
  @MaxLength(PASSWORD_MAX)
  currentPassword!: string;

  @ApiProperty({ example: "new-secret123", minLength: PASSWORD_MIN, maxLength: PASSWORD_MAX })
  @IsString()
  @MinLength(PASSWORD_MIN)
  @MaxLength(PASSWORD_MAX)
  newPassword!: string;
}

export class RefreshTokenDto {
  @ApiProperty({ example: "eyJhbGci..." })
  @IsString()
  @MaxLength(512)
  refresh_token!: string;
}

export class LogoutDto {
  @ApiPropertyOptional({
    example: "eyJhbGci...",
    description: "Specific refresh token to revoke. Omit to revoke all active sessions for the current user.",
  })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  refresh_token?: string;
}
