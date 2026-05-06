import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { ChangePasswordDto, LoginDto, RefreshTokenDto } from './dto/auth.dto';

const REFRESH_TOKEN_TTL_DAYS = 7;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  private hashToken(raw: string): string {
    return crypto.createHash('sha256').update(raw).digest('hex');
  }

  private async issueRefreshToken(userId: string): Promise<string> {
    const raw = crypto.randomBytes(40).toString('hex');
    const hash = this.hashToken(raw);
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + REFRESH_TOKEN_TTL_DAYS);

    await this.prisma.refresh_tokens.create({
      data: { user_id: userId, token_hash: hash, expires_at: expiresAt },
    });

    return raw;
  }

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

    const payload = { sub: user.id, username: user.username, permissions, token_version: user.token_version };
    const accessToken = this.jwtService.sign(payload);
    const refreshToken = await this.issueRefreshToken(user.id);

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
        refresh_token: refreshToken,
        user: {
          id: user.id,
          username: user.username,
          roles,
          permissions,
        },
      },
    };
  }

  async refresh(dto: RefreshTokenDto) {
    const hash = this.hashToken(dto.refresh_token);

    const stored = await this.prisma.refresh_tokens.findUnique({
      where: { token_hash: hash },
      include: { users: true },
    });

    if (!stored || stored.revoked_at !== null || stored.expires_at < new Date()) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const user = stored.users;
    if (user.deleted_at !== null) {
      throw new UnauthorizedException('Account is disabled');
    }

    // Rotate: revoke old token
    await this.prisma.refresh_tokens.update({
      where: { id: stored.id },
      data: { revoked_at: new Date() },
    });

    // Fetch fresh permissions
    const fullUser = await this.prisma.users.findUnique({
      where: { id: user.id },
      include: {
        user_roles: {
          include: {
            roles: {
              include: { role_permissions: { include: { permissions: true } } },
            },
          },
        },
      },
    });

    const permissionSet = new Set<string>();
    for (const userRole of fullUser!.user_roles) {
      for (const rp of userRole.roles.role_permissions) {
        permissionSet.add(rp.permissions.name);
      }
    }
    const permissions = Array.from(permissionSet);

    const payload = {
      sub: user.id,
      username: user.username,
      permissions,
      token_version: fullUser!.token_version,
    };
    const accessToken = this.jwtService.sign(payload);
    const newRefreshToken = await this.issueRefreshToken(user.id);

    return {
      message: 'Tokens refreshed',
      data: { accessToken, refresh_token: newRefreshToken },
    };
  }

  async logout(userId: string, rawRefreshToken?: string) {
    if (rawRefreshToken) {
      const hash = this.hashToken(rawRefreshToken);
      await this.prisma.refresh_tokens.updateMany({
        where: { user_id: userId, token_hash: hash, revoked_at: null },
        data: { revoked_at: new Date() },
      });
    } else {
      // Revoke all active tokens for this user
      await this.prisma.refresh_tokens.updateMany({
        where: { user_id: userId, revoked_at: null },
        data: { revoked_at: new Date() },
      });
    }

    return { message: 'Logged out successfully', data: null };
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
      data: { password_hash: newHash, updated_at: new Date(), token_version: { increment: 1 } },
    });

    // Revoke all refresh tokens so existing sessions are invalidated
    await this.prisma.refresh_tokens.updateMany({
      where: { user_id: userId, revoked_at: null },
      data: { revoked_at: new Date() },
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
