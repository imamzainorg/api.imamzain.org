import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsOptional, IsString, MaxLength, MinLength } from "class-validator";

const PASSWORD_MIN = 6;
// Bcrypt truncates to 72 bytes; cap well below to bound work and stop large-input DoS.
const PASSWORD_MAX = 128;

export class LoginDto {
  @ApiProperty({ example: "admin", minLength: 3, maxLength: 50 })
  @IsString()
  @MinLength(3)
  @MaxLength(50)
  username!: string;

  @ApiProperty({ example: "secret123", minLength: PASSWORD_MIN, maxLength: PASSWORD_MAX })
  @IsString()
  @MinLength(PASSWORD_MIN)
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
