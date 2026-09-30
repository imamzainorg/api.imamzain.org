import { ConflictException, ForbiddenException } from '@nestjs/common';
import {
  assertNotLastAdministrator,
  assertWithinActorEnvelope,
  LAST_ADMINISTRATOR_MESSAGE,
} from './rbac.util';

describe('assertWithinActorEnvelope', () => {
  it('passes when the subject holds a subset of the actor permissions', () => {
    expect(() =>
      assertWithinActorEnvelope(['a', 'b', 'c'], ['a', 'c'], 'nope'),
    ).not.toThrow();
  });

  it('passes when the sets are equal (peers may manage each other)', () => {
    expect(() => assertWithinActorEnvelope(['a', 'b'], ['b', 'a'], 'nope')).not.toThrow();
  });

  it('throws 403 with the given message when the subject holds something the actor lacks', () => {
    expect(() => assertWithinActorEnvelope(['a'], ['a', 'roles:update'], 'custom message')).toThrow(
      new ForbiddenException('custom message'),
    );
  });

  it('treats an undefined actor permission list as empty', () => {
    expect(() => assertWithinActorEnvelope(undefined, [], 'nope')).not.toThrow();
    expect(() => assertWithinActorEnvelope(undefined, ['a'], 'nope')).toThrow(ForbiddenException);
  });
});

describe('assertNotLastAdministrator', () => {
  // Three permissions exist. Role "super" grants all three, role "editor" grants one.
  const superRole = { role_permissions: [{ permission_id: 'p1' }, { permission_id: 'p2' }, { permission_id: 'p3' }] };
  const editorRole = { role_permissions: [{ permission_id: 'p1' }] };

  function db(users: any[], totalPermissions = 3) {
    return {
      permissions: { count: jest.fn().mockResolvedValue(totalPermissions) },
      users: { findMany: jest.fn().mockResolvedValue(users) },
    } as any;
  }

  const alice = { id: 'alice', user_roles: [{ role_id: 'super', roles: superRole }] };
  const bob = { id: 'bob', user_roles: [{ role_id: 'super', roles: superRole }] };
  const carol = { id: 'carol', user_roles: [{ role_id: 'editor', roles: editorRole }] };

  it('refuses to delete the only full-permission holder', async () => {
    await expect(
      assertNotLastAdministrator(db([alice, carol]), { kind: 'delete-user', userId: 'alice' }),
    ).rejects.toThrow(new ConflictException(LAST_ADMINISTRATOR_MESSAGE));
  });

  it('allows deleting a full-permission holder when another one remains', async () => {
    await expect(
      assertNotLastAdministrator(db([alice, bob, carol]), { kind: 'delete-user', userId: 'alice' }),
    ).resolves.toBeUndefined();
  });

  it('allows deleting a non-administrator even when only one administrator exists', async () => {
    await expect(
      assertNotLastAdministrator(db([alice, carol]), { kind: 'delete-user', userId: 'carol' }),
    ).resolves.toBeUndefined();
  });

  it('refuses to strip the administrator role from the last holder', async () => {
    await expect(
      assertNotLastAdministrator(db([alice, carol]), { kind: 'remove-role', userId: 'alice', roleId: 'super' }),
    ).rejects.toThrow(ConflictException);
  });

  it('allows stripping a role the user still has covered by another role', async () => {
    const aliceTwoRoles = {
      id: 'alice',
      user_roles: [
        { role_id: 'super', roles: superRole },
        { role_id: 'super-copy', roles: superRole },
      ],
    };
    await expect(
      assertNotLastAdministrator(db([aliceTwoRoles]), { kind: 'remove-role', userId: 'alice', roleId: 'super' }),
    ).resolves.toBeUndefined();
  });

  it('refuses to remove a permission from the role that makes the last administrator whole', async () => {
    await expect(
      assertNotLastAdministrator(db([alice, carol]), {
        kind: 'remove-permission',
        roleId: 'super',
        permissionId: 'p2',
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('allows removing a permission from a role no administrator depends on', async () => {
    await expect(
      assertNotLastAdministrator(db([alice, carol]), {
        kind: 'remove-permission',
        roleId: 'editor',
        permissionId: 'p1',
      }),
    ).resolves.toBeUndefined();
  });

  it('does not block changes when nobody holds the full set already (invariant already broken)', async () => {
    await expect(
      assertNotLastAdministrator(db([carol]), { kind: 'delete-user', userId: 'carol' }),
    ).resolves.toBeUndefined();
  });

  it('is a no-op when the permissions table is empty', async () => {
    const client = db([alice], 0);
    await expect(
      assertNotLastAdministrator(client, { kind: 'delete-user', userId: 'alice' }),
    ).resolves.toBeUndefined();
  });
});
