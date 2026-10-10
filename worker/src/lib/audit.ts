import type { Context } from 'hono';
import type { Prisma } from '../generated/prisma/client';
import { defer, getDb } from './db';
import type { AuditAction } from './audit-actions';
import type { AppEnv } from './types';

export { AUDIT_ACTIONS } from './audit-actions';
export type { AuditAction } from './audit-actions';

export interface AuditWriteParams {
  /** Defaults to the authenticated user; pass `null` for anonymous actions (failed logins). */
  actorId?: string | null;
  action: AuditAction;
  resourceType: string;
  resourceId?: string | null;
  changes?: Prisma.InputJsonValue;
}

// Keys that must never reach audit_logs.changes: the read side returns it verbatim to `audit-logs:read`.
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
      Object.entries(value as Record<string, unknown>).flatMap(([k, v]) => (FORBIDDEN_KEYS.has(k.toLowerCase()) ? [] : [[k, stripSensitive(v)]])),
    );
  }
  return value;
}

function row(c: Context<AppEnv>, p: AuditWriteParams) {
  return {
    user_id: p.actorId !== undefined ? p.actorId : (c.get('user')?.id ?? null),
    action: p.action,
    resource_type: p.resourceType,
    resource_id: p.resourceId ?? null,
    changes: p.changes === undefined ? undefined : (stripSensitive(p.changes) as Prisma.InputJsonValue),
    ip_address: c.get('ip') || null,
    user_agent: c.req.header('user-agent') || null,
  };
}

/** Fire-and-forget audit row via `waitUntil`; a failure is logged and never breaks the request. */
export function audit(c: Context<AppEnv>, params: AuditWriteParams): void {
  defer(c, getDb(c).audit_logs.create({ data: row(c, params) }));
}

/** Batch form for bulk publish / delete / restore: one INSERT. */
export function auditMany(c: Context<AppEnv>, list: AuditWriteParams[]): void {
  if (list.length === 0) return;
  defer(c, getDb(c).audit_logs.createMany({ data: list.map((p) => row(c, p)) }));
}

/** Compliance-critical actions: wait for the row; returns false (and logs) if it didn't land. */
export async function auditSync(c: Context<AppEnv>, params: AuditWriteParams): Promise<boolean> {
  try {
    await getDb(c).audit_logs.create({ data: row(c, params) });
    return true;
  } catch (err) {
    console.warn(`Failed to write an audit log for ${params.resourceType} ${params.resourceId ?? '-'}: ${err}`);
    return false;
  }
}
