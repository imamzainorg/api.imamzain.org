import { Controller, Get, UseGuards } from '@nestjs/common';
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
import { DashboardService } from './dashboard.service';
import { DashboardStatsResponseDto } from './dto/dashboard-response.dto';

@ApiTags('Dashboard')
@Controller('dashboard')
@UseGuards(JwtAuthGuard, PermissionGuard)
@ApiBearerAuth('jwt')
@ApiUnauthorizedResponse({ type: UnauthorizedErrorDto, description: 'Missing or invalid JWT' })
@ApiForbiddenResponse({ type: ForbiddenErrorDto, description: 'Insufficient permissions' })
export class DashboardController {
  constructor(private readonly service: DashboardService) {}

  @Get('stats')
  @RequirePermission('dashboard:read')
  @ApiOperation({
    summary: 'Aggregated counts for the CMS home screen',
    description:
      'Single round-trip with all the headline counts a CMS dashboard needs: posts (total / published / drafts / recent), library (books / papers / gallery / media), users, newsletter (active / inactive / recent), forms (open + recent), and contest. The "recent" buckets use a 7-day window. Requires permission: `dashboard:read`.',
  })
  @ApiOkResponse({ type: DashboardStatsResponseDto, description: 'Aggregated stats' })
  getStats() {
    return this.service.getStats();
  }
}
