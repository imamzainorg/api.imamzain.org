import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../prisma/prisma.service';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiOperation({ summary: 'API health check (public)', description: 'Returns the overall API status and database connectivity. `status` is `OK` when healthy, `DEGRADED` when the database is unreachable.' })
  async check() {
    let dbStatus: 'healthy' | 'unhealthy' = 'healthy';
    let dbTimestamp = new Date().toISOString();

    try {
      await this.prisma.$queryRaw`SELECT 1`;
      dbTimestamp = new Date().toISOString();
    } catch {
      dbStatus = 'unhealthy';
    }

    const overallStatus = dbStatus === 'healthy' ? 'OK' : 'DEGRADED';

    return {
      message: 'Health check',
      status: overallStatus,
      database: { status: dbStatus, timestamp: dbTimestamp },
      version: '1.0.0',
    };
  }
}
