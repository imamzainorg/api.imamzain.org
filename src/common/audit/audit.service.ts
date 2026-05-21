import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditAction } from './audit.actions';

export interface AuditWriteParams {
  actorId: string | null;
  action: AuditAction;
  resourceType: string;
  resourceId?: string | null;
  changes?: Prisma.InputJsonValue;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/**
 * Centralised audit-log writer. Encapsulates the "write a row, never let an
 * audit failure break the request" policy that every mutation service was
 * inlining (71 call sites, 38 of them with silent empty catches).
 *
 * Failure policy: log a warning and swallow. The mutating request still
 * succeeds. If an audit row matters for compliance (it does for sensitive
 * actions), the caller should check the boolean return value and decide
 * how to react.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Persist a single audit_logs row. Returns true on success, false if the write failed. */
  async write(params: AuditWriteParams): Promise<boolean> {
    try {
      await this.prisma.audit_logs.create({
        data: {
          user_id: params.actorId,
          action: params.action,
          resource_type: params.resourceType,
          resource_id: params.resourceId ?? null,
          changes: params.changes ?? undefined,
          ip_address: params.ipAddress ?? null,
          user_agent: params.userAgent ?? null,
        },
      });
      return true;
    } catch (err) {
      this.logger.warn(`Failed to write ${params.action} audit log: ${err}`);
      return false;
    }
  }
}
