import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Auth } from '../common/decorators/auth.decorator';
import { DashboardService } from './dashboard.service';
import { DashboardStatsResponseDto } from './dto/dashboard-response.dto';

@ApiTags('Dashboard')
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly service: DashboardService) {}

  @Get('stats')
  @Auth('dashboard:read')
  @ApiOperation({
    summary: 'Aggregated counts for the CMS home screen',
    description:
      'Single round-trip with all the headline counts a CMS dashboard needs: posts (total / published / drafts / recent), library (books / papers / gallery / media), users, newsletter (active / inactive / recent), forms (open + recent), and contest. The "recent" buckets use a 7-day window.\n\n' +
      '**Cached in-process for 30 seconds.** Polling more frequently than the cache TTL returns the same JSON. The CMS should not poll faster than once every 30 s. ' +
      'Requires permission: `dashboard:read`.',
  })
  @ApiOkResponse({ type: DashboardStatsResponseDto, description: 'Aggregated stats' })
  getStats() {
    return this.service.getStats();
  }
}
