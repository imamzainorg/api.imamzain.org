import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { ChangePasswordDto, LoginDto } from './dto/auth.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  async login(dto: LoginDto, ip: string, userAgent: string) {
    const user = await this.prisma.users.findFirst({
      where: { username: dto.username, deleted_at: null },
      include: {
        user_roles: {
          include: {
            roles: {
              include: {
                role_permissions: {
                  include: { permissions: true },
                },
              },
            },
          },
        },
      },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const passwordMatch = await bcrypt.compare(dto.password, user.password_hash);
    if (!passwordMatch) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const permissionSet = new Set<string>();
    for (const userRole of user.user_roles) {
      for (const rp of userRole.roles.role_permissions) {
        permissionSet.add(rp.permissions.name);
      }
    }
    const permissions = Array.from(permissionSet);

    const payload = { sub: user.id, username: user.username, permissions };
    const accessToken = this.jwtService.sign(payload);

    try {
      await this.prisma.audit_logs.create({
        data: {
          user_id: user.id,
          action: 'USER_LOGIN',
          resource_type: 'user',
          resource_id: user.id,
          ip_address: ip,
          user_agent: userAgent,
          changes: { method: 'POST', path: '/api/v1/auth/login' },
        },
      });
    } catch {}

    const roles = user.user_roles.map((ur) => ur.roles.name);

    return {
      message: 'Login successful',
      data: {
        accessToken,
        user: {
          id: user.id,
          username: user.username,
          roles,
          permissions,
        },
      },
    };
  }

  async getMe(userId: string) {
    const user = await this.prisma.users.findFirst({
      where: { id: userId, deleted_at: null },
      include: {
        user_roles: {
          include: {
            roles: {
              include: {
                role_permissions: {
                  include: { permissions: true },
                },
              },
            },
          },
        },
      },
    });

    if (!user) {
      throw new UnauthorizedException();
    }

    const permissionSet = new Set<string>();
    for (const userRole of user.user_roles) {
      for (const rp of userRole.roles.role_permissions) {
        permissionSet.add(rp.permissions.name);
      }
    }

    return {
      message: 'Profile fetched',
      data: {
        id: user.id,
        username: user.username,
        created_at: user.created_at,
        roles: user.user_roles.map((ur) => ur.roles.name),
        permissions: Array.from(permissionSet),
      },
    };
  }

  async changePassword(userId: string, dto: ChangePasswordDto, ip: string) {
    const user = await this.prisma.users.findFirst({
      where: { id: userId, deleted_at: null },
    });

    if (!user) {
      throw new UnauthorizedException();
    }

    const match = await bcrypt.compare(dto.currentPassword, user.password_hash);
    if (!match) {
      throw new UnauthorizedException('Current password is incorrect');
    }

    const rounds = parseInt(process.env.BCRYPT_ROUNDS ?? '12', 10);
    const newHash = await bcrypt.hash(dto.newPassword, rounds);

    await this.prisma.users.update({
      where: { id: userId },
      data: { password_hash: newHash, updated_at: new Date() },
    });

    try {
      await this.prisma.audit_logs.create({
        data: {
          user_id: userId,
          action: 'PASSWORD_CHANGED',
          resource_type: 'user',
          resource_id: userId,
          ip_address: ip,
          changes: { method: 'PATCH', path: '/api/v1/auth/me/password' },
        },
      });
    } catch {}

    return { message: 'Password changed successfully', data: null };
  }
}
