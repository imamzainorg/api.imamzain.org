import { ApiProperty } from '@nestjs/swagger';
import { ApiEnvelope } from '../../common/dto/api-envelope';

class LoginUserDto {
  @ApiProperty({ example: 'uuid-...' })
  id: string;

  @ApiProperty({ example: 'admin' })
  username: string;

  @ApiProperty({ type: [String], example: ['admin'] })
  roles: string[];

  @ApiProperty({ type: [String], example: ['post:create', 'post:delete'] })
  permissions: string[];
}

class LoginDataDto {
  @ApiProperty({ example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' })
  accessToken: string;

  @ApiProperty({ example: 'eyJhbGci...' })
  refresh_token: string;

  @ApiProperty({ type: LoginUserDto })
  user: LoginUserDto;
}

export class LoginResponseDto extends ApiEnvelope(LoginDataDto, 'Login successful') {}

class MeDataDto {
  @ApiProperty({ example: 'uuid-...' })
  id: string;

  @ApiProperty({ example: 'admin' })
  username: string;

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
  created_at: string;

  @ApiProperty({ type: [String], example: ['admin'] })
  roles: string[];

  @ApiProperty({ type: [String], example: ['post:create'] })
  permissions: string[];
}

export class MeResponseDto extends ApiEnvelope(MeDataDto, 'Profile fetched') {}

export class ChangePasswordResponseDto extends ApiEnvelope(null, 'Password changed successfully') {}

class RefreshDataDto {
  @ApiProperty({ example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' })
  accessToken: string;

  @ApiProperty({ example: 'eyJhbGci...' })
  refresh_token: string;
}

export class RefreshResponseDto extends ApiEnvelope(RefreshDataDto, 'Tokens refreshed') {}

export class LogoutResponseDto extends ApiEnvelope(null, 'Logged out successfully') {}
