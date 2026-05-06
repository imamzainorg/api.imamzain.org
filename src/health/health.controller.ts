import { Controller, Get } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { PrismaService } from "../prisma/prisma.service";
import { R2Service } from "../storage/r2.service";
import { HealthResponseDto } from "./dto/health-response.dto";

@ApiTags("Health")
@Controller("health")
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly r2: R2Service,
  ) {}

  @Get()
  @ApiOperation({
    summary: "API health check (public)",
    description:
      "Returns the overall API status, database connectivity, and storage connectivity. `status` is `OK` when all checks pass, `DEGRADED` when one or more are unhealthy.",
  })
  @ApiOkResponse({ type: HealthResponseDto, description: "API status and dependency health" })
  async check() {
    const [dbResult, r2Result] = await Promise.allSettled([
      this.prisma.$queryRaw`SELECT 1`,
      this.r2.checkConnectivity(),
    ]);

    const dbStatus = dbResult.status === "fulfilled" ? "healthy" : "unhealthy";
    const r2Status =
      r2Result.status === "fulfilled" && r2Result.value ? "healthy" : "unhealthy";

    const overallStatus = dbStatus === "healthy" && r2Status === "healthy" ? "OK" : "DEGRADED";

    return {
      message: "Health check",
      status: overallStatus,
      database: { status: dbStatus, timestamp: new Date().toISOString() },
      storage: { status: r2Status, timestamp: new Date().toISOString() },
      version: "1.0.0",
    };
  }
}
