import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ApiEnvelope, ApiPaginatedData } from '../../common/dto/api-envelope';

class RoleRefDto {
  @ApiProperty({ example: 'uuid-...' })
  id: string;

  @ApiProperty({ example: 'editor' })
  name: string;
}

class UserRoleDto {
  @ApiProperty({ type: RoleRefDto })
  roles: RoleRefDto;
}

class UserSummaryDto {
  @ApiProperty({ example: 'uuid-...' })
  id: string;

  @ApiProperty({ example: 'admin' })
  username: string;

  @ApiProperty({ example: true })
  is_active: boolean;

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
  created_at: string;

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
  updated_at: string;

  @ApiProperty({ type: [UserRoleDto], description: 'Assigned roles' })
  user_roles: UserRoleDto[];
}

class UserListDataDto extends ApiPaginatedData(UserSummaryDto) {}

export class UserListResponseDto extends ApiEnvelope(UserListDataDto, 'Users fetched') {}

class UserDetailDataDto {
  @ApiProperty({ example: 'uuid-...' })
  id: string;

  @ApiProperty({ example: 'admin' })
  username: string;

  @ApiProperty({ example: true })
  is_active: boolean;

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
  created_at: string;

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
  updated_at: string;

  @ApiProperty({ type: [UserRoleDto], description: 'Assigned roles with their permissions' })
  user_roles: UserRoleDto[];

  @ApiProperty({ type: [String], example: ['posts:create', 'posts:update'] })
  permissions: string[];
}

export class UserDetailResponseDto extends ApiEnvelope(UserDetailDataDto, 'User fetched') {}

export class UserCreatedResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
  timestamp: string;

  @ApiProperty({ example: 'User created' })
  message: string;

  @ApiProperty({ type: UserDetailDataDto, description: 'Newly-created user with empty role and permission arrays.' })
  data: UserDetailDataDto;
}

export class UserMessageResponseDto extends ApiEnvelope(null, 'User updated') {}
