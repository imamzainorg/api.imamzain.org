import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationMetaDto } from '../../common/dto/api-response.dto';

class AuditLogUserDto {
  @ApiProperty({ example: 'uuid-...' })
  id: string;

  @ApiProperty({ example: 'admin' })
  username: string;
}

class AuditLogDto {
  @ApiProperty({ example: 'uuid-...' })
  id: string;

  @ApiProperty({ example: 'uuid-...' })
  user_id: string;

  @ApiProperty({ example: 'USER_LOGIN' })
  action: string;

  @ApiProperty({ example: 'user' })
  resource_type: string;

  @ApiProperty({ example: 'uuid-...' })
  resource_id: string;

  @ApiPropertyOptional({ example: '192.168.1.1' })
  ip_address?: string;

  @ApiPropertyOptional({ example: 'Mozilla/5.0...' })
  user_agent?: string;

  @ApiPropertyOptional({ example: { method: 'POST', path: '/api/v1/auth/login' } })
  changes?: Record<string, any>;

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
  created_at: string;

  @ApiPropertyOptional({ type: AuditLogUserDto, nullable: true })
  users: AuditLogUserDto | null;
}

class AuditLogListDataDto {
  @ApiProperty({ type: [AuditLogDto] })
  items: AuditLogDto[];

  @ApiProperty({ type: PaginationMetaDto })
  pagination: PaginationMetaDto;
}

export class AuditLogListResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
  timestamp: string;

  @ApiProperty({ example: 'Audit logs fetched' })
  message: string;

  @ApiProperty({ type: AuditLogListDataDto })
  data: AuditLogListDataDto;
}
