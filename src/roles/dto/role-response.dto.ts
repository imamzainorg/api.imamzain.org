import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ApiEnvelope, ApiPaginatedData } from '../../common/dto/api-envelope';

class RoleTranslationItemDto {
  @ApiProperty({ example: 'ar' })
  lang: string;

  @ApiProperty({ example: 'مدير' })
  title: string;

  @ApiPropertyOptional({ example: 'دور المدير', nullable: true })
  description: string | null;
}

class PermissionTranslationItemDto {
  @ApiProperty({ example: 'ar' })
  lang: string;

  @ApiProperty({ example: 'إنشاء منشور' })
  title: string;

  @ApiPropertyOptional({ example: 'يسمح بإنشاء منشورات جديدة', nullable: true })
  description: string | null;
}

class PermissionDto {
  @ApiProperty({ example: 'uuid-...' })
  id: string;

  @ApiProperty({ example: 'posts:create' })
  name: string;

  @ApiProperty({ type: [PermissionTranslationItemDto], description: 'All stored translations for this permission' })
  permission_translations: PermissionTranslationItemDto[];

  @ApiPropertyOptional({
    type: PermissionTranslationItemDto,
    nullable: true,
    description: 'Resolved translation for the requested Accept-Language header, with fallback to the first available translation. Null when the permission has no translations.',
  })
  translation: PermissionTranslationItemDto | null;
}

class RoleDto {
  @ApiProperty({ example: 'uuid-...' })
  id: string;

  @ApiProperty({ example: 'admin' })
  name: string;

  @ApiProperty({ type: [RoleTranslationItemDto], description: 'All stored translations for this role' })
  role_translations: RoleTranslationItemDto[];

  @ApiPropertyOptional({
    type: RoleTranslationItemDto,
    nullable: true,
    description: 'Resolved translation for the requested Accept-Language header, with fallback to the first available translation. Null when the role has no translations.',
  })
  translation: RoleTranslationItemDto | null;

  @ApiProperty({ type: [PermissionDto], description: 'Flat list of all permissions granted to this role (the role_permissions join table is unwrapped server-side).' })
  permissions: PermissionDto[];
}

class RoleListDataDto extends ApiPaginatedData(RoleDto) {}

export class RoleListResponseDto extends ApiEnvelope(RoleListDataDto, 'Roles fetched') {}

export class RoleDetailResponseDto extends ApiEnvelope(RoleDto, 'Role fetched') {}

export class RoleCreatedResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
  timestamp: string;

  @ApiProperty({ example: 'Role created' })
  message: string;

  @ApiProperty({ type: RoleDto, description: 'Newly-created role with its translations and (initially empty) permissions array.' })
  data: RoleDto;
}

export class RoleMessageResponseDto extends ApiEnvelope(null, 'Role deleted') {}

class PermissionListDataDto extends ApiPaginatedData(PermissionDto) {}

export class PermissionListResponseDto extends ApiEnvelope(PermissionListDataDto, 'Permissions fetched') {}
