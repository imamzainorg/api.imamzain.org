import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditAction } from './audit.actions';

/**
 * Retention window for `audit_logs`. One year is long enough to support the
 * usual "what did Alice change last quarter?" auditing flows and a typical
 * external-audit fiscal-year review, while keeping the table bounded so the
 * `idx_audit_logs_created_at` planner cost stays predictable. Lengthen the
 * window if a future compliance requirement (eg. data-residency or longer
 * legal-hold periods) demands it — the cleanup query honours whatever this
 * constant says.
 */
const AUDIT_LOG_RETENTION_DAYS = 365;

export interface AuditWriteParams {
  actorId: string | null;
  action: AuditAction;
  resourceType: string;
  resourceId?: string | null;
  changes?: Prisma.InputJsonValue;
  ipAddress?: string | null;
  userAgent?: string | null;
}

// Deny-list of keys that must never reach the audit_logs.changes JSON.
// Read-side endpoints return `changes` verbatim to anyone with
// `audit-logs:read`, so a future writer that accidentally stuffs a secret
// here would leak it. Stripped recursively before persist.
const FORBIDDEN_KEYS = new Set([
  'password',
  'password_hash',
  'new_password',
  'old_password',
  'token',
  'access_token',
  'refresh_token',
  'secret',
  'api_key',
  'authorization',
]);

export function stripSensitive(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripSensitive);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).flatMap(([k, v]) =>
        FORBIDDEN_KEYS.has(k.toLowerCase()) ? [] : [[k, stripSensitive(v)]],
      ),
    );
  }
  return value;
}

/**
 * Centralised audit-log writer. Encapsulates the "write a row, never let an
 * audit failure break the request" policy that every mutation service was
 * inlining (71 call sites, 38 of them with silent empty catches).
 *
 * Failure policy: log a warning and swallow. The mutating request still
 * succeeds. The DB write is fire-and-forget — the returned promise resolves
 * immediately so the request handler can flush the response without paying a
 * round-trip for the audit row. If an audit row matters for compliance
 * (sensitive actions), call `writeSync` to wait for the persist.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Schedule an audit row and return immediately. The DB write happens on
   * the next tick so request handlers can flush the response without waiting
   * for the audit round-trip. Errors are logged and swallowed.
   */
  write(params: AuditWriteParams): Promise<boolean> {
    setImmediate(() => {
      this.persist(params).catch((err) => {
        this.logger.warn(`Failed to write ${params.action} audit log: ${err}`);
      });
    });
    return Promise.resolve(true);
  }

  /**
   * Persist synchronously. Use only for compliance-critical actions where
   * the caller needs to know the row landed before responding.
   */
  async writeSync(params: AuditWriteParams): Promise<boolean> {
    try {
      await this.persist(params);
      return true;
    } catch (err) {
      this.logger.warn(`Failed to write ${params.action} audit log: ${err}`);
      return false;
    }
  }

  /**
   * Batch-persist many audit rows in one round-trip. Used by bulk operations
   * (publish, delete, restore) so a 200-row batch doesn't issue 200 sequential
   * INSERTs.
   */
  writeMany(paramsList: AuditWriteParams[]): Promise<boolean> {
    if (paramsList.length === 0) return Promise.resolve(true);
    setImmediate(() => {
      this.persistMany(paramsList).catch((err) => {
        this.logger.warn(`Failed to batch-write ${paramsList.length} audit rows: ${err}`);
      });
    });
    return Promise.resolve(true);
  }

  private async persist(params: AuditWriteParams): Promise<void> {
    const safeChanges =
      params.changes === undefined
        ? undefined
        : (stripSensitive(params.changes) as Prisma.InputJsonValue);
    await this.prisma.audit_logs.create({
      data: {
        user_id: params.actorId,
        action: params.action,
        resource_type: params.resourceType,
        resource_id: params.resourceId ?? null,
        changes: safeChanges,
        ip_address: params.ipAddress ?? null,
        user_agent: params.userAgent ?? null,
      },
    });
  }

  private async persistMany(paramsList: AuditWriteParams[]): Promise<void> {
    const data = paramsList.map((params) => ({
      user_id: params.actorId,
      action: params.action,
      resource_type: params.resourceType,
      resource_id: params.resourceId ?? null,
      changes:
        params.changes === undefined
          ? Prisma.JsonNull
          : (stripSensitive(params.changes) as Prisma.InputJsonValue),
      ip_address: params.ipAddress ?? null,
      user_agent: params.userAgent ?? null,
    }));
    await this.prisma.audit_logs.createMany({ data });
  }

  /**
   * Daily retention sweep. Drops audit rows older than the configured window
   * so the table doesn't grow unbounded, which would slowly degrade insert
   * latency and planner cost on `idx_audit_logs_created_at`. Runs at 03:30
   * server time to dodge both daily traffic peaks and the midnight maintenance
   * window other systems tend to occupy.
   */
  @Cron('30 3 * * *')
  async cleanupOldAuditLogs(): Promise<void> {
    const cutoff = new Date(Date.now() - AUDIT_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    try {
      const { count } = await this.prisma.audit_logs.deleteMany({
        where: { created_at: { lt: cutoff } },
      });
      if (count > 0) {
        this.logger.log(
          `Pruned ${count} audit_logs row(s) older than ${AUDIT_LOG_RETENTION_DAYS}d (cutoff ${cutoff.toISOString()})`,
        );
      }
    } catch (err) {
      this.logger.warn(`audit_logs retention sweep failed: ${err}`);
    }
  }
}
