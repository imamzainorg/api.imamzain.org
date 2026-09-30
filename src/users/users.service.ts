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
import {
  assertNotLastAdministrator,
  assertWithinActorEnvelope,
  MANAGE_USER_ENVELOPE_MESSAGE,
} from '../common/utils/rbac.util';
import { softDeleteSuffix, stripSoftDeleteSuffix } from '../common/utils/soft-delete.util';
import { AdminResetPasswordDto, AssignRoleDto, CreateUserDto, UpdateUserDto } from './dto/user.dto';

/** Roles → permissions joins needed to compute a user's effective permission set. */
const USER_PERMISSIONS_INCLUDE = {
  user_roles: {
    include: {
      roles: {
        include: {
          role_permissions: { include: { permissions: true } },
        },
      },
    },
  },
} satisfies Prisma.usersInclude;

type UserWithPermissions = Prisma.usersGetPayload<{ include: typeof USER_PERMISSIONS_INCLUDE }>;

function flattenPermissions(user: UserWithPermissions): string[] {
  const permissionSet = new Set<string>();
  for (const ur of user.user_roles) {
    for (const rp of ur.roles.role_permissions) {
      permissionSet.add(rp.permissions.name);
    }
  }
  return Array.from(permissionSet);
}

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
        orderBy: [{ created_at: 'desc' }, { id: 'asc' }],
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
      include: USER_PERMISSIONS_INCLUDE,
    });

    if (!user) throw new NotFoundException('User not found');

    return {
      message: 'User fetched',
      data: {
        id: user.id,
        username: user.username,
        created_at: user.created_at,
        updated_at: user.updated_at,
        is_active: user.deleted_at === null,
        user_roles: user.user_roles,
        permissions: flattenPermissions(user),
      },
    };
  }

  /**
   * Load a live user together with its effective permissions and refuse (403)
   * when the target holds any permission the actor lacks. Every route that
   * changes another account's credentials, identity or existence goes through
   * this so a `users:update` holder cannot take over or disable a more
   * privileged account (e.g. the seeded `admin` role acting on `super-admin`).
   */
  private async loadManagedUser(id: string, actor: CurrentUserPayload): Promise<UserWithPermissions> {
    const user = await this.prisma.users.findFirst({
      where: { id, deleted_at: null },
      include: USER_PERMISSIONS_INCLUDE,
    });
    if (!user) throw new NotFoundException('User not found');
    assertWithinActorEnvelope(actor.permissions, flattenPermissions(user), MANAGE_USER_ENVELOPE_MESSAGE);
    return user;
  }

  /**
   * 409 when a live account already holds this name in ANY letter case.
   * Usernames are stored byte-exact (the unique index is case-sensitive, and
   * login matches exactly), so without this "Admin", "admin" and "ADMIN" could
   * all exist and be mistaken for one another in the CMS and in audit trails.
   * `exceptId` is the row being renamed, so a case-only rename of your own
   * account is allowed.
   */
  private async assertUsernameAvailable(username: string, exceptId?: string): Promise<void> {
    const taken = await this.prisma.users.findFirst({
      where: {
        username: { equals: username, mode: 'insensitive' },
        deleted_at: null,
        ...(exceptId ? { NOT: { id: exceptId } } : {}),
      },
      select: { id: true },
    });
    if (taken) throw new ConflictException('Username is already taken');
  }

  async create(dto: CreateUserDto, actorId: string) {
    const username = dto.username.trim();
    await this.assertUsernameAvailable(username);

    const password_hash = await bcrypt.hash(dto.password, resolveBcryptRounds());

    const user = await this.prisma.users.create({
      data: { username, password_hash },
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

  async update(id: string, dto: UpdateUserDto, actor: CurrentUserPayload) {
    const user = await this.loadManagedUser(id, actor);

    const username = dto.username?.trim();
    const renamed = username !== undefined && username !== user.username;
    if (renamed) await this.assertUsernameAvailable(username, id);

    const updateData: Prisma.usersUpdateInput = { updated_at: new Date() };
    if (username !== undefined) updateData.username = username;

    await this.prisma.users.update({ where: { id }, data: updateData });

    await this.audit.write({
      actorId: actor.id,
      action: AUDIT_ACTIONS.USER_UPDATED,
      resourceType: 'user',
      resourceId: id,
      changes: {
        method: 'PATCH',
        path: `/api/v1/users/${id}`,
        ...(renamed ? { username: { before: user.username, after: username } } : {}),
      },
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
   * Subject to the privilege envelope: an actor can only reset the password
   * of an account whose permissions are all within their own — otherwise
   * "reset, then log in as them" is a one-request takeover of super-admin.
   *
   * The admin who triggered this MUST share the new password with the
   * user out-of-band (in person / Slack / phone). The plaintext is never
   * stored.
   */
  async adminResetPassword(userId: string, dto: AdminResetPasswordDto, actor: CurrentUserPayload) {
    await this.loadManagedUser(userId, actor);

    const password_hash = await bcrypt.hash(dto.new_password, resolveBcryptRounds());

    await this.prisma.$transaction([
      this.prisma.users.update({
        where: { id: userId },
        data: {
          password_hash,
          updated_at: new Date(),
          token_version: { increment: 1 },
          // The admin chose this password, so the user should replace it.
          must_change_password: true,
        },
      }),
      this.prisma.refresh_tokens.updateMany({
        where: { user_id: userId, revoked_at: null },
        data: { revoked_at: new Date() },
      }),
    ]);

    invalidateJwtUserCache(userId);

    await this.audit.write({
      actorId: actor.id,
      action: AUDIT_ACTIONS.USER_PASSWORD_RESET_BY_ADMIN,
      resourceType: 'user',
      resourceId: userId,
      changes: { method: 'POST', path: `/api/v1/users/${userId}/reset-password` },
    });

    return { message: 'Password reset; user must re-authenticate', data: null };
  }

  async softDelete(id: string, actor: CurrentUserPayload) {
    if (id === actor.id) {
      throw new ForbiddenException('You cannot delete your own account');
    }

    const user = await this.loadManagedUser(id, actor);

    // Free the unique `username` so it can be reused after deletion. username
    // is a hard unique column and softDelete previously left it occupying the
    // constraint forever — an admin could never re-create a deleted user's
    // name. Suffix it like the slug/ISBN soft-delete scheme; `restore` reverses
    // the suffix (and 409s if the original name was reclaimed meanwhile).
    const deletedAt = new Date();
    await this.prisma.$transaction(async (tx) => {
      await assertNotLastAdministrator(tx, { kind: 'delete-user', userId: id });
      await tx.users.update({
        where: { id },
        data: { deleted_at: deletedAt, username: `${user.username}${softDeleteSuffix(deletedAt)}` },
      });
    });

    invalidateJwtUserCache(id);

    await this.audit.write({
      actorId: actor.id,
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
   *
   * Subject to the same privilege envelope as update/adminResetPassword/
   * softDelete: without this, a `users:delete` holder could soft-delete a
   * super-admin (blocked from resetting/renaming it) and then simply restore
   * it right back — fully reversing the very access-revocation the envelope
   * exists to enforce. loadManagedUser only looks at live rows, so the check
   * is inlined here against the soft-deleted row instead.
   */
  async restore(id: string, actor: CurrentUserPayload) {
    const user = await this.prisma.users.findFirst({
      where: { id, deleted_at: { not: null } },
      include: USER_PERMISSIONS_INCLUDE,
    });
    if (!user) throw new NotFoundException('Deleted user not found');
    assertWithinActorEnvelope(actor.permissions, flattenPermissions(user), MANAGE_USER_ENVELOPE_MESSAGE);

    const originalUsername = stripSoftDeleteSuffix(user.username);
    const conflict = await this.prisma.users.findFirst({
      where: { username: { equals: originalUsername, mode: 'insensitive' }, deleted_at: null, NOT: { id } },
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
      actorId: actor.id,
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
    assertWithinActorEnvelope(
      actor.permissions,
      rolePermissions,
      `You cannot ${verb} a role that grants permissions beyond your own`,
    );
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

    // Stripping a role can only be allowed if at least one full-permission
    // administrator remains afterwards — otherwise the role graph becomes
    // unrepairable through the API (see rbac.util).
    const result = await this.prisma.$transaction(async (tx) => {
      await assertNotLastAdministrator(tx, { kind: 'remove-role', userId, roleId });
      return tx.user_roles.deleteMany({
        where: { user_id: userId, role_id: roleId },
      });
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
