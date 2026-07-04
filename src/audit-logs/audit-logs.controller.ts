import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { Auth } from '../common/decorators/auth.decorator';
import { NotFoundErrorDto, ValidationErrorDto } from '../common/dto/api-response.dto';
import { AuditLogsService } from './audit-logs.service';
import { AuditLogQueryDto } from './dto/audit-log-query.dto';
import { AuditLogListResponseDto, AuditLogResponseDto } from './dto/audit-log-response.dto';

@ApiTags('Audit Logs')
@Controller('audit-logs')
export class AuditLogsController {
  constructor(private readonly auditLogsService: AuditLogsService) {}

  @Get()
  @Auth('audit-logs:read')
  @ApiOperation({
    summary: 'List audit logs (paginated)',
    description:
      'Requires permission: `audit-logs:read`. Supports filtering by user, action, resource type, and date range.',
  })
  @ApiOkResponse({ type: AuditLogListResponseDto, description: 'Paginated list of audit logs' })
  @ApiBadRequestResponse({ type: ValidationErrorDto, description: 'Invalid query parameters (bad UUID, malformed ISO date, page < 1, or limit out of 1–100)' })
  findAll(@Query() query: AuditLogQueryDto) {
    return this.auditLogsService.findAll(query.page ?? 1, query.limit ?? 20, {
      userId: query.user_id,
      action: query.action,
      resourceType: query.resource_type,
      resourceId: query.resource_id,
      from: query.from,
      to: query.to,
    });
  }

  @Get(':id')
  @Auth('audit-logs:read')
  @ApiOperation({
    summary: 'Get a single audit log entry by ID',
    description:
      'Returns one audit row with the originating user inlined. Useful as a deep-link target from the activity-feed UI. Requires permission: `audit-logs:read`.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: AuditLogResponseDto, description: 'Audit log entry' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No audit log entry with that ID exists' })
  findOne(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.auditLogsService.findOne(id);
  }
}
