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

    // Look the presented token up first, outside any rotation transaction, so
    // that the reuse-detection lockout below can COMMIT before we throw.
    const stored = await this.prisma.refresh_tokens.findUnique({
      where: { token_hash: hash },
      include: { users: true },
    });

    if (!stored || stored.expires_at < new Date()) {
      throw new UnauthorizedException({
        message: 'Invalid or expired refresh token',
        code: 'AUTH_REFRESH_INVALID',
      });
    }

    // Reuse detection: a revoked token being presented again means the chain
    // is compromised. Revoke every live refresh token AND bump token_version
    // so already-issued access tokens are rejected immediately (jwt.strategy
    // enforces token_version). This lockout MUST persist before we signal the
    // error — performing it inside a transaction that then throws would roll
    // it back (the original bug) — so it runs in its own committed transaction,
    // after which we invalidate the JWT cache and only then throw.
    if (stored.revoked_at !== null) {
      await this.prisma.$transaction([
        this.prisma.refresh_tokens.updateMany({
          where: { user_id: stored.user_id, revoked_at: null },
          data: { revoked_at: new Date() },
        }),
        this.prisma.users.update({
          where: { id: stored.user_id },
          data: { token_version: { increment: 1 } },
        }),
      ]);
      invalidateJwtUserCache(stored.user_id);
      this.logger.warn(
        `Refresh-token reuse detected for user ${stored.user_id}; chain revoked and sessions invalidated`,
      );
      throw new UnauthorizedException({
        message: 'Refresh token reuse detected',
        code: 'AUTH_TOKEN_REUSED',
      });
    }

    if (stored.users.deleted_at !== null) {
      throw new UnauthorizedException({
        message: 'Account is disabled',
        code: 'AUTH_ACCOUNT_DISABLED',
      });
    }

    // Atomic rotation: the conditional updateMany guarantees that only one
    // concurrent caller wins the rotation race; a loser sees count !== 1.
    const result = await this.prisma.$transaction(async (tx) => {
      const revoked = await tx.refresh_tokens.updateMany({
        where: { id: stored.id, revoked_at: null },
        data: { revoked_at: new Date() },
      });
      if (revoked.count !== 1) {
        throw new UnauthorizedException({
          message: 'Refresh token already rotated',
          code: 'AUTH_REFRESH_ALREADY_ROTATED',
        });
      }

      const fullUser = await this.findUserWithPermissions(tx, { id: stored.user_id });
      if (!fullUser) {
        throw new UnauthorizedException({
          message: 'Account is disabled',
          code: 'AUTH_ACCOUNT_DISABLED',
        });
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
