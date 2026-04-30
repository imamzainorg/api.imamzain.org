import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { PaginationDto } from '../common/dto/pagination.dto';
import { PermissionGuard } from '../common/guards/permission.guard';
import { AuditLogsService } from './audit-logs.service';

@ApiTags('Audit Logs')
@Controller('audit-logs')
@UseGuards(JwtAuthGuard, PermissionGuard)
@ApiBearerAuth('jwt')
export class AuditLogsController {
  constructor(private readonly auditLogsService: AuditLogsService) {}

  @Get()
  @RequirePermission('audit-logs:read')
  @ApiOperation({
    summary: 'List audit logs (paginated)',
    description: 'Requires permission: `audit-logs:read`. Supports filtering by user, action, resource type, and date range.',
  })
  @ApiQuery({ name: 'user_id', required: false, description: 'Filter by user UUID', type: String })
  @ApiQuery({ name: 'action', required: false, description: 'Filter by action name (e.g. NEWSLETTER_SUBSCRIBED)', type: String })
  @ApiQuery({ name: 'resource_type', required: false, description: 'Filter by resource type (e.g. newsletter_subscriber)', type: String })
  @ApiQuery({ name: 'from', required: false, description: 'Start of date range (ISO 8601)', type: String })
  @ApiQuery({ name: 'to', required: false, description: 'End of date range (ISO 8601)', type: String })
  findAll(
    @Query() pagination: PaginationDto,
    @Query('user_id') userId?: string,
    @Query('action') action?: string,
    @Query('resource_type') resourceType?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.auditLogsService.findAll(pagination.page ?? 1, pagination.limit ?? 20, { userId, action, resourceType, from, to });
  }
}
