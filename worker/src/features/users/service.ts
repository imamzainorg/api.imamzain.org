import type { Context } from 'hono';
import type { Prisma } from '../../generated/prisma/client';
import { AUDIT_ACTIONS, audit } from '../../lib/audit';
import { getDb, lockKey } from '../../lib/db';
import { conflict, forbidden, notFound, rethrowP2002AsConflict } from '../../lib/errors';
import { buildPaginationMeta } from '../../lib/pagination';
import { hashPassword } from '../../lib/password';
import { assertNotLastAdministrator, assertWithinActorEnvelope, MANAGE_USER_ENVELOPE_MESSAGE } from '../../lib/rbac';
import { softDeleteSuffix, stripSoftDeleteSuffix } from '../../lib/soft-delete';
import type { AppEnv, CurrentUser } from '../../lib/types';

type Ctx = Context<AppEnv>;

/** Roles → permissions joins needed to compute a user's effective permission set. */
const USER_PERMISSIONS_INCLUDE = {
  user_roles: { include: { roles: { include: { role_permissions: { include: { permissions: true } } } } } },
} satisfies Prisma.usersInclude;

type UserWithPermissions = Prisma.usersGetPayload<{ include: typeof USER_PERMISSIONS_INCLUDE }>;

const LIST_SELECT = {
  id: true,
  username: true,
  created_at: true,
  updated_at: true,
  deleted_at: true,
  user_roles: { include: { roles: true } },
} satisfies Prisma.usersSelect;

function flattenPermissions(user: UserWithPermissions): string[] {
  const names = new Set<string>();
  for (const ur of user.user_roles) for (const rp of ur.roles.role_permissions) names.add(rp.permissions.name);
  return Array.from(names);
}

export async function findAll(c: Ctx, page: number, limit: number) {
  const db = getDb(c);
  const where = { deleted_at: null };
  const [items, total] = await Promise.all([
    db.users.findMany({ where, select: LIST_SELECT, orderBy: [{ created_at: 'desc' }, { id: 'asc' }], skip: (page - 1) * limit, take: limit }),
    db.users.count({ where }),
  ]);
  return {
    message: 'Users fetched',
    data: { items: items.map(({ deleted_at, ...u }) => ({ ...u, is_active: deleted_at === null })), pagination: buildPaginationMeta(page, limit, total) },
  };
}

export async function findOne(c: Ctx, id: string) {
  const user = await getDb(c).users.findFirst({ where: { id, deleted_at: null }, include: USER_PERMISSIONS_INCLUDE });
  if (!user) throw notFound('User not found');
  return {
    message: 'User fetched',
    data: {
      id: user.id,
      username: user.username,
      created_at: user.created_at,
      updated_at: user.updated_at,
      is_active: user.deleted_at === null,
      user_roles: user.user_roles,
      permissions: flattenPermissions(user),
    },
  };
}

/**
 * A live user, refused (403) when they hold any permission the actor lacks. Every route that changes
 * another account's credentials, identity or existence goes through this.
 */
async function loadManagedUser(c: Ctx, id: string, actor: CurrentUser): Promise<UserWithPermissions> {
  const user = await getDb(c).users.findFirst({ where: { id, deleted_at: null }, include: USER_PERMISSIONS_INCLUDE });
  if (!user) throw notFound('User not found');
  assertWithinActorEnvelope(actor.permissions, flattenPermissions(user), MANAGE_USER_ENVELOPE_MESSAGE);
  return user;
}

/**
 * 409 when a live account holds this name in any letter case (login matches byte-exact). The unique
 * index is case-sensitive, so the check runs under a lock on the lowercased name: two concurrent
 * `Admin` / `admin` writes can't both pass.
 */
async function assertUsernameAvailable(tx: Prisma.TransactionClient, username: string, exceptId?: string, message = 'Username is already taken'): Promise<void> {
  await lockKey(tx, `users.username:${username.toLowerCase()}`);
  const taken = await tx.users.findFirst({
    where: { username: { equals: username, mode: 'insensitive' }, deleted_at: null, ...(exceptId ? { NOT: { id: exceptId } } : {}) },
    select: { id: true },
  });
  if (taken) throw conflict(message);
}

export async function create(c: Ctx, dto: { username: string; password: string }) {
  const username = dto.username.trim();
  const password_hash = await hashPassword(dto.password, c.env);
  const user = await getDb(c).$transaction(async (tx) => {
    await assertUsernameAvailable(tx, username);
    return tx.users.create({ data: { username, password_hash } });
  });

  audit(c, { action: AUDIT_ACTIONS.USER_CREATED, resourceType: 'user', resourceId: user.id, changes: { method: 'POST', path: '/api/v1/users' } });

  const { data } = await findOne(c, user.id);
  return { message: 'User created', data };
}

export async function update(c: Ctx, id: string, dto: { username?: string | null }, actor: CurrentUser) {
  const user = await loadManagedUser(c, id, actor);

  const username = dto.username?.trim();
  const renamed = username !== undefined && username !== user.username;

  const data: Prisma.usersUpdateInput = { updated_at: new Date() };
  if (username !== undefined) data.username = username;
  await getDb(c).$transaction(async (tx) => {
    if (renamed) await assertUsernameAvailable(tx, username, id);
    await tx.users.update({ where: { id }, data });
  });

  audit(c, {
    actorId: actor.id,
    action: AUDIT_ACTIONS.USER_UPDATED,
    resourceType: 'user',
    resourceId: id,
    changes: { method: 'PATCH', path: `/api/v1/users/${id}`, ...(renamed ? { username: { before: user.username, after: username } } : {}) },
  });

  const { data: shaped } = await findOne(c, id);
  return { message: 'User updated', data: shaped };
}

/**
 * Admin-set password for a user who forgot theirs (users have no email). Bumps token_version and
 * revokes every refresh token, and flags the account to change the password. The admin hands the
 * password over out-of-band.
 */
export async function adminResetPassword(c: Ctx, userId: string, newPassword: string, actor: CurrentUser) {
  await loadManagedUser(c, userId, actor);

  const password_hash = await hashPassword(newPassword, c.env);
  const db = getDb(c);
  await db.$transaction([
    db.users.update({
      where: { id: userId },
      data: { password_hash, updated_at: new Date(), token_version: { increment: 1 }, must_change_password: true },
    }),
    db.refresh_tokens.updateMany({ where: { user_id: userId, revoked_at: null }, data: { revoked_at: new Date() } }),
  ]);

  audit(c, {
    actorId: actor.id,
    action: AUDIT_ACTIONS.USER_PASSWORD_RESET_BY_ADMIN,
    resourceType: 'user',
    resourceId: userId,
    changes: { method: 'POST', path: `/api/v1/users/${userId}/reset-password` },
  });

  return { message: 'Password reset; user must re-authenticate', data: null };
}

export async function softDelete(c: Ctx, id: string, actor: CurrentUser) {
  if (id === actor.id) throw forbidden('You cannot delete your own account');

  const user = await loadManagedUser(c, id, actor);

  // The suffix frees the unique username for reuse; restore strips it.
  const deletedAt = new Date();
  await getDb(c).$transaction(async (tx) => {
    await assertNotLastAdministrator(tx, { kind: 'delete-user', userId: id });
    await tx.users.update({ where: { id }, data: { deleted_at: deletedAt, username: `${user.username}${softDeleteSuffix(deletedAt)}` } });
  });

  audit(c, { actorId: actor.id, action: AUDIT_ACTIONS.USER_DELETED, resourceType: 'user', resourceId: id, changes: { method: 'DELETE', path: `/api/v1/users/${id}` } });

  return { message: 'User deleted', data: null };
}

/** Soft-deleted users with their original (suffix-stripped) username. */
export async function findTrash(c: Ctx, page: number, limit: number) {
  const db = getDb(c);
  const where: Prisma.usersWhereInput = { deleted_at: { not: null } };
  const [items, total] = await Promise.all([
    db.users.findMany({ where, select: LIST_SELECT, orderBy: [{ deleted_at: 'desc' }, { id: 'asc' }], skip: (page - 1) * limit, take: limit }),
    db.users.count({ where }),
  ]);
  return {
    message: 'Trash fetched',
    data: {
      items: items.map(({ deleted_at, username, ...u }) => ({ ...u, username: stripSoftDeleteSuffix(username), is_active: false })),
      pagination: buildPaginationMeta(page, limit, total),
    },
  };
}

/**
 * Same privilege envelope as the other management routes, checked against the soft-deleted row:
 * otherwise a users:delete holder could delete a super-admin and restore it right back.
 */
export async function restore(c: Ctx, id: string, actor: CurrentUser) {
  const db = getDb(c);
  const user = await db.users.findFirst({ where: { id, deleted_at: { not: null } }, include: USER_PERMISSIONS_INCLUDE });
  if (!user) throw notFound('Deleted user not found');
  assertWithinActorEnvelope(actor.permissions, flattenPermissions(user), MANAGE_USER_ENVELOPE_MESSAGE);

  const originalUsername = stripSoftDeleteSuffix(user.username);
  const message = `Cannot restore: username "${originalUsername}" is now used by another user`;
  try {
    await db.$transaction(async (tx) => {
      await assertUsernameAvailable(tx, originalUsername, id, message);
      await tx.users.update({ where: { id }, data: { deleted_at: null, username: originalUsername, updated_at: new Date() } });
    });
  } catch (err) {
    // The unique index is the backstop for a writer that skipped the lock (Nest, until cutover).
    rethrowP2002AsConflict(err, message);
  }

  audit(c, { actorId: actor.id, action: AUDIT_ACTIONS.USER_RESTORED, resourceType: 'user', resourceId: id, changes: { method: 'POST', path: `/api/v1/users/${id}/restore` } });

  const { data } = await findOne(c, id);
  return { message: 'User restored', data };
}

const roleWithPermissionNames = { role_permissions: { select: { permissions: { select: { name: true } } } } } satisfies Prisma.rolesInclude;

/** An actor may only grant or revoke a role whose permissions are all within their own. */
async function loadUserAndRole(c: Ctx, userId: string, roleId: string, actor: CurrentUser, verb: 'assign' | 'remove') {
  const db = getDb(c);
  const [user, role] = await Promise.all([
    db.users.findFirst({ where: { id: userId, deleted_at: null } }),
    db.roles.findUnique({ where: { id: roleId }, include: roleWithPermissionNames }),
  ]);
  if (!user) throw notFound('User not found');
  if (!role) throw notFound('Role not found');
  assertWithinActorEnvelope(
    actor.permissions,
    role.role_permissions.map((rp) => rp.permissions.name),
    `You cannot ${verb} a role that grants permissions beyond your own`,
  );
}

export async function assignRole(c: Ctx, userId: string, roleId: string, actor: CurrentUser) {
  await loadUserAndRole(c, userId, roleId, actor, 'assign');

  const db = getDb(c);
  const existing = await db.user_roles.findUnique({ where: { user_id_role_id: { user_id: userId, role_id: roleId } }, select: { user_id: true } });
  if (!existing) {
    await db.user_roles.create({ data: { user_id: userId, role_id: roleId } });
    // Permissions are baked into access tokens: the new role takes effect on the next request.
    await db.users.update({ where: { id: userId }, data: { token_version: { increment: 1 } } });

    audit(c, {
      actorId: actor.id,
      action: AUDIT_ACTIONS.ROLE_ASSIGNED_TO_USER,
      resourceType: 'user',
      resourceId: userId,
      changes: { method: 'POST', path: `/api/v1/users/${userId}/roles`, role_id: roleId },
    });
  }

  const { data } = await findOne(c, userId);
  return { message: 'Role assigned', data };
}

export async function removeRole(c: Ctx, userId: string, roleId: string, actor: CurrentUser) {
  await loadUserAndRole(c, userId, roleId, actor, 'remove');

  const db = getDb(c);
  const result = await db.$transaction(async (tx) => {
    await assertNotLastAdministrator(tx, { kind: 'remove-role', userId, roleId });
    return tx.user_roles.deleteMany({ where: { user_id: userId, role_id: roleId } });
  });
  if (result.count === 0) throw notFound('Role is not assigned to this user');

  await db.users.update({ where: { id: userId }, data: { token_version: { increment: 1 } } });

  audit(c, {
    actorId: actor.id,
    action: AUDIT_ACTIONS.ROLE_REMOVED_FROM_USER,
    resourceType: 'user',
    resourceId: userId,
    changes: { method: 'DELETE', path: `/api/v1/users/${userId}/roles/${roleId}`, roleId },
  });

  const { data } = await findOne(c, userId);
  return { message: 'Role removed', data };
}
