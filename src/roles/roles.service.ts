import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import { AUDIT_ACTIONS } from '../common/audit/audit.actions';
import { CurrentUserPayload } from '../common/decorators/current-user.decorator';
import { buildPaginationMeta } from '../common/utils/pagination.util';
import { assertNotLastAdministrator, assertWithinActorEnvelope } from '../common/utils/rbac.util';
import { resolveTranslation } from '../common/utils/translation.util';
import { invalidateJwtUserCache } from '../auth/strategies/jwt.strategy';
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

  /**
   * A change to a role's permission set alters the effective permissions of
   * every user holding that role. Permissions are baked into outstanding
   * access-token JWTs, so bump token_version for each affected user and drop
   * their JWT cache entry — the change then takes effect on their next request
   * (and refresh re-derives the corrected permission set from the DB).
   */
  private async invalidateRoleHolders(roleId: string): Promise<void> {
    const holders = await this.prisma.user_roles.findMany({
      where: { role_id: roleId },
      select: { user_id: true },
    });
    if (holders.length === 0) return;

    const userIds = holders.map((h) => h.user_id);
    await this.prisma.users.updateMany({
      where: { id: { in: userIds } },
      data: { token_version: { increment: 1 } },
    });
    for (const id of userIds) invalidateJwtUserCache(id);
  }

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
        orderBy: { name: 'asc' },
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

  /**
   * 409 when a role already carries this name in ANY letter case. Role names are
   * stored byte-exact (the unique index is case-sensitive), so without this
   * "Admin" and "admin" would be two different roles that look identical in the
   * CMS. `exceptId` is the role being renamed.
   */
  private async assertRoleNameAvailable(name: string, exceptId?: string): Promise<void> {
    const conflict = await this.prisma.roles.findFirst({
      where: {
        name: { equals: name, mode: 'insensitive' },
        ...(exceptId ? { NOT: { id: exceptId } } : {}),
      },
      select: { id: true },
    });
    if (conflict) throw new ConflictException('A role with that name already exists');
  }

  async create(dto: CreateRoleDto, actorId: string, lang: string | null) {
    const name = dto.name.trim();
    await this.assertRoleNameAvailable(name);

    const role = await this.prisma.$transaction(async (tx) => {
      const created = await tx.roles.create({ data: { name } });
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

    const name = dto.name?.trim() || undefined;
    const renamed = name !== undefined && name !== role.name;
    if (renamed) await this.assertRoleNameAvailable(name, id);

    await this.prisma.$transaction(async (tx) => {
      await tx.roles.update({
        where: { id },
        data: name ? { name } : {},
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
      changes: {
        method: 'PATCH',
        path: `/api/v1/roles/${id}`,
        ...(renamed ? { name: { before: role.name, after: name } } : {}),
      },
    });

    return { message: 'Role updated', data: await this.hydrateRole(id, lang) };
  }

  async delete(id: string, actorId: string) {
    // The assignment check lives inside the transaction, behind a row lock on
    // the role. A concurrent user_roles insert takes a KEY SHARE lock on this row
    // through its foreign key, which conflicts with FOR UPDATE: it either commits
    // first and is counted below, or waits until we are done. Without the lock the
    // count could read 0 while an assignment was in flight, and the Cascade
    // delete would then silently remove it.
    await this.prisma.$transaction(async (tx) => {
      const role = await tx.roles.findUnique({ where: { id } });
      if (!role) throw new NotFoundException('Role not found');

      const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM roles WHERE id = ${id}::uuid FOR UPDATE`;
      if (locked.length === 0) throw new NotFoundException('Role not found');

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

  /**
   * Resolve the (role, permission) pair behind a grant/revoke and apply the
   * privilege envelope: an actor may only grant or revoke a permission they
   * hold themselves. Without this, any custom role carrying `roles:update`
   * is a super-admin in disguise — it could attach every other permission to
   * itself. Super-admins hold everything, so nothing changes for them.
   */
  private async loadRoleAndPermission(
    roleId: string,
    permissionId: string,
    actor: CurrentUserPayload,
    verb: 'grant' | 'revoke',
  ) {
    const [role, permission] = await Promise.all([
      this.prisma.roles.findUnique({ where: { id: roleId } }),
      this.prisma.permissions.findUnique({ where: { id: permissionId } }),
    ]);
    if (!role) throw new NotFoundException('Role not found');
    if (!permission) throw new NotFoundException('Permission not found');

    assertWithinActorEnvelope(
      actor.permissions,
      [permission.name],
      `You cannot ${verb} a permission you do not hold yourself`,
    );

    return { role, permission };
  }

  async assignPermission(roleId: string, dto: AssignPermissionDto, actor: CurrentUserPayload, lang: string | null) {
    await this.loadRoleAndPermission(roleId, dto.permissionId, actor, 'grant');

    await this.prisma.role_permissions.upsert({
      where: { role_id_permission_id: { role_id: roleId, permission_id: dto.permissionId } },
      create: { role_id: roleId, permission_id: dto.permissionId },
      update: {},
    });

    await this.invalidateRoleHolders(roleId);

    await this.audit.write({
      actorId: actor.id,
      action: AUDIT_ACTIONS.PERMISSION_ASSIGNED_TO_ROLE,
      resourceType: 'role',
      resourceId: roleId,
      changes: { method: 'POST', path: `/api/v1/roles/${roleId}/permissions`, permissionId: dto.permissionId },
    });

    return { message: 'Permission assigned', data: await this.hydrateRole(roleId, lang) };
  }

  async removePermission(roleId: string, permissionId: string, actor: CurrentUserPayload, lang: string | null) {
    await this.loadRoleAndPermission(roleId, permissionId, actor, 'revoke');

    // Revoking e.g. `roles:update` from the seeded super-admin role would leave
    // nobody able to grant anything ever again (the actor's own token dies on
    // the spot). Refuse while at least one full-permission administrator
    // would not survive the change — checked in the same transaction as the
    // delete so the snapshot cannot drift.
    const result = await this.prisma.$transaction(async (tx) => {
      await assertNotLastAdministrator(tx, { kind: 'remove-permission', roleId, permissionId });
      return tx.role_permissions.deleteMany({
        where: { role_id: roleId, permission_id: permissionId },
      });
    });
    if (result.count === 0) {
      throw new NotFoundException('Permission is not assigned to this role');
    }

    await this.invalidateRoleHolders(roleId);

    await this.audit.write({
      actorId: actor.id,
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
        orderBy: { name: 'asc' },
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
