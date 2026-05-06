import { ApiProperty } from '@nestjs/swagger';

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

export class LoginResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
  timestamp: string;

  @ApiProperty({ example: 'Login successful' })
  message: string;

  @ApiProperty({ type: LoginDataDto })
  data: LoginDataDto;
}

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

export class MeResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
  timestamp: string;

  @ApiProperty({ example: 'Profile fetched' })
  message: string;

  @ApiProperty({ type: MeDataDto })
  data: MeDataDto;
}

export class ChangePasswordResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
  timestamp: string;

  @ApiProperty({ example: 'Password changed successfully' })
  message: string;

  @ApiProperty({ type: Object, nullable: true, example: null })
  data: null;
}

class RefreshDataDto {
  @ApiProperty({ example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' })
  accessToken: string;

  @ApiProperty({ example: 'eyJhbGci...' })
  refresh_token: string;
}

export class RefreshResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
  timestamp: string;

  @ApiProperty({ example: 'Tokens refreshed' })
  message: string;

  @ApiProperty({ type: RefreshDataDto })
  data: RefreshDataDto;
}

export class LogoutResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
  timestamp: string;

  @ApiProperty({ example: 'Logged out successfully' })
  message: string;

  @ApiProperty({ type: Object, nullable: true, example: null })
  data: null;
}
