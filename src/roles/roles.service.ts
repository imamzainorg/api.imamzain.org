import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AssignPermissionDto, CreateRoleDto, UpdateRoleDto } from './dto/role.dto';

@Injectable()
export class RolesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(lang: string | null, page: number, limit: number) {
    const skip = (page - 1) * limit;
    const [roles, total] = await Promise.all([
      this.prisma.roles.findMany({
        include: {
          role_translations: lang ? { where: { lang } } : true,
          role_permissions: {
            include: {
              permissions: {
                include: { permission_translations: lang ? { where: { lang } } : true },
              },
            },
          },
        },
        skip,
        take: limit,
      }),
      this.prisma.roles.count(),
    ]);
    return { message: 'Roles fetched', data: { items: roles, pagination: { page, limit, total, pages: Math.ceil(total / limit) } } };
  }

  async findOne(id: string, lang: string | null) {
    const role = await this.prisma.roles.findUnique({
      where: { id },
      include: {
        role_translations: lang ? { where: { lang } } : true,
        role_permissions: {
          include: {
            permissions: {
              include: { permission_translations: lang ? { where: { lang } } : true },
            },
          },
        },
      },
    });
    if (!role) throw new NotFoundException('Role not found');
    return { message: 'Role fetched', data: role };
  }

  async create(dto: CreateRoleDto, actorId: string) {
    const existing = await this.prisma.roles.findFirst({ where: { name: dto.name } });
    if (existing) throw new ConflictException('A role with that name already exists');

    const role = await this.prisma.$transaction(async (tx) => {
      const created = await tx.roles.create({ data: { name: dto.name } });
      await tx.role_translations.createMany({
        data: dto.translations.map((t) => ({
          role_id: created.id,
          lang: t.lang,
          title: t.title,
          description: t.description ?? null,
        })),
      });
      return created;
    });

    try {
      await this.prisma.audit_logs.create({
        data: {
          user_id: actorId,
          action: 'ROLE_CREATED',
          resource_type: 'role',
          resource_id: role.id,
          changes: { method: 'POST', path: '/api/v1/roles' },
        },
      });
    } catch {}

    return { message: 'Role created', data: role };
  }

  async update(id: string, dto: UpdateRoleDto, actorId: string) {
    const role = await this.prisma.roles.findUnique({ where: { id } });
    if (!role) throw new NotFoundException('Role not found');

    if (dto.name && dto.name !== role.name) {
      const conflict = await this.prisma.roles.findFirst({ where: { name: dto.name } });
      if (conflict) throw new ConflictException('A role with that name already exists');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const r = await tx.roles.update({
        where: { id },
        data: dto.name ? { name: dto.name } : {},
      });

      if (dto.translations) {
        for (const t of dto.translations) {
          await tx.role_translations.upsert({
            where: { role_id_lang: { role_id: id, lang: t.lang } },
            create: { role_id: id, lang: t.lang, title: t.title, description: t.description ?? null },
            update: { title: t.title, description: t.description ?? null },
          });
        }
      }
      return r;
    });

    try {
      await this.prisma.audit_logs.create({
        data: {
          user_id: actorId,
          action: 'ROLE_UPDATED',
          resource_type: 'role',
          resource_id: id,
          changes: { method: 'PATCH', path: `/api/v1/roles/${id}` },
        },
      });
    } catch {}

    return { message: 'Role updated', data: updated };
  }

  async delete(id: string, actorId: string) {
    // Move the assignment check inside the transaction so a concurrent
    // assignRole call between count and delete cannot orphan the user_roles
    // row via the Cascade delete.
    await this.prisma.$transaction(async (tx) => {
      const role = await tx.roles.findUnique({ where: { id } });
      if (!role) throw new NotFoundException('Role not found');

      const assigned = await tx.user_roles.count({ where: { role_id: id } });
      if (assigned > 0) {
        throw new ConflictException('Cannot delete a role that is assigned to users');
      }

      await tx.role_permissions.deleteMany({ where: { role_id: id } });
      await tx.role_translations.deleteMany({ where: { role_id: id } });
      await tx.roles.delete({ where: { id } });
    });

    try {
      await this.prisma.audit_logs.create({
        data: {
          user_id: actorId,
          action: 'ROLE_DELETED',
          resource_type: 'role',
          resource_id: id,
          changes: { method: 'DELETE', path: `/api/v1/roles/${id}` },
        },
      });
    } catch {}

    return { message: 'Role deleted', data: null };
  }

  async assignPermission(roleId: string, dto: AssignPermissionDto, actorId: string) {
    const role = await this.prisma.roles.findUnique({ where: { id: roleId } });
    if (!role) throw new NotFoundException('Role not found');

    await this.prisma.role_permissions.upsert({
      where: { role_id_permission_id: { role_id: roleId, permission_id: dto.permissionId } },
      create: { role_id: roleId, permission_id: dto.permissionId },
      update: {},
    });

    try {
      await this.prisma.audit_logs.create({
        data: {
          user_id: actorId,
          action: 'PERMISSION_ASSIGNED_TO_ROLE',
          resource_type: 'role',
          resource_id: roleId,
          changes: { method: 'POST', path: `/api/v1/roles/${roleId}/permissions`, permissionId: dto.permissionId },
        },
      });
    } catch {}

    return { message: 'Permission assigned', data: null };
  }

  async removePermission(roleId: string, permissionId: string, actorId: string) {
    const role = await this.prisma.roles.findUnique({ where: { id: roleId } });
    if (!role) throw new NotFoundException('Role not found');

    const result = await this.prisma.role_permissions.deleteMany({
      where: { role_id: roleId, permission_id: permissionId },
    });
    if (result.count === 0) {
      throw new NotFoundException('Permission is not assigned to this role');
    }

    try {
      await this.prisma.audit_logs.create({
        data: {
          user_id: actorId,
          action: 'PERMISSION_REMOVED_FROM_ROLE',
          resource_type: 'role',
          resource_id: roleId,
          changes: { method: 'DELETE', path: `/api/v1/roles/${roleId}/permissions/${permissionId}`, permissionId },
        },
      });
    } catch {}

    return { message: 'Permission removed', data: null };
  }

  async findAllPermissions(lang: string | null, page: number, limit: number) {
    const skip = (page - 1) * limit;
    const [permissions, total] = await Promise.all([
      this.prisma.permissions.findMany({
        include: { permission_translations: lang ? { where: { lang } } : true },
        skip,
        take: limit,
      }),
      this.prisma.permissions.count(),
    ]);
    return { message: 'Permissions fetched', data: { items: permissions, pagination: { page, limit, total, pages: Math.ceil(total / limit) } } };
  }
}
