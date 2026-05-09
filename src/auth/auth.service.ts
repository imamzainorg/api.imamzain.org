import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { ChangePasswordDto, LoginDto, RefreshTokenDto } from './dto/auth.dto';

const REFRESH_TOKEN_TTL_DAYS = 7;
const DEFAULT_BCRYPT_ROUNDS = 12;

function resolveBcryptRounds(): number {
  const raw = process.env.BCRYPT_ROUNDS;
  if (!raw) return DEFAULT_BCRYPT_ROUNDS;
  const parsed = parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed < 4 || parsed > 15) return DEFAULT_BCRYPT_ROUNDS;
  return parsed;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  private hashToken(raw: string): string {
    return crypto.createHash('sha256').update(raw).digest('hex');
  }

  private async issueRefreshToken(userId: string, tx: PrismaService | any = this.prisma): Promise<string> {
    const raw = crypto.randomBytes(40).toString('hex');
    const hash = this.hashToken(raw);
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + REFRESH_TOKEN_TTL_DAYS);

    await tx.refresh_tokens.create({
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
    } catch (err) {
      this.logger.warn(`Failed to write USER_LOGIN audit log: ${err}`);
    }

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

    // Atomic rotation with reuse-detection: do everything inside a single
    // transaction. The conditional updateMany guarantees that only one
    // concurrent caller wins the rotation race; the loser revokes the entire
    // chain on the assumption the token is being replayed by an attacker.
    const result = await this.prisma.$transaction(async (tx) => {
      const stored = await tx.refresh_tokens.findUnique({
        where: { token_hash: hash },
        include: { users: true },
      });

      if (!stored || stored.expires_at < new Date()) {
        throw new UnauthorizedException('Invalid or expired refresh token');
      }

      // Reuse detection: a revoked token being presented again revokes the
      // entire chain for that user, forcing all sessions to re-authenticate.
      if (stored.revoked_at !== null) {
        await tx.refresh_tokens.updateMany({
          where: { user_id: stored.user_id, revoked_at: null },
          data: { revoked_at: new Date() },
        });
        this.logger.warn(`Refresh-token reuse detected for user ${stored.user_id}; chain revoked`);
        throw new UnauthorizedException('Refresh token reuse detected');
      }

      if (stored.users.deleted_at !== null) {
        throw new UnauthorizedException('Account is disabled');
      }

      const revoked = await tx.refresh_tokens.updateMany({
        where: { id: stored.id, revoked_at: null },
        data: { revoked_at: new Date() },
      });
      // Two concurrent rotations: only one updateMany affects a row.
      if (revoked.count !== 1) {
        throw new UnauthorizedException('Refresh token already rotated');
      }

      const fullUser = await tx.users.findUnique({
        where: { id: stored.user_id },
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
        sub: fullUser!.id,
        username: fullUser!.username,
        permissions,
        token_version: fullUser!.token_version,
      };
      const accessToken = this.jwtService.sign(payload);
      const newRefreshToken = await this.issueRefreshToken(fullUser!.id, tx);

      return { accessToken, newRefreshToken };
    });

    return {
      message: 'Tokens refreshed',
      data: { accessToken: result.accessToken, refresh_token: result.newRefreshToken },
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

    const newHash = await bcrypt.hash(dto.newPassword, resolveBcryptRounds());

    // Password update + session revocation must be atomic — a crash between
    // them would leave old refresh tokens valid after a "successful" change.
    await this.prisma.$transaction(async (tx) => {
      await tx.users.update({
        where: { id: userId },
        data: { password_hash: newHash, updated_at: new Date(), token_version: { increment: 1 } },
      });

      await tx.refresh_tokens.updateMany({
        where: { user_id: userId, revoked_at: null },
        data: { revoked_at: new Date() },
      });
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
    } catch (err) {
      this.logger.warn(`Failed to write PASSWORD_CHANGED audit log: ${err}`);
    }

    return { message: 'Password changed successfully', data: null };
  }
}
