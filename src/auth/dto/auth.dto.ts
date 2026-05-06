import { ApiProperty } from "@nestjs/swagger";
import { IsString, MaxLength, MinLength } from "class-validator";

export class LoginDto {
  @ApiProperty({ example: "admin", minLength: 3, maxLength: 50 })
  @IsString()
  @MinLength(3)
  @MaxLength(50)
  username!: string;

  @ApiProperty({ example: "secret123", minLength: 6 })
  @IsString()
  @MinLength(6)
  password!: string;
}

export class ChangePasswordDto {
  @ApiProperty({ example: "current-secret" })
  @IsString()
  currentPassword!: string;

  @ApiProperty({ example: "new-secret123", minLength: 6 })
  @IsString()
  @MinLength(6)
  newPassword!: string;
}

export class RefreshTokenDto {
  @ApiProperty({ example: "eyJhbGci..." })
  @IsString()
  refresh_token!: string;
}
