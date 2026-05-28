import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { JwtService } from '@nestjs/jwt';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import { AUDIT_ACTIONS } from '../common/audit/audit.actions';
import { resolveBcryptRounds } from '../common/utils/bcrypt.util';
import { invalidateJwtUserCache } from './strategies/jwt.strategy';
import { ChangePasswordDto, LoginDto, RefreshTokenDto } from './dto/auth.dto';

const REFRESH_TOKEN_TTL_DAYS = 7;
// Keep revoked tokens around for 30 days so the reuse-detection in `refresh`
// can still catch a stolen-and-replayed token even after rotation. Past that
// window, the original session is long gone and the row is dead weight.
const REVOKED_TOKEN_GRACE_DAYS = 30;

type PrismaTxClient = Prisma.TransactionClient | PrismaService;

const USER_WITH_PERMISSIONS_INCLUDE = {
  user_roles: {
    include: {
      roles: {
        include: { role_permissions: { include: { permissions: true } } },
      },
    },
  },
} satisfies Prisma.usersInclude;

type UserWithPermissions = Prisma.usersGetPayload<{
  include: typeof USER_WITH_PERMISSIONS_INCLUDE;
}>;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly audit: AuditService,
  ) {}

  private hashToken(raw: string): string {
    return crypto.createHash('sha256').update(raw).digest('hex');
  }

  private async issueRefreshToken(userId: string, tx: PrismaTxClient = this.prisma): Promise<string> {
    const raw = crypto.randomBytes(40).toString('hex');
    const hash = this.hashToken(raw);
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + REFRESH_TOKEN_TTL_DAYS);

    await tx.refresh_tokens.create({
      data: { user_id: userId, token_hash: hash, expires_at: expiresAt },
    });

    return raw;
  }

  private async findUserWithPermissions(
    tx: PrismaTxClient,
    where: Prisma.usersWhereInput,
  ): Promise<UserWithPermissions | null> {
    return tx.users.findFirst({ where, include: USER_WITH_PERMISSIONS_INCLUDE });
  }

  private flattenPermissions(user: UserWithPermissions): string[] {
    const set = new Set<string>();
    for (const ur of user.user_roles) {
      for (const rp of ur.roles.role_permissions) {
        set.add(rp.permissions.name);
      }
    }
    return Array.from(set);
  }

  async login(dto: LoginDto, ip: string, userAgent: string) {
    const user = await this.findUserWithPermissions(this.prisma, {
      username: dto.username,
      deleted_at: null,
    });

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const passwordMatch = await bcrypt.compare(dto.password, user.password_hash);
    if (!passwordMatch) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const permissions = this.flattenPermissions(user);

    const payload = { sub: user.id, username: user.username, permissions, token_version: user.token_version };
    const accessToken = this.jwtService.sign(payload);
    const refreshToken = await this.issueRefreshToken(user.id);

    await this.audit.write({
      actorId: user.id,
      action: AUDIT_ACTIONS.USER_LOGIN,
      resourceType: 'user',
      resourceId: user.id,
      ipAddress: ip,
      userAgent,
      changes: { method: 'POST', path: '/api/v1/auth/login' },
    });

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

      const fullUser = await this.findUserWithPermissions(tx, { id: stored.user_id });
      if (!fullUser) {
        throw new UnauthorizedException('Account is disabled');
      }

      const permissions = this.flattenPermissions(fullUser);

      const payload = {
        sub: fullUser.id,
        username: fullUser.username,
        permissions,
        token_version: fullUser.token_version,
      };
      const accessToken = this.jwtService.sign(payload);
      const newRefreshToken = await this.issueRefreshToken(fullUser.id, tx);

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

  /**
   * Daily retention sweep for refresh_tokens. Two categories of dead rows
   * accumulate over time:
   *   - expired tokens (past expires_at) — guaranteed unusable
   *   - revoked tokens beyond the grace window — past the reuse-detection
   *     window so they're no longer needed as tombstones
   * Runs at 03:15 server time, just before the audit-log sweep at 03:30.
   */
  @Cron('15 3 * * *')
  async cleanupStaleRefreshTokens(): Promise<void> {
    const now = new Date();
    const revokedCutoff = new Date(now.getTime() - REVOKED_TOKEN_GRACE_DAYS * 24 * 60 * 60 * 1000);
    try {
      const { count } = await this.prisma.refresh_tokens.deleteMany({
        where: {
          OR: [
            { expires_at: { lt: now } },
            { revoked_at: { lt: revokedCutoff } },
          ],
        },
      });
      if (count > 0) {
        this.logger.log(`Pruned ${count} stale refresh_tokens row(s)`);
      }
    } catch (err) {
      this.logger.warn(`refresh_tokens retention sweep failed: ${err}`);
    }
  }

  async getMe(userId: string) {
    const user = await this.findUserWithPermissions(this.prisma, { id: userId, deleted_at: null });

    if (!user) {
      throw new UnauthorizedException();
    }

    return {
      message: 'Profile fetched',
      data: {
        id: user.id,
        username: user.username,
        created_at: user.created_at,
        roles: user.user_roles.map((ur) => ur.roles.name),
        permissions: this.flattenPermissions(user),
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

    invalidateJwtUserCache(userId);

    await this.audit.write({
      actorId: userId,
      action: AUDIT_ACTIONS.PASSWORD_CHANGED,
      resourceType: 'user',
      resourceId: userId,
      ipAddress: ip,
      changes: { method: 'PATCH', path: '/api/v1/auth/me/password' },
    });

    return { message: 'Password changed successfully', data: null };
  }
}
