import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { buildPaginationMeta } from '../common/utils/pagination.util';

@Injectable()
export class AuditLogsService {
  constructor(private readonly prisma: PrismaService) {}

  async findOne(id: string) {
    const entry = await this.prisma.audit_logs.findUnique({
      where: { id },
      include: { users: { select: { id: true, username: true } } },
    });
    if (!entry) throw new NotFoundException('Audit log entry not found');
    return { message: 'Audit log entry fetched', data: entry };
  }

  async findAll(
    page: number,
    limit: number,
    filters: {
      userId?: string;
      action?: string;
      resourceType?: string;
      resourceId?: string;
      from?: string;
      to?: string;
    },
  ) {
    const skip = (page - 1) * limit;

    const where: Prisma.audit_logsWhereInput = {};
    if (filters.userId) where.user_id = filters.userId;
    if (filters.action) where.action = filters.action;
    if (filters.resourceType) where.resource_type = filters.resourceType;
    if (filters.resourceId) where.resource_id = filters.resourceId;
    if (filters.from || filters.to) {
      const createdAt: Prisma.DateTimeFilter = {};
      if (filters.from) createdAt.gte = new Date(filters.from);
      if (filters.to) createdAt.lte = new Date(filters.to);
      where.created_at = createdAt;
    }

    const [items, total] = await Promise.all([
      this.prisma.audit_logs.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip,
        take: limit,
        include: { users: { select: { id: true, username: true } } },
      }),
      this.prisma.audit_logs.count({ where }),
    ]);

    return {
      message: 'Audit logs fetched',
      data: { items, pagination: buildPaginationMeta(page, limit, total) },
    };
  }
}
