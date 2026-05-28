import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import { AUDIT_ACTIONS } from '../common/audit/audit.actions';
import { buildPaginationMeta } from '../common/utils/pagination.util';
import { resolveTranslation } from '../common/utils/translation.util';
import { AssignPermissionDto, CreateRoleDto, UpdateRoleDto } from './dto/role.dto';

const ROLE_DETAIL_INCLUDE = {
  role_translations: true,
  role_permissions: {
    include: {
      permissions: {
        include: { permission_translations: true },
      },
    },
  },
} satisfies Prisma.rolesInclude;

type RoleWithRelations = Prisma.rolesGetPayload<{ include: typeof ROLE_DETAIL_INCLUDE }>;

/**
 * Shape a role row + its joins into the public response: flat `permissions[]`
 * (the `role_permissions` join table is an implementation detail callers
 * shouldn't have to walk), plus an Accept-Language-resolved `translation`
 * field on both the role and each of its permissions.
 */
function shapeRole(role: RoleWithRelations, lang: string | null) {
  return {
    id: role.id,
    name: role.name,
    role_translations: role.role_translations,
    translation: resolveTranslation(role.role_translations, lang),
    permissions: role.role_permissions.map((rp) => ({
      id: rp.permissions.id,
      name: rp.permissions.name,
      permission_translations: rp.permissions.permission_translations,
      translation: resolveTranslation(rp.permissions.permission_translations, lang),
    })),
  };
}

@Injectable()
export class RolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async hydrateRole(id: string, lang: string | null) {
    const role = await this.prisma.roles.findUnique({
      where: { id },
      include: ROLE_DETAIL_INCLUDE,
    });
    if (!role) throw new NotFoundException('Role not found');
    return shapeRole(role, lang);
  }

  async findAll(lang: string | null, page: number, limit: number) {
    const skip = (page - 1) * limit;
    const [roles, total] = await Promise.all([
      this.prisma.roles.findMany({
        include: ROLE_DETAIL_INCLUDE,
        skip,
        take: limit,
      }),
      this.prisma.roles.count(),
    ]);
    return {
      message: 'Roles fetched',
      data: {
        items: roles.map((r) => shapeRole(r, lang)),
        pagination: buildPaginationMeta(page, limit, total),
      },
    };
  }

  async findOne(id: string, lang: string | null) {
    return { message: 'Role fetched', data: await this.hydrateRole(id, lang) };
  }

  async create(dto: CreateRoleDto, actorId: string, lang: string | null) {
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

    await this.audit.write({
      actorId,
      action: AUDIT_ACTIONS.ROLE_CREATED,
      resourceType: 'role',
      resourceId: role.id,
      changes: { method: 'POST', path: '/api/v1/roles' },
    });

    return { message: 'Role created', data: await this.hydrateRole(role.id, lang) };
  }

  async update(id: string, dto: UpdateRoleDto, actorId: string, lang: string | null) {
    const role = await this.prisma.roles.findUnique({ where: { id } });
    if (!role) throw new NotFoundException('Role not found');

    if (dto.name && dto.name !== role.name) {
      const conflict = await this.prisma.roles.findFirst({ where: { name: dto.name } });
      if (conflict) throw new ConflictException('A role with that name already exists');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.roles.update({
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
    });

    await this.audit.write({
      actorId,
      action: AUDIT_ACTIONS.ROLE_UPDATED,
      resourceType: 'role',
      resourceId: id,
      changes: { method: 'PATCH', path: `/api/v1/roles/${id}` },
    });

    return { message: 'Role updated', data: await this.hydrateRole(id, lang) };
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

    await this.audit.write({
      actorId,
      action: AUDIT_ACTIONS.ROLE_DELETED,
      resourceType: 'role',
      resourceId: id,
      changes: { method: 'DELETE', path: `/api/v1/roles/${id}` },
    });

    return { message: 'Role deleted', data: null };
  }

  async assignPermission(roleId: string, dto: AssignPermissionDto, actorId: string, lang: string | null) {
    const role = await this.prisma.roles.findUnique({ where: { id: roleId } });
    if (!role) throw new NotFoundException('Role not found');

    await this.prisma.role_permissions.upsert({
      where: { role_id_permission_id: { role_id: roleId, permission_id: dto.permissionId } },
      create: { role_id: roleId, permission_id: dto.permissionId },
      update: {},
    });

    await this.audit.write({
      actorId,
      action: AUDIT_ACTIONS.PERMISSION_ASSIGNED_TO_ROLE,
      resourceType: 'role',
      resourceId: roleId,
      changes: { method: 'POST', path: `/api/v1/roles/${roleId}/permissions`, permissionId: dto.permissionId },
    });

    return { message: 'Permission assigned', data: await this.hydrateRole(roleId, lang) };
  }

  async removePermission(roleId: string, permissionId: string, actorId: string, lang: string | null) {
    const role = await this.prisma.roles.findUnique({ where: { id: roleId } });
    if (!role) throw new NotFoundException('Role not found');

    const result = await this.prisma.role_permissions.deleteMany({
      where: { role_id: roleId, permission_id: permissionId },
    });
    if (result.count === 0) {
      throw new NotFoundException('Permission is not assigned to this role');
    }

    await this.audit.write({
      actorId,
      action: AUDIT_ACTIONS.PERMISSION_REMOVED_FROM_ROLE,
      resourceType: 'role',
      resourceId: roleId,
      changes: { method: 'DELETE', path: `/api/v1/roles/${roleId}/permissions/${permissionId}`, permissionId },
    });

    return { message: 'Permission removed', data: await this.hydrateRole(roleId, lang) };
  }

  async findAllPermissions(lang: string | null, page: number, limit: number) {
    const skip = (page - 1) * limit;
    const [permissions, total] = await Promise.all([
      this.prisma.permissions.findMany({
        include: { permission_translations: true },
        skip,
        take: limit,
      }),
      this.prisma.permissions.count(),
    ]);
    return {
      message: 'Permissions fetched',
      data: {
        items: permissions.map((p) => ({
          id: p.id,
          name: p.name,
          permission_translations: p.permission_translations,
          translation: resolveTranslation(p.permission_translations, lang),
        })),
        pagination: buildPaginationMeta(page, limit, total),
      },
    };
  }
}
