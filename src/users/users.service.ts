import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { AssignRoleDto, CreateUserDto, UpdateUserDto } from './dto/user.dto';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

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
      data: {
        items: mapped,
        pagination: { page, limit, total, pages: Math.ceil(total / limit) },
      },
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

    const { password_hash, ...rest } = user as any;
    return {
      message: 'User fetched',
      data: { ...rest, is_active: rest.deleted_at === null, permissions: Array.from(permissionSet) },
    };
  }

  async create(dto: CreateUserDto, actorId: string) {
    const existing = await this.prisma.users.findFirst({
      where: { username: dto.username, deleted_at: null },
    });
    if (existing) throw new ConflictException('Username is already taken');

    const rounds = parseInt(process.env.BCRYPT_ROUNDS ?? '12', 10);
    const password_hash = await bcrypt.hash(dto.password, rounds);

    const user = await this.prisma.users.create({
      data: { username: dto.username, password_hash },
    });

    try {
      await this.prisma.audit_logs.create({
        data: {
          user_id: actorId,
          action: 'USER_CREATED',
          resource_type: 'user',
          resource_id: user.id,
          changes: { method: 'POST', path: '/api/v1/users' },
        },
      });
    } catch {}

    const { password_hash: _, ...result } = user as any;
    return { message: 'User created', data: result };
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

    const updated = await this.prisma.users.update({
      where: { id },
      data: { ...dto, updated_at: new Date() },
    });

    try {
      await this.prisma.audit_logs.create({
        data: {
          user_id: actorId,
          action: 'USER_UPDATED',
          resource_type: 'user',
          resource_id: id,
          changes: { method: 'PATCH', path: `/api/v1/users/${id}` },
        },
      });
    } catch {}

    const { password_hash, ...result } = updated as any;
    return { message: 'User updated', data: result };
  }

  async softDelete(id: string, actorId: string) {
    const user = await this.prisma.users.findFirst({ where: { id, deleted_at: null } });
    if (!user) throw new NotFoundException('User not found');

    await this.prisma.users.update({ where: { id }, data: { deleted_at: new Date() } });

    try {
      await this.prisma.audit_logs.create({
        data: {
          user_id: actorId,
          action: 'USER_DELETED',
          resource_type: 'user',
          resource_id: id,
          changes: { method: 'DELETE', path: `/api/v1/users/${id}` },
        },
      });
    } catch {}

    return { message: 'User deleted', data: null };
  }

  async assignRole(userId: string, dto: AssignRoleDto, actorId: string) {
    const user = await this.prisma.users.findFirst({ where: { id: userId, deleted_at: null } });
    if (!user) throw new NotFoundException('User not found');

    await this.prisma.user_roles.upsert({
      where: { user_id_role_id: { user_id: userId, role_id: dto.role_id } },
      create: { user_id: userId, role_id: dto.role_id },
      update: {},
    });

    try {
      await this.prisma.audit_logs.create({
        data: {
          user_id: actorId,
          action: 'ROLE_ASSIGNED_TO_USER',
          resource_type: 'user',
          resource_id: userId,
          changes: { method: 'POST', path: `/api/v1/users/${userId}/roles`, role_id: dto.role_id },
        },
      });
    } catch {}

    return { message: 'Role assigned', data: null };
  }

  async removeRole(userId: string, roleId: string, actorId: string) {
    const user = await this.prisma.users.findFirst({ where: { id: userId, deleted_at: null } });
    if (!user) throw new NotFoundException('User not found');

    await this.prisma.user_roles.delete({
      where: { user_id_role_id: { user_id: userId, role_id: roleId } },
    });

    try {
      await this.prisma.audit_logs.create({
        data: {
          user_id: actorId,
          action: 'ROLE_REMOVED_FROM_USER',
          resource_type: 'user',
          resource_id: userId,
          changes: { method: 'DELETE', path: `/api/v1/users/${userId}/roles/${roleId}`, roleId },
        },
      });
    } catch {}

    return { message: 'Role removed', data: null };
  }
}
