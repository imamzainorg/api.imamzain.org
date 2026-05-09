import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { ForbiddenErrorDto, UnauthorizedErrorDto } from '../common/dto/api-response.dto';
import { PermissionGuard } from '../common/guards/permission.guard';
import { AuditLogsService } from './audit-logs.service';
import { AuditLogQueryDto } from './dto/audit-log-query.dto';
import { AuditLogListResponseDto } from './dto/audit-log-response.dto';

@ApiTags('Audit Logs')
@Controller('audit-logs')
@UseGuards(JwtAuthGuard, PermissionGuard)
@ApiBearerAuth('jwt')
@ApiUnauthorizedResponse({ type: UnauthorizedErrorDto, description: 'Missing or invalid JWT' })
@ApiForbiddenResponse({ type: ForbiddenErrorDto, description: 'Insufficient permissions' })
export class AuditLogsController {
  constructor(private readonly auditLogsService: AuditLogsService) {}

  @Get()
  @RequirePermission('audit-logs:read')
  @ApiOperation({
    summary: 'List audit logs (paginated)',
    description:
      'Requires permission: `audit-logs:read`. Supports filtering by user, action, resource type, and date range.',
  })
  @ApiOkResponse({ type: AuditLogListResponseDto, description: 'Paginated list of audit logs' })
  findAll(@Query() query: AuditLogQueryDto) {
    return this.auditLogsService.findAll(query.page ?? 1, query.limit ?? 20, {
      userId: query.user_id,
      action: query.action,
      resourceType: query.resource_type,
      from: query.from,
      to: query.to,
    });
  }
}
