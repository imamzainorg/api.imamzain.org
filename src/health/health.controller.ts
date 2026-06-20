import { Controller, Get } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { PrismaService } from "../prisma/prisma.service";
import { R2Service } from "../storage/r2.service";
import { HealthResponseDto } from "./dto/health-response.dto";

const R2_CACHE_TTL_MS = 60_000;
// A health check that can hang defeats its purpose — orchestrators/LBs reading
// /health would stall instead of seeing DEGRADED. Neither the Prisma query nor
// the R2 probe has its own short timeout, so bound each one here.
const HEALTH_CHECK_TIMEOUT_MS = 2_500;

function withTimeout<T>(promise: Promise<T>, ms: number, onTimeout: T): Promise<T> {
  return new Promise<T>((resolve) => {
    const timer = setTimeout(() => resolve(onTimeout), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      () => {
        clearTimeout(timer);
        resolve(onTimeout);
      },
    );
  });
}

@ApiTags("Health")
@Controller("health")
export class HealthController {
  private r2Cache: { status: "healthy" | "unhealthy"; checkedAt: number } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly r2: R2Service,
  ) {}

  @Get()
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  @ApiOperation({
    summary: "API health check (public)",
    description:
      "Returns the overall API status, database connectivity, and storage connectivity. " +
      "`status` is `OK` when all checks pass, `DEGRADED` when one or more are unhealthy. " +
      "Storage status is cached for 60s to avoid amplifying load on the object store.",
  })
  @ApiOkResponse({ type: HealthResponseDto, description: "API status and dependency health" })
  async check() {
    const dbResult = await withTimeout(
      this.prisma.$queryRaw`SELECT 1`.then(
        () => "healthy" as const,
        () => "unhealthy" as const,
      ),
      HEALTH_CHECK_TIMEOUT_MS,
      "unhealthy",
    );

    const r2Status = await this.getCachedR2Status();
    const overallStatus = dbResult === "healthy" && r2Status === "healthy" ? "OK" : "DEGRADED";

    return {
      message: "Health check",
      status: overallStatus,
      database: { status: dbResult, timestamp: new Date().toISOString() },
      storage: { status: r2Status, timestamp: new Date(this.r2Cache?.checkedAt ?? Date.now()).toISOString() },
      version: "1.0.0",
    };
  }

  private async getCachedR2Status(): Promise<"healthy" | "unhealthy"> {
    const now = Date.now();
    if (this.r2Cache && now - this.r2Cache.checkedAt < R2_CACHE_TTL_MS) {
      return this.r2Cache.status;
    }
    const ok = await withTimeout(this.r2.checkConnectivity(), HEALTH_CHECK_TIMEOUT_MS, false);
    this.r2Cache = { status: ok ? "healthy" : "unhealthy", checkedAt: now };
    return this.r2Cache.status;
  }
}
