import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { UsersService } from './users.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import { AUDIT_ACTIONS } from '../common/audit/audit.actions';

jest.mock('bcryptjs');

const baseUser = {
  id: 'user-1',
  username: 'alice',
  password_hash: '$2a$12$hash',
  created_at: new Date(),
  updated_at: new Date(),
  deleted_at: null,
  user_roles: [],
};

// A super-admin-ish actor: holds every permission the test roles reference, so
// the privilege-envelope guard passes for the happy-path cases.
const actor = {
  id: 'actor-1',
  username: 'admin',
  permissions: ['users:create', 'users:update', 'users:delete', 'posts:create'],
};

/** A target user whose roles grant `roles:update` — outside `actor`'s envelope. */
const superAdminUser = {
  ...baseUser,
  id: 'super-1',
  username: 'root',
  user_roles: [
    {
      role_id: 'role-super',
      roles: {
        name: 'super-admin',
        role_permissions: [{ permissions: { name: 'roles:update' } }, { permissions: { name: 'users:update' } }],
      },
    },
  ],
};

describe('UsersService', () => {
  let service: UsersService;
  let prisma: any;
  let audit: any;

  beforeEach(async () => {
    const prismaMock: any = {
      users: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        count: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      user_roles: {
        upsert: jest.fn(),
        create: jest.fn(),
        findUnique: jest.fn(),
        delete: jest.fn(),
        deleteMany: jest.fn(),
      },
      roles: { findUnique: jest.fn() },
      // The last-administrator guard reads these; 0 permissions = guard is a no-op
      // unless a test opts in with a real count + users.findMany snapshot.
      permissions: { count: jest.fn().mockResolvedValue(0) },
      refresh_tokens: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      audit_logs: { create: jest.fn().mockResolvedValue({}) },
    };
    // Interactive transactions receive the same mock object as `tx`, so
    // `expect(prisma.users.update)…` works whether the service calls
    // `this.prisma.X` or `tx.X`. Array form resolves the already-issued calls.
    prismaMock.$transaction = jest.fn((arg: any) =>
      typeof arg === 'function' ? arg(prismaMock) : Promise.all(arg),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: AuditService, useValue: { write: jest.fn().mockResolvedValue(true) } },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
    prisma = module.get(PrismaService);
    audit = module.get(AuditService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('findAll', () => {
    it('returns paginated users', async () => {
      prisma.users.findMany.mockResolvedValue([baseUser]);
      prisma.users.count.mockResolvedValue(1);

      const result = await service.findAll(1, 10);

      expect(result.data.items).toHaveLength(1);
      expect(result.data.pagination).toEqual({ page: 1, limit: 10, total: 1, pages: 1 });
    });

    it('calculates skip from page and limit', async () => {
      prisma.users.findMany.mockResolvedValue([]);
      prisma.users.count.mockResolvedValue(0);

      await service.findAll(3, 10);

      expect(prisma.users.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 20, take: 10 }),
      );
    });
  });

  describe('findOne', () => {
    it('returns user with aggregated permissions', async () => {
      const userWithRoles = {
        ...baseUser,
        user_roles: [
          {
            roles: {
              name: 'Admin',
              role_permissions: [{ permissions: { name: 'users:read' } }],
            },
          },
        ],
      };
      prisma.users.findFirst.mockResolvedValue(userWithRoles);

      const result = await service.findOne('user-1');

      expect(result.data.id).toBe('user-1');
      expect(result.data.permissions).toContain('users:read');
      expect(result.data).not.toHaveProperty('password_hash');
      expect(result.data).not.toHaveProperty('token_version');
      expect(result.data).not.toHaveProperty('deleted_at');
    });

    it('throws NotFoundException when user not found', async () => {
      prisma.users.findFirst.mockResolvedValue(null);

      await expect(service.findOne('ghost')).rejects.toThrow(NotFoundException);
    });
  });

  describe('create', () => {
    it('creates user and returns hydrated detail without password_hash', async () => {
      // First findFirst is the username-conflict check (null); second is findOne's hydrate fetch.
      prisma.users.findFirst.mockResolvedValueOnce(null).mockResolvedValue(baseUser);
      (bcrypt.hash as jest.Mock).mockResolvedValue('$2a$12$newhash');
      prisma.users.create.mockResolvedValue({ ...baseUser, password_hash: '$2a$12$newhash' });

      const result = await service.create({ username: 'alice', password: 'secret' }, 'actor-1');

      expect(result.data).not.toHaveProperty('password_hash');
      expect(result.message).toBe('User created');
      // Create now returns the same shape findOne does: aggregated permissions + user_roles[].
      expect(Array.isArray(result.data.permissions)).toBe(true);
    });

    it('throws ConflictException when username already taken', async () => {
      prisma.users.findFirst.mockResolvedValue(baseUser);

      await expect(
        service.create({ username: 'alice', password: 'secret' }, 'actor-1'),
      ).rejects.toThrow(ConflictException);
    });

    it('looks for a live account with the same name in ANY letter case', async () => {
      prisma.users.findFirst.mockResolvedValueOnce(null).mockResolvedValue(baseUser);
      (bcrypt.hash as jest.Mock).mockResolvedValue('$2a$12$newhash');
      prisma.users.create.mockResolvedValue(baseUser);

      await service.create({ username: 'Alice', password: 'secret' }, 'actor-1');

      expect(prisma.users.findFirst).toHaveBeenNthCalledWith(1, {
        where: { username: { equals: 'Alice', mode: 'insensitive' }, deleted_at: null },
        select: { id: true },
      });
    });

    it('rejects a case-variant of an existing username with the same 409 as an exact clash', async () => {
      prisma.users.findFirst.mockResolvedValue({ ...baseUser, username: 'Admin' });

      const err = await service.create({ username: 'admin', password: 'secret' }, 'actor-1').catch((e) => e);

      expect(err).toBeInstanceOf(ConflictException);
      expect(err.message).toBe('Username is already taken');
      expect(prisma.users.create).not.toHaveBeenCalled();
    });

    it('stores the trimmed username', async () => {
      prisma.users.findFirst.mockResolvedValueOnce(null).mockResolvedValue(baseUser);
      (bcrypt.hash as jest.Mock).mockResolvedValue('$2a$12$newhash');
      prisma.users.create.mockResolvedValue(baseUser);

      await service.create({ username: '  alice  ', password: 'secret' }, 'actor-1');

      expect(prisma.users.findFirst.mock.calls[0][0].where.username.equals).toBe('alice');
      expect(prisma.users.create).toHaveBeenCalledWith({
        data: { username: 'alice', password_hash: '$2a$12$newhash' },
      });
    });
  });

  describe('update', () => {
    it('updates user successfully and returns hydrated detail', async () => {
      // 1: managed-user lookup (baseUser). 2: username conflict check (null). 3: findOne hydrate.
      prisma.users.findFirst
        .mockResolvedValueOnce(baseUser)
        .mockResolvedValueOnce(null)
        .mockResolvedValue(baseUser);
      prisma.users.update.mockResolvedValue({ ...baseUser, username: 'alice2', password_hash: 'hash' });

      const result = await service.update('user-1', { username: 'alice2' }, actor);

      expect(result.data).not.toHaveProperty('password_hash');
      expect(Array.isArray(result.data.permissions)).toBe(true);
    });

    it('throws NotFoundException when user not found', async () => {
      prisma.users.findFirst.mockResolvedValue(null);

      await expect(service.update('ghost', {}, actor)).rejects.toThrow(NotFoundException);
    });

    it('throws ConflictException when new username is taken', async () => {
      prisma.users.findFirst
        .mockResolvedValueOnce(baseUser)
        .mockResolvedValueOnce({ ...baseUser, id: 'user-2', username: 'bob' });

      await expect(
        service.update('user-1', { username: 'bob' }, actor),
      ).rejects.toThrow(ConflictException);
    });

    it('checks the new name case-insensitively and excludes the row being renamed', async () => {
      prisma.users.findFirst
        .mockResolvedValueOnce(baseUser)
        .mockResolvedValueOnce(null)
        .mockResolvedValue(baseUser);
      prisma.users.update.mockResolvedValue({});

      await service.update('user-1', { username: 'Alice' }, actor);

      expect(prisma.users.findFirst).toHaveBeenNthCalledWith(2, {
        where: { username: { equals: 'Alice', mode: 'insensitive' }, deleted_at: null, NOT: { id: 'user-1' } },
        select: { id: true },
      });
      // A case-only rename of your own account is allowed.
      expect(prisma.users.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ username: 'Alice' }) }),
      );
    });

    it('rejects a rename that only differs from another live account in letter case', async () => {
      prisma.users.findFirst
        .mockResolvedValueOnce(baseUser)
        .mockResolvedValueOnce({ id: 'user-2', username: 'Bob' });

      await expect(service.update('user-1', { username: 'bob' }, actor)).rejects.toThrow(ConflictException);
      expect(prisma.users.update).not.toHaveBeenCalled();
    });

    it('trims the new username before comparing and storing it', async () => {
      prisma.users.findFirst
        .mockResolvedValueOnce(baseUser)
        .mockResolvedValueOnce(null)
        .mockResolvedValue(baseUser);
      prisma.users.update.mockResolvedValue({});

      await service.update('user-1', { username: '  alice2 ' }, actor);

      expect(prisma.users.findFirst.mock.calls[1][0].where.username.equals).toBe('alice2');
      expect(prisma.users.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ username: 'alice2' }) }),
      );
    });

    it('does not treat a whitespace-only difference as a rename', async () => {
      prisma.users.findFirst.mockResolvedValue(baseUser);
      prisma.users.update.mockResolvedValue({});

      await service.update('user-1', { username: ' alice ' }, actor);

      expect(prisma.users.findFirst).toHaveBeenCalledTimes(2); // managed-user lookup + hydrate only
      expect(audit.write.mock.calls[0][0].changes).not.toHaveProperty('username');
    });

    it('audits a rename with the before and after names', async () => {
      prisma.users.findFirst
        .mockResolvedValueOnce(baseUser)
        .mockResolvedValueOnce(null)
        .mockResolvedValue(baseUser);
      prisma.users.update.mockResolvedValue({});

      await service.update('user-1', { username: 'alice2' }, actor);

      expect(audit.write).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: 'actor-1',
          action: 'USER_UPDATED',
          resourceId: 'user-1',
          changes: expect.objectContaining({ username: { before: 'alice', after: 'alice2' } }),
        }),
      );
    });

    it('does not check username conflict when username is unchanged', async () => {
      // 1: managed-user lookup (baseUser). No conflict check (username unchanged). 2: hydrate fetch.
      prisma.users.findFirst.mockResolvedValue(baseUser);
      prisma.users.update.mockResolvedValue({ ...baseUser, password_hash: 'hash' });

      await service.update('user-1', { username: 'alice' }, actor);

      // 2 calls expected: initial + hydrate. The username-conflict findFirst is skipped.
      expect(prisma.users.findFirst).toHaveBeenCalledTimes(2);
      const conflictCheck = prisma.users.findFirst.mock.calls.find(
        (c: any[]) => c[0]?.where?.username !== undefined,
      );
      expect(conflictCheck).toBeUndefined();
    });

    it('forbids renaming a user who holds permissions beyond the actor', async () => {
      prisma.users.findFirst.mockResolvedValue(superAdminUser);

      await expect(service.update('super-1', { username: 'pwned' }, actor)).rejects.toThrow(
        ForbiddenException,
      );
      expect(prisma.users.update).not.toHaveBeenCalled();
    });
  });

  describe('adminResetPassword', () => {
    it('hashes the new password, bumps token_version and revokes refresh tokens', async () => {
      prisma.users.findFirst.mockResolvedValue(baseUser);
      (bcrypt.hash as jest.Mock).mockResolvedValue('$2a$12$fresh');
      prisma.users.update.mockResolvedValue({});

      const result = await service.adminResetPassword('user-1', { new_password: 'n3w-secret' }, actor);

      expect(prisma.users.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'user-1' },
          data: expect.objectContaining({
            password_hash: '$2a$12$fresh',
            token_version: { increment: 1 },
          }),
        }),
      );
      expect(prisma.refresh_tokens.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { user_id: 'user-1', revoked_at: null } }),
      );
      expect(result.data).toBeNull();
    });

    it('flags the account so the user is asked to choose their own password', async () => {
      prisma.users.findFirst.mockResolvedValue(baseUser);
      (bcrypt.hash as jest.Mock).mockResolvedValue('$2a$12$fresh');
      prisma.users.update.mockResolvedValue({});

      await service.adminResetPassword('user-1', { new_password: 'n3w-secret' }, actor);

      expect(prisma.users.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ must_change_password: true }),
        }),
      );
    });

    it('never puts the password or its hash in the audit row', async () => {
      prisma.users.findFirst.mockResolvedValue(baseUser);
      (bcrypt.hash as jest.Mock).mockResolvedValue('$2a$12$fresh');
      prisma.users.update.mockResolvedValue({});

      await service.adminResetPassword('user-1', { new_password: 'n3w-secret' }, actor);

      const row = JSON.stringify(audit.write.mock.calls[0][0]);
      expect(row).not.toContain('n3w-secret');
      expect(row).not.toContain('$2a$12$fresh');
    });

    it('throws NotFoundException when user not found', async () => {
      prisma.users.findFirst.mockResolvedValue(null);

      await expect(
        service.adminResetPassword('ghost', { new_password: 'n3w-secret' }, actor),
      ).rejects.toThrow(NotFoundException);
    });

    it('forbids resetting the password of a user who holds permissions beyond the actor', async () => {
      // The takeover path: a `users:update` holder resets super-admin's password, then logs in as them.
      prisma.users.findFirst.mockResolvedValue(superAdminUser);

      await expect(
        service.adminResetPassword('super-1', { new_password: 'attacker123' }, actor),
      ).rejects.toThrow(ForbiddenException);
      expect(bcrypt.hash).not.toHaveBeenCalled();
      expect(prisma.users.update).not.toHaveBeenCalled();
    });
  });

  describe('softDelete', () => {
    it('sets deleted_at on the user', async () => {
      prisma.users.findFirst.mockResolvedValue(baseUser);
      prisma.users.update.mockResolvedValue({});

      const result = await service.softDelete('user-1', actor);

      expect(prisma.users.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ deleted_at: expect.any(Date) }) }),
      );
      expect(result.message).toBe('User deleted');
    });

    it('throws NotFoundException when user not found', async () => {
      prisma.users.findFirst.mockResolvedValue(null);

      await expect(service.softDelete('ghost', actor)).rejects.toThrow(NotFoundException);
    });

    it('refuses to delete the actor’s own account', async () => {
      await expect(service.softDelete('actor-1', actor)).rejects.toThrow(ForbiddenException);
      expect(prisma.users.findFirst).not.toHaveBeenCalled();
      expect(prisma.users.update).not.toHaveBeenCalled();
    });

    it('forbids deleting a user who holds permissions beyond the actor', async () => {
      prisma.users.findFirst.mockResolvedValue(superAdminUser);

      await expect(service.softDelete('super-1', actor)).rejects.toThrow(ForbiddenException);
      expect(prisma.users.update).not.toHaveBeenCalled();
    });

    it('refuses to delete the last user holding every permission', async () => {
      // Target's role permissions are within the actor's envelope, but the
      // target is the only active account with the full permission set.
      const target = {
        ...baseUser,
        user_roles: [
          {
            role_id: 'role-1',
            roles: { name: 'Admin', role_permissions: [{ permissions: { name: 'users:create' } }] },
          },
        ],
      };
      prisma.users.findFirst.mockResolvedValue(target);
      prisma.permissions.count.mockResolvedValue(1);
      prisma.users.findMany.mockResolvedValue([
        { id: 'user-1', user_roles: [{ role_id: 'role-1', roles: { role_permissions: [{ permission_id: 'p1' }] } }] },
      ]);

      await expect(service.softDelete('user-1', actor)).rejects.toThrow(ConflictException);
      expect(prisma.users.update).not.toHaveBeenCalled();
    });
  });

  describe('restore', () => {
    it('restores a soft-deleted user and reverses the username suffix', async () => {
      prisma.users.findFirst
        .mockResolvedValueOnce({ ...baseUser, username: 'alice__del_1700000000000', deleted_at: new Date() })
        .mockResolvedValueOnce(null)
        .mockResolvedValue(baseUser);
      prisma.users.update.mockResolvedValue({});

      const result = await service.restore('user-1', actor);

      expect(prisma.users.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { deleted_at: null, username: 'alice', updated_at: expect.any(Date) },
      });
      expect(result.message).toBe('User restored');
    });

    it('throws NotFoundException when there is no soft-deleted user with that id', async () => {
      prisma.users.findFirst.mockResolvedValue(null);

      await expect(service.restore('ghost', actor)).rejects.toThrow(NotFoundException);
      expect(prisma.users.update).not.toHaveBeenCalled();
    });

    it('refuses when a live account holds the original name in a different letter case', async () => {
      prisma.users.findFirst
        .mockResolvedValueOnce({ ...baseUser, username: 'alice__del_1700000000000', deleted_at: new Date() })
        .mockResolvedValueOnce({ id: 'user-9' });

      await expect(service.restore('user-1', actor)).rejects.toThrow(ConflictException);
      expect(prisma.users.findFirst.mock.calls[1][0].where).toEqual({
        username: { equals: 'alice', mode: 'insensitive' },
        deleted_at: null,
        NOT: { id: 'user-1' },
      });
      expect(prisma.users.update).not.toHaveBeenCalled();
    });

    it('forbids restoring a soft-deleted user who holds permissions beyond the actor', async () => {
      // The bypass this closes: an actor blocked from resetting/renaming a
      // super-admin (envelope-checked elsewhere) must not be able to
      // soft-delete it and then simply restore it right back.
      prisma.users.findFirst.mockResolvedValue({ ...superAdminUser, deleted_at: new Date() });

      await expect(service.restore('super-1', actor)).rejects.toThrow(ForbiddenException);
      expect(prisma.users.update).not.toHaveBeenCalled();
    });
  });

  describe('assignRole', () => {
    // role with no permissions → trivially within any actor's envelope.
    const emptyRole = { id: 'role-1', name: 'Admin', role_permissions: [] };

    it('creates user_roles record and returns hydrated user detail when not already assigned', async () => {
      // Default mock covers the initial existence check and the hydrate fetch.
      prisma.users.findFirst.mockResolvedValue(baseUser);
      prisma.roles.findUnique.mockResolvedValue(emptyRole);
      prisma.user_roles.findUnique.mockResolvedValue(null);
      prisma.user_roles.create.mockResolvedValue({});

      const result = await service.assignRole('user-1', { role_id: 'role-1' }, actor);

      // The row written, not just "create() ran somehow" — wrong user_id or
      // role_id here would silently grant the wrong person the wrong role.
      expect(prisma.user_roles.create).toHaveBeenCalledWith({
        data: { user_id: 'user-1', role_id: 'role-1' },
      });
      // Outstanding JWTs bake in permissions, so a role change must bump
      // token_version or the grant never actually takes effect.
      expect(prisma.users.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { token_version: { increment: 1 } },
      });
      expect(audit.write).toHaveBeenCalledWith(
        expect.objectContaining({ action: AUDIT_ACTIONS.ROLE_ASSIGNED_TO_USER, resourceId: 'user-1' }),
      );
      expect(result.message).toBe('Role assigned');
      expect(result.data.permissions).toBeDefined();
    });

    it('skips the create and audit row when the role is already assigned', async () => {
      prisma.users.findFirst.mockResolvedValue(baseUser);
      prisma.roles.findUnique.mockResolvedValue(emptyRole);
      prisma.user_roles.findUnique.mockResolvedValue({ user_id: 'user-1' });

      await service.assignRole('user-1', { role_id: 'role-1' }, actor);

      expect(prisma.user_roles.create).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when user not found', async () => {
      prisma.users.findFirst.mockResolvedValue(null);
      prisma.roles.findUnique.mockResolvedValue(emptyRole);

      await expect(
        service.assignRole('ghost', { role_id: 'role-1' }, actor),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when role not found', async () => {
      prisma.users.findFirst.mockResolvedValue(baseUser);
      prisma.roles.findUnique.mockResolvedValue(null);

      await expect(
        service.assignRole('user-1', { role_id: 'ghost' }, actor),
      ).rejects.toThrow(NotFoundException);
    });

    it('forbids assigning a role that grants permissions beyond the actor', async () => {
      prisma.users.findFirst.mockResolvedValue(baseUser);
      prisma.roles.findUnique.mockResolvedValue({
        id: 'role-x',
        name: 'super-admin',
        role_permissions: [{ permissions: { name: 'roles:assign' } }],
      });

      await expect(
        // actor does not hold `roles:assign`
        service.assignRole('user-1', { role_id: 'role-x' }, actor),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.user_roles.create).not.toHaveBeenCalled();
    });
  });

  describe('removeRole', () => {
    const emptyRole = { id: 'role-1', name: 'Admin', role_permissions: [] };

    it('deletes user_roles record and returns hydrated user detail', async () => {
      prisma.users.findFirst.mockResolvedValue(baseUser);
      prisma.roles.findUnique.mockResolvedValue(emptyRole);
      prisma.user_roles.deleteMany.mockResolvedValue({ count: 1 });

      const result = await service.removeRole('user-1', 'role-1', actor);

      // The where clause, not just "deleteMany() ran somehow" — a loose or
      // wrong filter here would strip the wrong user's role, or every role.
      expect(prisma.user_roles.deleteMany).toHaveBeenCalledWith({
        where: { user_id: 'user-1', role_id: 'role-1' },
      });
      // Outstanding JWTs bake in permissions, so revocation must bump
      // token_version or the removal never actually takes effect.
      expect(prisma.users.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { token_version: { increment: 1 } },
      });
      expect(audit.write).toHaveBeenCalledWith(
        expect.objectContaining({ action: AUDIT_ACTIONS.ROLE_REMOVED_FROM_USER, resourceId: 'user-1' }),
      );
      expect(result.message).toBe('Role removed');
      expect(result.data.permissions).toBeDefined();
    });

    it('throws NotFoundException when user not found', async () => {
      prisma.users.findFirst.mockResolvedValue(null);
      prisma.roles.findUnique.mockResolvedValue(emptyRole);

      await expect(service.removeRole('ghost', 'role-1', actor)).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException with specific message when role is not assigned', async () => {
      prisma.users.findFirst.mockResolvedValue(baseUser);
      prisma.roles.findUnique.mockResolvedValue(emptyRole);
      prisma.user_roles.deleteMany.mockResolvedValue({ count: 0 });

      await expect(service.removeRole('user-1', 'role-1', actor)).rejects.toThrow(
        'Role is not assigned to this user',
      );
    });

    it('forbids removing a role that grants permissions beyond the actor', async () => {
      prisma.users.findFirst.mockResolvedValue(baseUser);
      prisma.roles.findUnique.mockResolvedValue({
        id: 'role-x',
        name: 'super-admin',
        role_permissions: [{ permissions: { name: 'roles:assign' } }],
      });

      await expect(service.removeRole('user-1', 'role-x', actor)).rejects.toThrow(
        ForbiddenException,
      );
      expect(prisma.user_roles.deleteMany).not.toHaveBeenCalled();
    });

    it('refuses to strip the role that makes the last administrator whole', async () => {
      prisma.users.findFirst.mockResolvedValue(baseUser);
      prisma.roles.findUnique.mockResolvedValue(emptyRole);
      prisma.permissions.count.mockResolvedValue(1);
      prisma.users.findMany.mockResolvedValue([
        { id: 'user-1', user_roles: [{ role_id: 'role-1', roles: { role_permissions: [{ permission_id: 'p1' }] } }] },
      ]);

      await expect(service.removeRole('user-1', 'role-1', actor)).rejects.toThrow(ConflictException);
      expect(prisma.user_roles.deleteMany).not.toHaveBeenCalled();
    });
  });
});
