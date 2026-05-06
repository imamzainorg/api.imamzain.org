import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationMetaDto } from '../../common/dto/api-response.dto';

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

class UserListDataDto {
  @ApiProperty({ type: [UserSummaryDto] })
  items: UserSummaryDto[];

  @ApiProperty({ type: PaginationMetaDto })
  pagination: PaginationMetaDto;
}

export class UserListResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
  timestamp: string;

  @ApiProperty({ example: 'Users fetched' })
  message: string;

  @ApiProperty({ type: UserListDataDto })
  data: UserListDataDto;
}

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

export class UserDetailResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
  timestamp: string;

  @ApiProperty({ example: 'User fetched' })
  message: string;

  @ApiProperty({ type: UserDetailDataDto })
  data: UserDetailDataDto;
}

class UserCreatedDataDto {
  @ApiProperty({ example: 'uuid-...' })
  id: string;

  @ApiProperty({ example: 'newuser' })
  username: string;

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
  created_at: string;
}

export class UserCreatedResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
  timestamp: string;

  @ApiProperty({ example: 'User created' })
  message: string;

  @ApiProperty({ type: UserCreatedDataDto })
  data: UserCreatedDataDto;
}

export class UserMessageResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
  timestamp: string;

  @ApiProperty({ example: 'User updated' })
  message: string;

  @ApiProperty({ type: Object, nullable: true, example: null })
  data: null;
}
