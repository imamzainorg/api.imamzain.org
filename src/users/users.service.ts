import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { CurrentUserPayload } from '../common/decorators/current-user.decorator';
import { AuditService } from '../common/audit/audit.service';
import { AUDIT_ACTIONS } from '../common/audit/audit.actions';
import { resolveBcryptRounds } from '../common/utils/bcrypt.util';
import { invalidateJwtUserCache } from '../auth/strategies/jwt.strategy';
import { buildPaginationMeta } from '../common/utils/pagination.util';
import { rethrowP2002AsConflict } from '../common/utils/prisma-error.util';
import { softDeleteSuffix, stripSoftDeleteSuffix } from '../common/utils/soft-delete.util';
import { AdminResetPasswordDto, AssignRoleDto, CreateUserDto, UpdateUserDto } from './dto/user.dto';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async findAll(page: number, limit: number) {
    const skip = (page - 1) * limit;
    const [items, total] = await Promise.all([
      this.prisma.users.findMany({
        where: { deleted_at: null },
        select: {
          id: true,
          username: true,
          created_at: true,
          updated_at: true,
          deleted_at: true,
          user_roles: { include: { roles: true } },
        },
        orderBy: { created_at: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.users.count({ where: { deleted_at: null } }),
    ]);

    const mapped = items.map(({ deleted_at, ...u }) => ({ ...u, is_active: deleted_at === null }));
    return {
      message: 'Users fetched',
      data: { items: mapped, pagination: buildPaginationMeta(page, limit, total) },
    };
  }

  async findOne(id: string) {
    const user = await this.prisma.users.findFirst({
      where: { id, deleted_at: null },
      include: {
        user_roles: {
          include: {
            roles: {
              include: {
                role_permissions: { include: { permissions: true } },
              },
            },
          },
        },
      },
    });

    if (!user) throw new NotFoundException('User not found');

    const permissionSet = new Set<string>();
    for (const ur of user.user_roles) {
      for (const rp of ur.roles.role_permissions) {
        permissionSet.add(rp.permissions.name);
      }
    }

    return {
      message: 'User fetched',
      data: {
        id: user.id,
        username: user.username,
        created_at: user.created_at,
        updated_at: user.updated_at,
        is_active: user.deleted_at === null,
        user_roles: user.user_roles,
        permissions: Array.from(permissionSet),
      },
    };
  }

  async create(dto: CreateUserDto, actorId: string) {
    const existing = await this.prisma.users.findFirst({
      where: { username: dto.username, deleted_at: null },
    });
    if (existing) throw new ConflictException('Username is already taken');

    const password_hash = await bcrypt.hash(dto.password, resolveBcryptRounds());

    const user = await this.prisma.users.create({
      data: { username: dto.username, password_hash },
    });

    await this.audit.write({
      actorId,
      action: AUDIT_ACTIONS.USER_CREATED,
      resourceType: 'user',
      resourceId: user.id,
      changes: { method: 'POST', path: '/api/v1/users' },
    });

    const { data } = await this.findOne(user.id);
    return { message: 'User created', data };
  }

  async update(id: string, dto: UpdateUserDto, actorId: string) {
    const user = await this.prisma.users.findFirst({ where: { id, deleted_at: null } });
    if (!user) throw new NotFoundException('User not found');

    if (dto.username && dto.username !== user.username) {
      const taken = await this.prisma.users.findFirst({
        where: { username: dto.username, deleted_at: null },
      });
      if (taken) throw new ConflictException('Username is already taken');
    }

    const updateData: Prisma.usersUpdateInput = { updated_at: new Date() };
    if (dto.username !== undefined) updateData.username = dto.username;

    await this.prisma.users.update({ where: { id }, data: updateData });

    await this.audit.write({
      actorId,
      action: AUDIT_ACTIONS.USER_UPDATED,
      resourceType: 'user',
      resourceId: id,
      changes: { method: 'PATCH', path: `/api/v1/users/${id}` },
    });

    const { data } = await this.findOne(id);
    return { message: 'User updated', data };
  }

  /**
   * Admin-driven password reset for a user who has forgotten theirs.
   * No self-service "forgot password" flow exists because the users table
   * has no email column — recovery is by deliberate admin action. The
   * admin types a new password into the CMS, the API hashes it, bumps
   * token_version (invalidates outstanding access tokens), and revokes
   * every refresh token so the user is forced to re-authenticate.
   *
   * The admin who triggered this MUST share the new password with the
   * user out-of-band (in person / Slack / phone). The plaintext is never
   * stored.
   */
  async adminResetPassword(userId: string, dto: AdminResetPasswordDto, actorId: string) {
    const user = await this.prisma.users.findFirst({ where: { id: userId, deleted_at: null } });
    if (!user) throw new NotFoundException('User not found');

    const password_hash = await bcrypt.hash(dto.new_password, resolveBcryptRounds());

    await this.prisma.$transaction([
      this.prisma.users.update({
        where: { id: userId },
        data: {
          password_hash,
          updated_at: new Date(),
          token_version: { increment: 1 },
        },
      }),
      this.prisma.refresh_tokens.updateMany({
        where: { user_id: userId, revoked_at: null },
        data: { revoked_at: new Date() },
      }),
    ]);

    invalidateJwtUserCache(userId);

    await this.audit.write({
      actorId,
      action: AUDIT_ACTIONS.USER_PASSWORD_RESET_BY_ADMIN,
      resourceType: 'user',
      resourceId: userId,
      changes: { method: 'POST', path: `/api/v1/users/${userId}/reset-password` },
    });

    return { message: 'Password reset; user must re-authenticate', data: null };
  }

  async softDelete(id: string, actorId: string) {
    const user = await this.prisma.users.findFirst({ where: { id, deleted_at: null } });
    if (!user) throw new NotFoundException('User not found');

    // Free the unique `username` so it can be reused after deletion. username
    // is a hard unique column and softDelete previously left it occupying the
    // constraint forever — an admin could never re-create a deleted user's
    // name. Suffix it like the slug/ISBN soft-delete scheme; `restore` reverses
    // the suffix (and 409s if the original name was reclaimed meanwhile).
    const deletedAt = new Date();
    await this.prisma.users.update({
      where: { id },
      data: { deleted_at: deletedAt, username: `${user.username}${softDeleteSuffix(deletedAt)}` },
    });

    invalidateJwtUserCache(id);

    await this.audit.write({
      actorId,
      action: AUDIT_ACTIONS.USER_DELETED,
      resourceType: 'user',
      resourceId: id,
      changes: { method: 'DELETE', path: `/api/v1/users/${id}` },
    });

    return { message: 'User deleted', data: null };
  }

  /** List soft-deleted users with their original (suffix-stripped) username. */
  async findTrash(page: number, limit: number) {
    const skip = (page - 1) * limit;
    const where: Prisma.usersWhereInput = { deleted_at: { not: null } };
    const [items, total] = await Promise.all([
      this.prisma.users.findMany({
        where,
        select: {
          id: true,
          username: true,
          created_at: true,
          updated_at: true,
          deleted_at: true,
          user_roles: { include: { roles: true } },
        },
        orderBy: [{ deleted_at: 'desc' }, { id: 'asc' }],
        skip,
        take: limit,
      }),
      this.prisma.users.count({ where }),
    ]);

    const mapped = items.map(({ deleted_at, username, ...u }) => ({
      ...u,
      username: stripSoftDeleteSuffix(username),
      is_active: false,
    }));
    return {
      message: 'Trash fetched',
      data: { items: mapped, pagination: buildPaginationMeta(page, limit, total) },
    };
  }

  /**
   * Restore a soft-deleted user. Reverses the username suffix from softDelete.
   * Refused with 409 if a live user has claimed the original username while the
   * row sat in trash — the admin must rename one side and retry.
   */
  async restore(id: string, actorId: string) {
    const user = await this.prisma.users.findFirst({ where: { id, deleted_at: { not: null } } });
    if (!user) throw new NotFoundException('Deleted user not found');

    const originalUsername = stripSoftDeleteSuffix(user.username);
    const conflict = await this.prisma.users.findFirst({
      where: { username: originalUsername, deleted_at: null, NOT: { id } },
      select: { id: true },
    });
    if (conflict) {
      throw new ConflictException(
        `Cannot restore: username "${originalUsername}" is now used by another user`,
      );
    }

    try {
      await this.prisma.users.update({
        where: { id },
        data: { deleted_at: null, username: originalUsername, updated_at: new Date() },
      });
    } catch (err) {
      // The unique constraint is the real backstop if a concurrent create
      // grabbed the username between the check and the update.
      rethrowP2002AsConflict(err, `Cannot restore: username "${originalUsername}" is now used by another user`);
    }

    await this.audit.write({
      actorId,
      action: AUDIT_ACTIONS.USER_RESTORED,
      resourceType: 'user',
      resourceId: id,
      changes: { method: 'POST', path: `/api/v1/users/${id}/restore` },
    });

    const { data } = await this.findOne(id);
    return { message: 'User restored', data };
  }

  /**
   * Privilege-escalation guard for role management. An actor may only
   * grant/revoke a role whose permission set is fully within their own.
   * Without this, anyone holding `users:update` could assign a role carrying
   * permissions they don't have (e.g. super-admin), escalating themselves or
   * a confederate — or strip a role from a more-privileged user they have no
   * business managing. Super-admins hold every permission, so they retain
   * full control; a limited account is confined to its own envelope.
   */
  private assertActorMayManageRole(
    actor: CurrentUserPayload,
    rolePermissions: string[],
    verb: 'assign' | 'remove',
  ) {
    const actorPermissions = new Set(actor.permissions ?? []);
    const exceeding = rolePermissions.filter((p) => !actorPermissions.has(p));
    if (exceeding.length > 0) {
      throw new ForbiddenException(
        `You cannot ${verb} a role that grants permissions beyond your own`,
      );
    }
  }

  async assignRole(userId: string, dto: AssignRoleDto, actor: CurrentUserPayload) {
    const [user, role] = await Promise.all([
      this.prisma.users.findFirst({ where: { id: userId, deleted_at: null } }),
      this.prisma.roles.findUnique({
        where: { id: dto.role_id },
        include: { role_permissions: { select: { permissions: { select: { name: true } } } } },
      }),
    ]);
    if (!user) throw new NotFoundException('User not found');
    if (!role) throw new NotFoundException('Role not found');

    this.assertActorMayManageRole(
      actor,
      role.role_permissions.map((rp) => rp.permissions.name),
      'assign',
    );

    const existing = await this.prisma.user_roles.findUnique({
      where: { user_id_role_id: { user_id: userId, role_id: dto.role_id } },
      select: { user_id: true },
    });

    if (!existing) {
      await this.prisma.user_roles.create({
        data: { user_id: userId, role_id: dto.role_id },
      });

      // The user's effective permissions are baked into their outstanding
      // access-token JWTs (permission.guard reads them from the payload).
      // Bump token_version + drop the JWT cache so the new role takes effect
      // on the next request, the way adminResetPassword/softDelete already do.
      await this.prisma.users.update({
        where: { id: userId },
        data: { token_version: { increment: 1 } },
      });
      invalidateJwtUserCache(userId);

      await this.audit.write({
        actorId: actor.id,
        action: AUDIT_ACTIONS.ROLE_ASSIGNED_TO_USER,
        resourceType: 'user',
        resourceId: userId,
        changes: { method: 'POST', path: `/api/v1/users/${userId}/roles`, role_id: dto.role_id },
      });
    }

    const { data } = await this.findOne(userId);
    return { message: 'Role assigned', data };
  }

  async removeRole(userId: string, roleId: string, actor: CurrentUserPayload) {
    const [user, role] = await Promise.all([
      this.prisma.users.findFirst({ where: { id: userId, deleted_at: null } }),
      this.prisma.roles.findUnique({
        where: { id: roleId },
        include: { role_permissions: { select: { permissions: { select: { name: true } } } } },
      }),
    ]);
    if (!user) throw new NotFoundException('User not found');
    if (!role) throw new NotFoundException('Role not found');

    this.assertActorMayManageRole(
      actor,
      role.role_permissions.map((rp) => rp.permissions.name),
      'remove',
    );

    const result = await this.prisma.user_roles.deleteMany({
      where: { user_id: userId, role_id: roleId },
    });
    if (result.count === 0) {
      throw new NotFoundException('Role is not assigned to this user');
    }

    // Revoking a role narrows the user's effective permissions, which are
    // baked into outstanding access-token JWTs. Bump token_version + drop the
    // JWT cache so the revocation takes effect on the user's next request.
    await this.prisma.users.update({
      where: { id: userId },
      data: { token_version: { increment: 1 } },
    });
    invalidateJwtUserCache(userId);

    await this.audit.write({
      actorId: actor.id,
      action: AUDIT_ACTIONS.ROLE_REMOVED_FROM_USER,
      resourceType: 'user',
      resourceId: userId,
      changes: { method: 'DELETE', path: `/api/v1/users/${userId}/roles/${roleId}`, roleId },
    });

    const { data } = await this.findOne(userId);
    return { message: 'Role removed', data };
  }
}
