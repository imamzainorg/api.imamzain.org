import { Test, TestingModule } from "@nestjs/testing";
import { BadRequestException, HttpException, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { AuthService } from "./auth.service";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../common/audit/audit.service";
import { LoginThrottleService } from "./login-throttle.service";

jest.mock("bcryptjs", () => ({
  compare: jest.fn(),
  hash: jest.fn(),
}));

import * as bcrypt from "bcryptjs";

const mockUser = {
  id: "user-1",
  username: "admin",
  password_hash: "$2a$12$hashed",
  token_version: 1,
  must_change_password: false,
  created_at: new Date("2024-01-01"),
  deleted_at: null,
  user_roles: [
    {
      roles: {
        name: "Admin",
        role_permissions: [
          { permissions: { name: "users:read" } },
          { permissions: { name: "users:write" } },
        ],
      },
    },
  ],
};

describe("AuthService", () => {
  let service: AuthService;
  let prisma: any;
  let audit: any;
  let loginThrottle: any;

  beforeEach(async () => {
    audit = { write: jest.fn().mockResolvedValue(true), writeSync: jest.fn().mockResolvedValue(true) };
    loginThrottle = {
      secondsUntilUnlocked: jest.fn().mockResolvedValue(0),
      recordFailure: jest.fn().mockResolvedValue({ failedCount: 1, lockedUntil: null }),
      clear: jest.fn().mockResolvedValue(undefined),
    };
    (bcrypt.hash as jest.Mock).mockResolvedValue("$2a$12$dummy-hash");
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: AuditService, useValue: audit },
        { provide: LoginThrottleService, useValue: loginThrottle },
        {
          provide: PrismaService,
          useValue: {
            users: {
              findFirst: jest.fn(),
              findUnique: jest.fn(),
              update: jest.fn(),
            },
            refresh_tokens: {
              create: jest.fn().mockResolvedValue({}),
              count: jest.fn().mockResolvedValue(1),
              findFirst: jest.fn(),
              findUnique: jest.fn(),
              update: jest.fn(),
              updateMany: jest.fn().mockResolvedValue({ count: 1 }),
            },
            audit_logs: { create: jest.fn().mockResolvedValue({}) },
            $transaction: jest.fn().mockImplementation(async (cb: any) => {
              if (typeof cb === 'function') {
                return cb({
                  users: {
                    findFirst: jest.fn(),
                    findUnique: jest.fn(),
                    update: jest.fn().mockResolvedValue({}),
                  },
                  refresh_tokens: {
                    findUnique: jest.fn(),
                    update: jest.fn().mockResolvedValue({}),
                    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
                    create: jest.fn().mockResolvedValue({}),
                  },
                });
              }
              // Array form: resolve the already-issued calls, like Prisma does.
              return Promise.all(cb);
            }),
          },
        },
        {
          provide: JwtService,
          useValue: { sign: jest.fn().mockReturnValue("mock-jwt-token") },
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    prisma = module.get(PrismaService);
  });

  afterEach(() => jest.clearAllMocks());

  describe("login", () => {
    it("returns accessToken and user on valid credentials", async () => {
      prisma.users.findFirst.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const result = await service.login(
        { username: "admin", password: "secret" },
        "127.0.0.1",
        "TestAgent",
      );

      expect(result.data.accessToken).toBe("mock-jwt-token");
      expect(result.data.user.username).toBe("admin");
      expect(result.data.user.roles).toContain("Admin");
      expect(result.data.user.permissions).toContain("users:read");
      expect(result.data.user.permissions).toContain("users:write");
    });

    it("exposes must_change_password on the login response (false by default, true after an admin reset)", async () => {
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      prisma.users.findFirst.mockResolvedValue(mockUser);
      const normal = await service.login({ username: "admin", password: "secret" }, "127.0.0.1", "agent");
      prisma.users.findFirst.mockResolvedValue({ ...mockUser, must_change_password: true });
      const reset = await service.login({ username: "admin", password: "secret" }, "127.0.0.1", "agent");

      expect(normal.data.user.must_change_password).toBe(false);
      expect(reset.data.user.must_change_password).toBe(true);
    });

    it("trims the username but otherwise matches it exactly (no case folding)", async () => {
      prisma.users.findFirst.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      await service.login({ username: "  Admin  ", password: "secret" }, "127.0.0.1", "agent");

      expect(prisma.users.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { username: "Admin", deleted_at: null } }),
      );
    });

    it("starts a NEW refresh-token family on every login", async () => {
      prisma.users.findFirst.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      await service.login({ username: "admin", password: "secret" }, "127.0.0.1", "agent");
      await service.login({ username: "admin", password: "secret" }, "127.0.0.1", "agent");

      const [first, second] = prisma.refresh_tokens.create.mock.calls.map((c: any[]) => c[0].data);
      expect(first.family_id).toMatch(/^[0-9a-f-]{36}$/);
      expect(second.family_id).toMatch(/^[0-9a-f-]{36}$/);
      expect(first.family_id).not.toBe(second.family_id);
      expect(first.token_hash).not.toBe(second.token_hash);
    });

    it("deduplicates permissions coming from multiple roles", async () => {
      const multiRoleUser = {
        ...mockUser,
        user_roles: [
          {
            roles: {
              name: "Admin",
              role_permissions: [{ permissions: { name: "posts:read" } }],
            },
          },
          {
            roles: {
              name: "Editor",
              role_permissions: [
                { permissions: { name: "posts:read" } },
                { permissions: { name: "posts:write" } },
              ],
            },
          },
        ],
      };
      prisma.users.findFirst.mockResolvedValue(multiRoleUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const result = await service.login(
        { username: "admin", password: "secret" },
        "127.0.0.1",
        "agent",
      );

      const perms = result.data.user.permissions;
      expect(perms.filter((p) => p === "posts:read").length).toBe(1);
      expect(perms).toContain("posts:write");
    });

    it("throws UnauthorizedException when user not found", async () => {
      prisma.users.findFirst.mockResolvedValue(null);

      await expect(
        service.login(
          { username: "ghost", password: "x" },
          "127.0.0.1",
          "agent",
        ),
      ).rejects.toThrow(UnauthorizedException);
    });

    it("throws UnauthorizedException on wrong password", async () => {
      prisma.users.findFirst.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(
        service.login(
          { username: "admin", password: "wrong" },
          "127.0.0.1",
          "agent",
        ),
      ).rejects.toThrow(UnauthorizedException);
    });

    it("still succeeds even if audit write fails", async () => {
      prisma.users.findFirst.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      audit.writeSync.mockResolvedValueOnce(false);

      const result = await service.login(
        { username: "admin", password: "secret" },
        "127.0.0.1",
        "agent",
      );

      expect(result.data.accessToken).toBe("mock-jwt-token");
    });

    it("rejects a locked username with 429 AUTH_LOGIN_LOCKED before doing any password work", async () => {
      loginThrottle.secondsUntilUnlocked.mockResolvedValue(42);

      const attempt = service.login({ username: "admin", password: "secret" }, "127.0.0.1", "agent");

      await expect(attempt).rejects.toBeInstanceOf(HttpException);
      const err: HttpException = await attempt.catch((e) => e);
      expect(err.getStatus()).toBe(429);
      expect(err.getResponse()).toEqual(
        expect.objectContaining({ code: "AUTH_LOGIN_LOCKED", retryAfterSeconds: 42 }),
      );
      // The right password must not get through while the lock lasts, and a
      // locked name must cost the guesser no DB lookup / bcrypt work to learn from.
      expect(prisma.users.findFirst).not.toHaveBeenCalled();
      expect(bcrypt.compare).not.toHaveBeenCalled();
      expect(loginThrottle.recordFailure).not.toHaveBeenCalled();
      expect(audit.writeSync).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "USER_LOGIN_FAILED",
          changes: expect.objectContaining({ reason: "locked" }),
        }),
      );
    });

    it("spends a bcrypt comparison on a throwaway hash when the username is unknown", async () => {
      prisma.users.findFirst.mockResolvedValue(null);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(
        service.login({ username: "ghost", password: "whatever" }, "127.0.0.1", "agent"),
      ).rejects.toThrow(UnauthorizedException);

      expect(bcrypt.compare).toHaveBeenCalledTimes(1);
      expect(bcrypt.compare).toHaveBeenCalledWith("whatever", "$2a$12$dummy-hash");
    });

    it("counts the failure and audits it without recording the attempted username", async () => {
      prisma.users.findFirst.mockResolvedValue(null);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);
      loginThrottle.recordFailure.mockResolvedValue({
        failedCount: 5,
        lockedUntil: new Date("2026-09-17T10:01:00.000Z"),
      });

      await expect(
        service.login({ username: "my-actual-password", password: "x" }, "203.0.113.9", "agent"),
      ).rejects.toThrow(UnauthorizedException);

      expect(loginThrottle.recordFailure).toHaveBeenCalledTimes(1);
      const auditRow = audit.writeSync.mock.calls[0][0];
      expect(auditRow).toEqual(
        expect.objectContaining({
          action: "USER_LOGIN_FAILED",
          actorId: null,
          resourceId: null,
          ipAddress: "203.0.113.9",
          changes: expect.objectContaining({
            reason: "unknown_username",
            failed_count: 5,
            locked_until: "2026-09-17T10:01:00.000Z",
          }),
        }),
      );
      expect(JSON.stringify(auditRow)).not.toContain("my-actual-password");
    });

    it("identifies a known account by id on a wrong password", async () => {
      prisma.users.findFirst.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(
        service.login({ username: "admin", password: "wrong" }, "127.0.0.1", "agent"),
      ).rejects.toThrow(UnauthorizedException);

      expect(audit.writeSync).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "USER_LOGIN_FAILED",
          resourceId: "user-1",
          changes: expect.objectContaining({ reason: "bad_password" }),
        }),
      );
    });

    it("clears the failure counter on a successful login", async () => {
      prisma.users.findFirst.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      await service.login({ username: "admin", password: "secret" }, "127.0.0.1", "agent");

      expect(loginThrottle.clear).toHaveBeenCalledTimes(1);
      expect(loginThrottle.recordFailure).not.toHaveBeenCalled();
    });

    it("fails open when the lockout storage is unavailable", async () => {
      prisma.users.findFirst.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      loginThrottle.secondsUntilUnlocked.mockRejectedValue(new Error("relation login_attempts does not exist"));
      loginThrottle.clear.mockRejectedValue(new Error("relation login_attempts does not exist"));

      const result = await service.login({ username: "admin", password: "secret" }, "127.0.0.1", "agent");

      expect(result.data.accessToken).toBe("mock-jwt-token");
    });
  });

  describe("refresh", () => {
    const RAW = "raw-refresh-token-value";
    const FAMILY = "11111111-1111-4111-8111-111111111111";
    const SUCCESSOR = "22222222-2222-4222-8222-222222222222";
    const ago = (seconds: number) => new Date(Date.now() - seconds * 1000);

    const liveToken = (over: Record<string, unknown> = {}) => ({
      id: "tok-1",
      user_id: "user-1",
      token_hash: "hash",
      expires_at: new Date(Date.now() + 86_400_000),
      created_at: new Date(),
      revoked_at: null,
      family_id: FAMILY,
      replaced_by_id: null,
      users: { ...mockUser },
      ...over,
    });
    /** A token some request already rotated `seconds` ago. */
    const rotatedToken = (seconds: number, over: Record<string, unknown> = {}) =>
      liveToken({ revoked_at: ago(seconds), replaced_by_id: SUCCESSOR, ...over });

    let tx: any;

    beforeEach(() => {
      delete process.env.REFRESH_REUSE_GRACE_SECONDS;
      tx = {
        users: { findFirst: jest.fn().mockResolvedValue(mockUser) },
        refresh_tokens: {
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          create: jest.fn().mockResolvedValue({}),
        },
      };
      prisma.$transaction.mockImplementation(async (cb: any) => cb(tx));
      prisma.users.findFirst.mockResolvedValue(mockUser);
    });

    afterEach(() => {
      delete process.env.REFRESH_REUSE_GRACE_SECONDS;
    });

    const failure = (p: Promise<unknown>): Promise<any> => p.catch((e) => e);

    describe("rotation", () => {
      it("returns the unchanged response shape", async () => {
        prisma.refresh_tokens.findUnique.mockResolvedValue(liveToken());

        const result = await service.refresh({ refresh_token: RAW });

        expect(result).toEqual({
          message: "Tokens refreshed",
          data: { accessToken: "mock-jwt-token", refresh_token: expect.any(String) },
        });
      });

      it("revokes the old row with a pointer to its successor and creates that successor in the SAME family", async () => {
        prisma.refresh_tokens.findUnique.mockResolvedValue(liveToken());

        await service.refresh({ refresh_token: RAW });

        const update = tx.refresh_tokens.updateMany.mock.calls[0][0];
        expect(update.where).toEqual({ id: "tok-1", revoked_at: null });
        expect(update.data.revoked_at).toBeInstanceOf(Date);
        const created = tx.refresh_tokens.create.mock.calls[0][0].data;
        expect(created.family_id).toBe(FAMILY);
        expect(created.user_id).toBe("user-1");
        expect(created.id).toBe(update.data.replaced_by_id);
        // Nothing else was revoked and no session was invalidated.
        expect(tx.refresh_tokens.updateMany).toHaveBeenCalledTimes(1);
        expect(prisma.users.update).not.toHaveBeenCalled();
      });

      it("rejects an unknown token with AUTH_REFRESH_INVALID", async () => {
        prisma.refresh_tokens.findUnique.mockResolvedValue(null);

        const err = await failure(service.refresh({ refresh_token: RAW }));

        expect(err).toBeInstanceOf(UnauthorizedException);
        expect(err.getResponse()).toMatchObject({ code: "AUTH_REFRESH_INVALID" });
      });

      it("rejects an expired token with AUTH_REFRESH_INVALID", async () => {
        prisma.refresh_tokens.findUnique.mockResolvedValue(liveToken({ expires_at: ago(5) }));

        const err = await failure(service.refresh({ refresh_token: RAW }));

        expect(err.getResponse()).toMatchObject({ code: "AUTH_REFRESH_INVALID" });
        expect(tx.refresh_tokens.create).not.toHaveBeenCalled();
      });

      it("rejects a soft-deleted account with AUTH_ACCOUNT_DISABLED", async () => {
        prisma.refresh_tokens.findUnique.mockResolvedValue(
          liveToken({ users: { ...mockUser, deleted_at: new Date() } }),
        );

        const err = await failure(service.refresh({ refresh_token: RAW }));

        expect(err.getResponse()).toMatchObject({ code: "AUTH_ACCOUNT_DISABLED" });
        expect(tx.refresh_tokens.updateMany).not.toHaveBeenCalled();
      });
    });

    describe("a rotated token presented again INSIDE the grace window (benign concurrent refresh)", () => {
      it("issues a fresh token in the same family and revokes nothing", async () => {
        prisma.refresh_tokens.findUnique.mockResolvedValue(rotatedToken(2));

        const result = await service.refresh({ refresh_token: RAW }, "203.0.113.5", "agent");

        expect(result.data.refresh_token).toEqual(expect.any(String));
        expect(prisma.refresh_tokens.create).toHaveBeenCalledWith({
          data: expect.objectContaining({ user_id: "user-1", family_id: FAMILY }),
        });
        expect(prisma.refresh_tokens.updateMany).not.toHaveBeenCalled();
        expect(prisma.users.update).not.toHaveBeenCalled();
        expect(audit.writeSync).not.toHaveBeenCalled();
      });

      it("also covers the loser of a rotation race: the conditional update matches nothing, the re-read shows a fresh rotation", async () => {
        prisma.refresh_tokens.findUnique
          .mockResolvedValueOnce(liveToken()) // both requests read it live…
          .mockResolvedValueOnce(rotatedToken(0)); // …the winner then rotated it
        tx.refresh_tokens.updateMany.mockResolvedValue({ count: 0 });

        const result = await service.refresh({ refresh_token: RAW });

        expect(result.message).toBe("Tokens refreshed");
        expect(tx.refresh_tokens.create).not.toHaveBeenCalled(); // the losing transaction wrote nothing
        expect(prisma.refresh_tokens.create).toHaveBeenCalledWith({
          data: expect.objectContaining({ family_id: FAMILY }),
        });
        expect(prisma.refresh_tokens.updateMany).not.toHaveBeenCalled();
        expect(audit.writeSync).not.toHaveBeenCalled();
      });

      it("does not resurrect a session that logged out after the rotation (no live token left in the family)", async () => {
        prisma.refresh_tokens.findUnique.mockResolvedValue(rotatedToken(2));
        prisma.refresh_tokens.count.mockResolvedValue(0);

        const err = await failure(service.refresh({ refresh_token: RAW }));

        expect(err.getResponse()).toMatchObject({ code: "AUTH_REFRESH_INVALID" });
        expect(prisma.refresh_tokens.create).not.toHaveBeenCalled();
      });

      it("still refuses a disabled account", async () => {
        prisma.refresh_tokens.findUnique.mockResolvedValue(
          rotatedToken(2, { users: { ...mockUser, deleted_at: new Date() } }),
        );

        const err = await failure(service.refresh({ refresh_token: RAW }));

        expect(err.getResponse()).toMatchObject({ code: "AUTH_ACCOUNT_DISABLED" });
      });

      it("honours a longer REFRESH_REUSE_GRACE_SECONDS", async () => {
        process.env.REFRESH_REUSE_GRACE_SECONDS = "30";
        prisma.refresh_tokens.findUnique.mockResolvedValue(rotatedToken(20));

        const result = await service.refresh({ refresh_token: RAW });

        expect(result.message).toBe("Tokens refreshed");
      });
    });

    describe("a rotated token presented again AFTER the grace window (theft)", () => {
      it("revokes that family only, writes an audit row and answers 401 AUTH_TOKEN_REUSED", async () => {
        prisma.refresh_tokens.findUnique.mockResolvedValue(rotatedToken(60));

        const err = await failure(service.refresh({ refresh_token: RAW }, "203.0.113.5", "TestAgent"));

        expect(err).toBeInstanceOf(UnauthorizedException);
        expect(err.getResponse()).toMatchObject({ code: "AUTH_TOKEN_REUSED" });
        // Scoped to the family — never "every token of the user".
        expect(prisma.refresh_tokens.updateMany).toHaveBeenCalledTimes(1);
        expect(prisma.refresh_tokens.updateMany).toHaveBeenCalledWith({
          where: { user_id: "user-1", family_id: FAMILY, revoked_at: null },
          data: { revoked_at: expect.any(Date) },
        });
        // The user's other devices keep working: no token_version bump, nothing issued.
        expect(prisma.users.update).not.toHaveBeenCalled();
        expect(prisma.refresh_tokens.create).not.toHaveBeenCalled();
        expect(tx.refresh_tokens.create).not.toHaveBeenCalled();
      });

      it("audits with the family id and never a token value or hash", async () => {
        prisma.refresh_tokens.updateMany.mockResolvedValue({ count: 2 });
        prisma.refresh_tokens.findUnique.mockResolvedValue(rotatedToken(60, { token_hash: "secret-hash-value" }));

        await failure(service.refresh({ refresh_token: RAW }, "203.0.113.5", "TestAgent"));

        expect(audit.writeSync).toHaveBeenCalledTimes(1);
        const row = audit.writeSync.mock.calls[0][0];
        expect(row).toEqual(
          expect.objectContaining({
            actorId: "user-1",
            action: "REFRESH_TOKEN_REUSE_DETECTED",
            resourceType: "user",
            resourceId: "user-1",
            ipAddress: "203.0.113.5",
            userAgent: "TestAgent",
            changes: expect.objectContaining({ family_id: FAMILY, revoked_tokens: 2 }),
          }),
        );
        const serialized = JSON.stringify(row);
        expect(serialized).not.toContain(RAW);
        expect(serialized).not.toContain("secret-hash-value");
      });

      it("commits the family revocation BEFORE it throws — outside any transaction", async () => {
        prisma.refresh_tokens.findUnique.mockResolvedValue(rotatedToken(60));
        let revokedBeforeThrow = false;
        prisma.refresh_tokens.updateMany.mockImplementation(async () => {
          revokedBeforeThrow = true;
          return { count: 1 };
        });

        const err = await failure(service.refresh({ refresh_token: RAW }));

        expect(revokedBeforeThrow).toBe(true);
        expect(err.getResponse()).toMatchObject({ code: "AUTH_TOKEN_REUSED" });
        expect(prisma.$transaction).not.toHaveBeenCalled();
      });

      it("REFRESH_REUSE_GRACE_SECONDS=0 turns the grace off", async () => {
        process.env.REFRESH_REUSE_GRACE_SECONDS = "0";
        prisma.refresh_tokens.findUnique.mockResolvedValue(rotatedToken(0.5));

        const err = await failure(service.refresh({ refresh_token: RAW }));

        expect(err.getResponse()).toMatchObject({ code: "AUTH_TOKEN_REUSED" });
      });

      it("clamps an oversized grace to 60 seconds", async () => {
        process.env.REFRESH_REUSE_GRACE_SECONDS = "9999";
        prisma.refresh_tokens.findUnique.mockResolvedValue(rotatedToken(61));

        const err = await failure(service.refresh({ refresh_token: RAW }));

        expect(err.getResponse()).toMatchObject({ code: "AUTH_TOKEN_REUSED" });
      });
    });

    describe("a token revoked by logout / logout-all / a password change (dead, not rotated)", () => {
      it("cannot refresh — 401 AUTH_REFRESH_INVALID, no grace — and does NOT touch any other session", async () => {
        prisma.refresh_tokens.findUnique.mockResolvedValue(liveToken({ revoked_at: ago(1), replaced_by_id: null }));

        const err = await failure(service.refresh({ refresh_token: RAW }));

        expect(err).toBeInstanceOf(UnauthorizedException);
        expect(err.getResponse()).toMatchObject({ code: "AUTH_REFRESH_INVALID" });
        expect(prisma.refresh_tokens.updateMany).not.toHaveBeenCalled();
        expect(prisma.refresh_tokens.create).not.toHaveBeenCalled();
        expect(prisma.users.update).not.toHaveBeenCalled();
        expect(audit.writeSync).not.toHaveBeenCalled();
      });

      it("stays dead however long ago it was revoked", async () => {
        prisma.refresh_tokens.findUnique.mockResolvedValue(liveToken({ revoked_at: ago(3600), replaced_by_id: null }));

        const err = await failure(service.refresh({ refresh_token: RAW }));

        expect(err.getResponse()).toMatchObject({ code: "AUTH_REFRESH_INVALID" });
      });
    });
  });

  describe("logout", () => {
    it("ends the session of the supplied refresh token — its whole family — and leaves access tokens alone", async () => {
      prisma.refresh_tokens.findFirst.mockResolvedValue({ family_id: "fam-1" });

      await service.logout("user-1", "raw-refresh-token", "203.0.113.5", "TestAgent");

      expect(prisma.refresh_tokens.findFirst).toHaveBeenCalledWith({
        where: { user_id: "user-1", token_hash: expect.any(String) },
        select: { family_id: true },
      });
      expect(prisma.refresh_tokens.updateMany).toHaveBeenCalledWith({
        where: { user_id: "user-1", family_id: "fam-1", revoked_at: null },
        data: { revoked_at: expect.any(Date) },
      });
      expect(prisma.users.update).not.toHaveBeenCalled();
    });

    it("revokes nothing for a token it does not know (idempotent)", async () => {
      prisma.refresh_tokens.findFirst.mockResolvedValue(null);

      const result = await service.logout("user-1", "unknown-token");

      expect(prisma.refresh_tokens.updateMany).not.toHaveBeenCalled();
      expect(result.message).toBe("Logged out successfully");
    });

    it("audits a session logout without the token", async () => {
      prisma.refresh_tokens.findFirst.mockResolvedValue({ family_id: "fam-1" });
      prisma.refresh_tokens.updateMany.mockResolvedValue({ count: 1 });

      await service.logout("user-1", "raw-refresh-token", "203.0.113.5", "TestAgent");

      expect(audit.writeSync).toHaveBeenCalledTimes(1);
      const row = audit.writeSync.mock.calls[0][0];
      expect(row).toEqual(
        expect.objectContaining({
          actorId: "user-1",
          action: "USER_LOGOUT",
          resourceType: "user",
          resourceId: "user-1",
          ipAddress: "203.0.113.5",
          userAgent: "TestAgent",
          changes: expect.objectContaining({ revoked_tokens: 1 }),
        }),
      );
      expect(JSON.stringify(row)).not.toContain("raw-refresh-token");
    });

    it("logout-all revokes every refresh token AND bumps token_version so access tokens die", async () => {
      await service.logout("user-1");

      expect(prisma.refresh_tokens.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { user_id: "user-1", revoked_at: null } }),
      );
      expect(prisma.users.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "user-1" },
          data: { token_version: { increment: 1 } },
        }),
      );
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it("audits logout-all with the number of sessions it ended", async () => {
      prisma.refresh_tokens.updateMany.mockResolvedValue({ count: 3 });

      await service.logout("user-1", undefined, "203.0.113.5", "TestAgent");

      expect(audit.writeSync).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: "user-1",
          action: "USER_LOGOUT_ALL",
          resourceId: "user-1",
          ipAddress: "203.0.113.5",
          changes: expect.objectContaining({ revoked_tokens: 3 }),
        }),
      );
    });
  });

  describe("getMe", () => {
    it("returns profile with roles and permissions", async () => {
      prisma.users.findFirst.mockResolvedValue(mockUser);

      const result = await service.getMe("user-1");

      expect(result.data.id).toBe("user-1");
      expect(result.data.username).toBe("admin");
      expect(result.data.roles).toContain("Admin");
      expect(result.data.permissions).toContain("users:read");
    });

    it("exposes must_change_password", async () => {
      prisma.users.findFirst.mockResolvedValue({ ...mockUser, must_change_password: true });

      const result = await service.getMe("user-1");

      expect(result.data.must_change_password).toBe(true);
    });

    it("throws UnauthorizedException when user not found", async () => {
      prisma.users.findFirst.mockResolvedValue(null);

      await expect(service.getMe("nonexistent")).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe("changePassword", () => {
    it("updates password_hash on correct current password", async () => {
      prisma.users.findFirst.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      (bcrypt.hash as jest.Mock).mockResolvedValue("$2a$12$newhash");

      const txUsersUpdate = jest.fn().mockResolvedValue({});
      const txRefreshUpdateMany = jest.fn().mockResolvedValue({ count: 0 });
      prisma.$transaction.mockImplementation(async (cb: any) =>
        cb({
          users: { update: txUsersUpdate },
          refresh_tokens: { updateMany: txRefreshUpdateMany },
        }),
      );

      const result = await service.changePassword(
        "user-1",
        { currentPassword: "old", newPassword: "new" },
        "127.0.0.1",
      );

      expect(txUsersUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "user-1" },
          data: expect.objectContaining({ password_hash: "$2a$12$newhash" }),
        }),
      );
      expect(txRefreshUpdateMany).toHaveBeenCalled();
      expect(result.message).toBe("Password changed successfully");
    });

    describe("must_change_password", () => {
      let txUsersUpdate: jest.Mock;

      beforeEach(() => {
        (bcrypt.compare as jest.Mock).mockResolvedValue(true);
        (bcrypt.hash as jest.Mock).mockResolvedValue("$2a$12$newhash");
        txUsersUpdate = jest.fn().mockResolvedValue({});
        prisma.$transaction.mockImplementation(async (cb: any) =>
          cb({ users: { update: txUsersUpdate }, refresh_tokens: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) } }),
        );
      });

      it("clears the flag when the user changes their own password", async () => {
        prisma.users.findFirst.mockResolvedValue({ ...mockUser, must_change_password: true });

        await service.changePassword("user-1", { currentPassword: "temp-password", newPassword: "my-own-password" }, "127.0.0.1");

        expect(txUsersUpdate).toHaveBeenCalledWith(
          expect.objectContaining({ data: expect.objectContaining({ must_change_password: false }) }),
        );
      });

      it("refuses to \"change\" a flagged password to itself — that would clear the flag and keep the admin's password", async () => {
        prisma.users.findFirst.mockResolvedValue({ ...mockUser, must_change_password: true });

        const err = await service
          .changePassword("user-1", { currentPassword: "temp-password", newPassword: "temp-password" }, "127.0.0.1")
          .catch((e) => e);

        expect(err).toBeInstanceOf(BadRequestException);
        expect(err.getResponse()).toMatchObject({ code: "PASSWORD_MUST_DIFFER" });
        expect(txUsersUpdate).not.toHaveBeenCalled();
      });

      it("does not apply that rule to an unflagged account", async () => {
        prisma.users.findFirst.mockResolvedValue(mockUser);

        await service.changePassword("user-1", { currentPassword: "same-password", newPassword: "same-password" }, "127.0.0.1");

        expect(txUsersUpdate).toHaveBeenCalled();
      });
    });

    it("throws UnauthorizedException when user not found", async () => {
      prisma.users.findFirst.mockResolvedValue(null);

      await expect(
        service.changePassword(
          "ghost",
          { currentPassword: "x", newPassword: "y" },
          "127.0.0.1",
        ),
      ).rejects.toThrow(UnauthorizedException);
    });

    it("throws UnauthorizedException on wrong current password", async () => {
      prisma.users.findFirst.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(
        service.changePassword(
          "user-1",
          { currentPassword: "wrong", newPassword: "new" },
          "127.0.0.1",
        ),
      ).rejects.toThrow(UnauthorizedException);
    });
  });
});
