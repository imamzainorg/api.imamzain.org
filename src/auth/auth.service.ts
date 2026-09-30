import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { cronsDisabled } from '../common/utils/cron.util';
import { JwtService } from '@nestjs/jwt';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import { AUDIT_ACTIONS } from '../common/audit/audit.actions';
import { resolveBcryptRounds } from '../common/utils/bcrypt.util';
import { invalidateJwtUserCache } from './strategies/jwt.strategy';
import { LoginFailureState, LoginThrottleService, loginThrottleKey } from './login-throttle.service';
import { resolveRefreshReuseGraceMs } from './auth-config.util';
import { ChangePasswordDto, LoginDto, RefreshTokenDto } from './dto/auth.dto';

const REFRESH_TOKEN_TTL_DAYS = 7;
// Keep revoked tokens around for 30 days so the reuse-detection in `refresh`
// can still catch a stolen-and-replayed token even after rotation. Past that
// window, the original session is long gone and the row is dead weight.
const REVOKED_TOKEN_GRACE_DAYS = 30;

type PrismaTxClient = Prisma.TransactionClient | PrismaService;

type StoredRefreshToken = Prisma.refresh_tokensGetPayload<{ include: { users: true } }>;

/** Internal signal that this caller lost the conditional rotation race; never leaves the service. */
class RotationLostError extends Error {}

const refreshInvalid = () =>
  new UnauthorizedException({ message: 'Invalid or expired refresh token', code: 'AUTH_REFRESH_INVALID' });
const accountDisabled = () =>
  new UnauthorizedException({ message: 'Account is disabled', code: 'AUTH_ACCOUNT_DISABLED' });

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
    private readonly loginThrottle: LoginThrottleService,
  ) {}

  // A real bcrypt hash at the configured cost, compared against whenever the
  // username doesn't exist. Without it an unknown username answers in ~1 ms
  // and a known one in ~250 ms — a free username oracle. Built lazily once.
  private dummyHash?: Promise<string>;

  private getDummyHash(): Promise<string> {
    this.dummyHash ??= bcrypt.hash(crypto.randomBytes(24).toString('hex'), resolveBcryptRounds());
    return this.dummyHash;
  }

  /**
   * The lockout is defence in depth on top of the per-IP route throttle: if
   * its storage hiccups, log and let the login proceed rather than take
   * authentication down with it.
   */
  private async lockSecondsRemaining(key: string): Promise<number> {
    try {
      return await this.loginThrottle.secondsUntilUnlocked(key);
    } catch (err) {
      this.logger.warn(`Login lockout check failed (continuing): ${err}`);
      return 0;
    }
  }

  private async recordLoginFailure(key: string): Promise<LoginFailureState | null> {
    try {
      return await this.loginThrottle.recordFailure(key);
    } catch (err) {
      this.logger.warn(`Login failure could not be counted: ${err}`);
      return null;
    }
  }

  private hashToken(raw: string): string {
    return crypto.createHash('sha256').update(raw).digest('hex');
  }

  /**
   * Store a new refresh token. Without `familyId` it starts a new family (a
   * login); rotation and the grace path pass the family they belong to.
   */
  private async issueRefreshToken(
    userId: string,
    tx: PrismaTxClient = this.prisma,
    opts: { familyId?: string; id?: string } = {},
  ): Promise<string> {
    const raw = crypto.randomBytes(40).toString('hex');
    const hash = this.hashToken(raw);
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + REFRESH_TOKEN_TTL_DAYS);

    await tx.refresh_tokens.create({
      data: {
        id: opts.id,
        user_id: userId,
        token_hash: hash,
        expires_at: expiresAt,
        family_id: opts.familyId ?? crypto.randomUUID(),
      },
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
    const auditBase = {
      actorId: null,
      action: AUDIT_ACTIONS.USER_LOGIN_FAILED,
      resourceType: 'user',
      ipAddress: ip,
      userAgent,
    } as const;

    // Per-username back-off, checked before any password work so a locked
    // name costs the guesser nothing to learn from. Applies to unknown
    // usernames too (no existence oracle) and rejects even the right password
    // while it lasts.
    // Trimmed, then matched byte-for-byte: a pasted trailing space must not
    // fail a login, but "Admin" and "admin" are different accounts (usernames
    // are case-sensitive; only user/role CREATION refuses look-alike names).
    const username = dto.username.trim();
    const throttleKey = loginThrottleKey(username);
    const retryAfterSeconds = await this.lockSecondsRemaining(throttleKey);
    if (retryAfterSeconds > 0) {
      await this.audit.writeSync({
        ...auditBase,
        changes: { method: 'POST', path: '/api/v1/auth/login', reason: 'locked', retry_after_seconds: retryAfterSeconds },
      });
      throw new HttpException(
        {
          message: 'Too many failed login attempts for this username — try again later',
          code: 'AUTH_LOGIN_LOCKED',
          retryAfterSeconds,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const user = await this.findUserWithPermissions(this.prisma, {
      username,
      deleted_at: null,
    });

    // Always spend one bcrypt comparison — against a throwaway hash when the
    // username is unknown — so both failure modes take the same time.
    const passwordMatch = await bcrypt.compare(dto.password, user?.password_hash ?? (await this.getDummyHash()));

    if (!user || !passwordMatch) {
      const failure = await this.recordLoginFailure(throttleKey);
      // The attempted username is deliberately NOT recorded: it is often a
      // mistyped password. A known account is identified by id instead.
      await this.audit.writeSync({
        ...auditBase,
        resourceId: user?.id ?? null,
        changes: {
          method: 'POST',
          path: '/api/v1/auth/login',
          reason: user ? 'bad_password' : 'unknown_username',
          failed_count: failure?.failedCount ?? null,
          locked_until: failure?.lockedUntil?.toISOString() ?? null,
        },
      });
      throw new UnauthorizedException('Invalid credentials');
    }

    try {
      await this.loginThrottle.clear(throttleKey);
    } catch (err) {
      this.logger.warn(`Login failure counter could not be cleared: ${err}`);
    }

    const permissions = this.flattenPermissions(user);

    const payload = { sub: user.id, username: user.username, permissions, token_version: user.token_version };
    const accessToken = this.jwtService.sign(payload);
    const refreshToken = await this.issueRefreshToken(user.id);

    // writeSync (not fire-and-forget): login is a compliance-trail event —
    // the ip/agent row must exist once the response is out.
    await this.audit.writeSync({
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
          must_change_password: user.must_change_password,
        },
      },
    };
  }

  private findStoredRefreshToken(hash: string): Promise<StoredRefreshToken | null> {
    return this.prisma.refresh_tokens.findUnique({
      where: { token_hash: hash },
      include: { users: true },
    });
  }

  /**
   * A fresh access token plus a refresh token in `familyId`. Runs on the caller's
   * client so rotation can do it inside its transaction.
   */
  private async mintSession(db: PrismaTxClient, userId: string, familyId: string, refreshTokenId?: string) {
    const user = await this.findUserWithPermissions(db, { id: userId, deleted_at: null });
    if (!user) throw accountDisabled();

    const accessToken = this.jwtService.sign({
      sub: user.id,
      username: user.username,
      permissions: this.flattenPermissions(user),
      token_version: user.token_version,
    });
    const refreshToken = await this.issueRefreshToken(user.id, db, { familyId, id: refreshTokenId });
    return { accessToken, refreshToken };
  }

  private refreshResponse(session: { accessToken: string; refreshToken: string }) {
    return {
      message: 'Tokens refreshed',
      data: { accessToken: session.accessToken, refresh_token: session.refreshToken },
    };
  }

  async refresh(dto: RefreshTokenDto, ip = '', userAgent = '') {
    const hash = this.hashToken(dto.refresh_token);

    // Look the presented token up first, outside any rotation transaction, so
    // that the reuse-detection revocation below can COMMIT before we throw.
    const stored = await this.findStoredRefreshToken(hash);

    if (!stored || stored.expires_at < new Date()) throw refreshInvalid();

    if (stored.revoked_at !== null) return this.refreshRevokedToken(stored, ip, userAgent);

    if (stored.users.deleted_at !== null) throw accountDisabled();

    try {
      return await this.rotateRefreshToken(stored);
    } catch (err) {
      if (!(err instanceof RotationLostError)) throw err;
    }

    // Another request rotated this token (or a logout revoked it) between our
    // read and the conditional update. Re-read it and apply the policy a request
    // arriving a moment later would get: inside the grace window that is a
    // benign second refresh, not an error.
    const current = await this.findStoredRefreshToken(hash);
    if (!current || current.revoked_at === null) {
      throw new UnauthorizedException({
        message: 'Refresh token already rotated',
        code: 'AUTH_REFRESH_ALREADY_ROTATED',
      });
    }
    return this.refreshRevokedToken(current, ip, userAgent);
  }

  /**
   * Atomic rotation: the conditional updateMany guarantees that only one
   * concurrent caller wins; a loser sees count !== 1 and the transaction (which
   * has written nothing) unwinds.
   */
  private async rotateRefreshToken(stored: StoredRefreshToken) {
    const successorId = crypto.randomUUID();
    const session = await this.prisma.$transaction(async (tx) => {
      const revoked = await tx.refresh_tokens.updateMany({
        where: { id: stored.id, revoked_at: null },
        data: { revoked_at: new Date(), replaced_by_id: successorId },
      });
      if (revoked.count !== 1) throw new RotationLostError();

      return this.mintSession(tx, stored.user_id, stored.family_id, successorId);
    });
    return this.refreshResponse(session);
  }

  /**
   * A revoked token was presented. What that means depends on how it died:
   *
   * - no successor (replaced_by_id null): logout, logout-all, a password change
   *   or an earlier family revocation ended it. It is dead — no grace — but it is
   *   NOT evidence of theft. The old code revoked every session of the user here,
   *   so a stale token on a logged-out device signed the user out everywhere.
   * - rotated within the grace window: a benign concurrent refresh (two tabs, a
   *   retried request). Issue a sibling in the same family; revoke nothing.
   * - rotated longer ago: someone is replaying a token the real client already
   *   moved past. Treat as theft and revoke that family — only that family.
   */
  private async refreshRevokedToken(stored: StoredRefreshToken, ip: string, userAgent: string) {
    if (stored.replaced_by_id === null || stored.revoked_at === null) throw refreshInvalid();

    const graceMs = resolveRefreshReuseGraceMs();
    const rotatedAgoMs = Date.now() - stored.revoked_at.getTime();
    if (graceMs > 0 && rotatedAgoMs < graceMs) return this.refreshWithinGrace(stored);

    // This revocation MUST persist before we signal the error — inside a
    // transaction that then throws it would roll back (the original bug) — so it
    // is a plain committed statement, and only then do we throw.
    const { count } = await this.prisma.refresh_tokens.updateMany({
      where: { user_id: stored.user_id, family_id: stored.family_id, revoked_at: null },
      data: { revoked_at: new Date() },
    });
    // The family id is an opaque uuid; never put a token (or its hash) in an audit row.
    await this.audit.writeSync({
      actorId: stored.user_id,
      action: AUDIT_ACTIONS.REFRESH_TOKEN_REUSE_DETECTED,
      resourceType: 'user',
      resourceId: stored.user_id,
      ipAddress: ip || null,
      userAgent: userAgent || null,
      changes: {
        method: 'POST',
        path: '/api/v1/auth/refresh',
        family_id: stored.family_id,
        revoked_tokens: count,
        rotated_seconds_ago: Math.floor(rotatedAgoMs / 1000),
      },
    });
    this.logger.warn(
      `Refresh-token reuse detected for user ${stored.user_id}; session family ${stored.family_id} revoked (${count} token(s))`,
    );
    throw new UnauthorizedException({
      message: 'Refresh token reuse detected',
      code: 'AUTH_TOKEN_REUSED',
    });
  }

  private async refreshWithinGrace(stored: StoredRefreshToken) {
    if (stored.users.deleted_at !== null) throw accountDisabled();

    // Only while the session is still alive: a logout that landed after the
    // rotation ended the family, and a token from inside the window must not
    // resurrect it.
    const live = await this.prisma.refresh_tokens.count({
      where: { family_id: stored.family_id, revoked_at: null, expires_at: { gt: new Date() } },
    });
    if (live === 0) throw refreshInvalid();

    return this.refreshResponse(await this.mintSession(this.prisma, stored.user_id, stored.family_id));
  }

  async logout(userId: string, rawRefreshToken?: string, ip = '', userAgent = '') {
    let revokedTokens: number;

    if (rawRefreshToken) {
      // A session is a family: end all of it, so a sibling token handed out by a
      // grace-window refresh cannot outlive the logout. Unknown / foreign tokens
      // revoke nothing (logout stays idempotent).
      const token = await this.prisma.refresh_tokens.findFirst({
        where: { user_id: userId, token_hash: this.hashToken(rawRefreshToken) },
        select: { family_id: true },
      });
      revokedTokens = token
        ? (
            await this.prisma.refresh_tokens.updateMany({
              where: { user_id: userId, family_id: token.family_id, revoked_at: null },
              data: { revoked_at: new Date() },
            })
          ).count
        : 0;

      await this.audit.writeSync({
        actorId: userId,
        action: AUDIT_ACTIONS.USER_LOGOUT,
        resourceType: 'user',
        resourceId: userId,
        ipAddress: ip || null,
        userAgent: userAgent || null,
        changes: { method: 'POST', path: '/api/v1/auth/logout', revoked_tokens: revokedTokens },
      });
    } else {
      // "Log out everywhere" must end every outstanding ACCESS token too, not
      // just the refresh tokens: access tokens live JWT_EXPIRES_IN (24 h by
      // default) and are only re-checked against users.token_version. Bump it
      // and drop the JWT cache, exactly as changePassword does — the calling
      // device's own access token dies with the rest, which is the point.
      const [revoked] = await this.prisma.$transaction([
        this.prisma.refresh_tokens.updateMany({
          where: { user_id: userId, revoked_at: null },
          data: { revoked_at: new Date() },
        }),
        this.prisma.users.update({
          where: { id: userId },
          data: { token_version: { increment: 1 } },
        }),
      ]);
      invalidateJwtUserCache(userId);
      revokedTokens = revoked.count;

      await this.audit.writeSync({
        actorId: userId,
        action: AUDIT_ACTIONS.USER_LOGOUT_ALL,
        resourceType: 'user',
        resourceId: userId,
        ipAddress: ip || null,
        userAgent: userAgent || null,
        changes: { method: 'POST', path: '/api/v1/auth/logout', revoked_tokens: revokedTokens },
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
    if (cronsDisabled()) return;
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
        must_change_password: user.must_change_password,
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

    // "Changing" an admin-set password to itself would clear the flag while
    // keeping the password the admin chose.
    if (user.must_change_password && dto.newPassword === dto.currentPassword) {
      throw new BadRequestException({
        message: 'Choose a new password that differs from the temporary one',
        code: 'PASSWORD_MUST_DIFFER',
      });
    }

    const newHash = await bcrypt.hash(dto.newPassword, resolveBcryptRounds());

    // Password update + session revocation must be atomic — a crash between
    // them would leave old refresh tokens valid after a "successful" change.
    await this.prisma.$transaction(async (tx) => {
      await tx.users.update({
        where: { id: userId },
        data: {
          password_hash: newHash,
          updated_at: new Date(),
          token_version: { increment: 1 },
          // The user now holds a password they chose, so an admin reset no longer applies.
          must_change_password: false,
        },
      });

      await tx.refresh_tokens.updateMany({
        where: { user_id: userId, revoked_at: null },
        data: { revoked_at: new Date() },
      });
    });

    invalidateJwtUserCache(userId);

    // writeSync: password changes are compliance-trail events like logins.
    await this.audit.writeSync({
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
