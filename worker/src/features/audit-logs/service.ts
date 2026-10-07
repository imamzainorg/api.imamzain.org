import type { Context } from 'hono';
import type { Prisma } from '../../generated/prisma/client';
import { getDb } from '../../lib/db';
import { notFound } from '../../lib/errors';
import { buildPaginationMeta } from '../../lib/pagination';
import type { AppEnv } from '../../lib/types';
import type { AuditLogQuery } from './schemas';

type Ctx = Context<AppEnv>;

const WITH_USER = { users: { select: { id: true, username: true } } } as const;

export async function findOne(c: Ctx, id: string) {
  const entry = await getDb(c).audit_logs.findUnique({ where: { id }, include: WITH_USER });
  if (!entry) throw notFound('Audit log entry not found');
  return { message: 'Audit log entry fetched', data: entry };
}

export async function findAll(c: Ctx, query: AuditLogQuery) {
  const db = getDb(c);
  const { page, limit } = query;
  const where: Prisma.audit_logsWhereInput = {};
  if (query.user_id) where.user_id = query.user_id;
  if (query.action) where.action = query.action;
  if (query.resource_type) where.resource_type = query.resource_type;
  if (query.resource_id) where.resource_id = query.resource_id;
  if (query.from || query.to) {
    const createdAt: Prisma.DateTimeFilter = {};
    if (query.from) createdAt.gte = new Date(query.from);
    if (query.to) createdAt.lte = new Date(query.to);
    where.created_at = createdAt;
  }

  const [items, total] = await Promise.all([
    db.audit_logs.findMany({
      where,
      orderBy: [{ created_at: 'desc' }, { id: 'asc' }],
      skip: (page - 1) * limit,
      take: limit,
      include: WITH_USER,
    }),
    db.audit_logs.count({ where }),
  ]);

  return { message: 'Audit logs fetched', data: { items, pagination: buildPaginationMeta(page, limit, total) } };
}
