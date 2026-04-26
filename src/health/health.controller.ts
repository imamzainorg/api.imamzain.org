import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
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
