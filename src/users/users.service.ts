import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import { AUDIT_ACTIONS } from '../common/audit/audit.actions';
import { resolveBcryptRounds } from '../common/utils/bcrypt.util';
import { invalidateJwtUserCache } from '../auth/strategies/jwt.strategy';
import { buildPaginationMeta } from '../common/utils/pagination.util';
import { AdminResetPasswordDto, AssignRoleDto, CreateUserDto, UpdateUserDto } from './dto/user.dto';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

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

    await this.prisma.users.update({ where: { id }, data: { deleted_at: new Date() } });

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

  async assignRole(userId: string, dto: AssignRoleDto, actorId: string) {
    const [user, role] = await Promise.all([
      this.prisma.users.findFirst({ where: { id: userId, deleted_at: null } }),
      this.prisma.roles.findUnique({ where: { id: dto.role_id } }),
    ]);
    if (!user) throw new NotFoundException('User not found');
    if (!role) throw new NotFoundException('Role not found');

    const existing = await this.prisma.user_roles.findUnique({
      where: { user_id_role_id: { user_id: userId, role_id: dto.role_id } },
      select: { user_id: true },
    });

    if (!existing) {
      await this.prisma.user_roles.create({
        data: { user_id: userId, role_id: dto.role_id },
      });

      await this.audit.write({
        actorId,
        action: AUDIT_ACTIONS.ROLE_ASSIGNED_TO_USER,
        resourceType: 'user',
        resourceId: userId,
        changes: { method: 'POST', path: `/api/v1/users/${userId}/roles`, role_id: dto.role_id },
      });
    }

    const { data } = await this.findOne(userId);
    return { message: 'Role assigned', data };
  }

  async removeRole(userId: string, roleId: string, actorId: string) {
    const user = await this.prisma.users.findFirst({ where: { id: userId, deleted_at: null } });
    if (!user) throw new NotFoundException('User not found');

    const result = await this.prisma.user_roles.deleteMany({
      where: { user_id: userId, role_id: roleId },
    });
    if (result.count === 0) {
      throw new NotFoundException('Role is not assigned to this user');
    }

    await this.audit.write({
      actorId,
      action: AUDIT_ACTIONS.ROLE_REMOVED_FROM_USER,
      resourceType: 'user',
      resourceId: userId,
      changes: { method: 'DELETE', path: `/api/v1/users/${userId}/roles/${roleId}`, roleId },
    });

    const { data } = await this.findOne(userId);
    return { message: 'Role removed', data };
  }
}
