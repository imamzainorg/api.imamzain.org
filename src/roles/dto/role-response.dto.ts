import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationMetaDto } from '../../common/dto/api-response.dto';

class RoleTranslationItemDto {
  @ApiProperty({ example: 'ar' })
  lang: string;

  @ApiProperty({ example: 'مدير' })
  title: string;

  @ApiPropertyOptional({ example: 'دور المدير' })
  description?: string;
}

class PermissionDto {
  @ApiProperty({ example: 'uuid-...' })
  id: string;

  @ApiProperty({ example: 'posts:create' })
  name: string;
}

class RoleDto {
  @ApiProperty({ example: 'uuid-...' })
  id: string;

  @ApiProperty({ example: 'admin' })
  name: string;

  @ApiProperty({ type: [RoleTranslationItemDto] })
  role_translations: RoleTranslationItemDto[];

  @ApiProperty({ type: [PermissionDto] })
  permissions: PermissionDto[];
}

class RoleListDataDto {
  @ApiProperty({ type: [RoleDto] })
  items: RoleDto[];

  @ApiProperty({ type: PaginationMetaDto })
  pagination: PaginationMetaDto;
}

export class RoleListResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
  timestamp: string;

  @ApiProperty({ example: 'Roles fetched' })
  message: string;

  @ApiProperty({ type: RoleListDataDto })
  data: RoleListDataDto;
}

export class RoleDetailResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
  timestamp: string;

  @ApiProperty({ example: 'Role fetched' })
  message: string;

  @ApiProperty({ type: RoleDto })
  data: RoleDto;
}

class RoleCreatedDataDto {
  @ApiProperty({ example: 'uuid-...' })
  id: string;

  @ApiProperty({ example: 'editor' })
  name: string;

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
  created_at: string;
}

export class RoleCreatedResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
  timestamp: string;

  @ApiProperty({ example: 'Role created' })
  message: string;

  @ApiProperty({ type: RoleCreatedDataDto })
  data: RoleCreatedDataDto;
}

export class RoleMessageResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
  timestamp: string;

  @ApiProperty({ example: 'Role updated' })
  message: string;

  @ApiProperty({ type: Object, nullable: true, example: null })
  data: null;
}

class PermissionListDataDto {
  @ApiProperty({ type: [PermissionDto] })
  items: PermissionDto[];

  @ApiProperty({ type: PaginationMetaDto })
  pagination: PaginationMetaDto;
}

export class PermissionListResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
  timestamp: string;

  @ApiProperty({ example: 'Permissions fetched' })
  message: string;

  @ApiProperty({ type: PermissionListDataDto })
  data: PermissionListDataDto;
}
