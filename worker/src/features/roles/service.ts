import type { Context } from 'hono';
import type { Prisma } from '../../generated/prisma/client';
import { AUDIT_ACTIONS, audit } from '../../lib/audit';
import { getDb, lockKey } from '../../lib/db';
import { conflict, notFound } from '../../lib/errors';
import { loadActiveLanguages, resolveTranslation } from '../../lib/i18n';
import { buildPaginationMeta } from '../../lib/pagination';
import { assertNotLastAdministrator, assertWithinActorEnvelope } from '../../lib/rbac';
import type { AppEnv, CurrentUser } from '../../lib/types';
import type { CreateRoleInput, UpdateRoleInput } from './schemas';

type Ctx = Context<AppEnv>;

const ROLE_DETAIL_INCLUDE = {
  role_translations: true,
  role_permissions: { include: { permissions: { include: { permission_translations: true } } } },
} satisfies Prisma.rolesInclude;

type RoleWithRelations = Prisma.rolesGetPayload<{ include: typeof ROLE_DETAIL_INCLUDE }>;

/** The role with a flat `permissions[]` and a resolved `translation` on the role and on each permission. */
function shapeRole(role: RoleWithRelations, lang: string | null, active: ReadonlySet<string>) {
  return {
    id: role.id,
    name: role.name,
    role_translations: role.role_translations,
    translation: resolveTranslation(role.role_translations, lang, { active }),
    permissions: role.role_permissions.map((rp) => ({
      id: rp.permissions.id,
      name: rp.permissions.name,
      permission_translations: rp.permissions.permission_translations,
      translation: resolveTranslation(rp.permissions.permission_translations, lang, { active }),
    })),
  };
}

/**
 * Permissions are baked into access tokens, so a change to a role's permission set bumps token_version
 * for every holder: the change takes effect on their next request.
 */
async function invalidateRoleHolders(c: Ctx, roleId: string): Promise<void> {
  const db = getDb(c);
  const holders = await db.user_roles.findMany({ where: { role_id: roleId }, select: { user_id: true } });
  if (holders.length === 0) return;
  await db.users.updateMany({ where: { id: { in: holders.map((h) => h.user_id) } }, data: { token_version: { increment: 1 } } });
}

async function hydrateRole(c: Ctx, id: string, lang: string | null) {
  const db = getDb(c);
  const [role, active] = await Promise.all([db.roles.findUnique({ where: { id }, include: ROLE_DETAIL_INCLUDE }), loadActiveLanguages(db)]);
  if (!role) throw notFound('Role not found');
  return shapeRole(role, lang, active);
}

export async function findAll(c: Ctx, lang: string | null, page: number, limit: number) {
  const db = getDb(c);
  const [roles, total, active] = await Promise.all([
    db.roles.findMany({ include: ROLE_DETAIL_INCLUDE, orderBy: { name: 'asc' }, skip: (page - 1) * limit, take: limit }),
    db.roles.count(),
    loadActiveLanguages(db),
  ]);
  return {
    message: 'Roles fetched',
    data: { items: roles.map((r) => shapeRole(r, lang, active)), pagination: buildPaginationMeta(page, limit, total) },
  };
}

export async function findOne(c: Ctx, id: string, lang: string | null) {
  return { message: 'Role fetched', data: await hydrateRole(c, id, lang) };
}

/**
 * 409 when a role already has this name in any letter case. The unique index is case-sensitive, so the
 * check runs under a lock on the lowercased name: two concurrent `Admin` / `admin` writes can't both pass.
 */
async function assertRoleNameAvailable(tx: Prisma.TransactionClient, name: string, exceptId?: string): Promise<void> {
  await lockKey(tx, `roles.name:${name.toLowerCase()}`);
  const taken = await tx.roles.findFirst({
    where: { name: { equals: name, mode: 'insensitive' }, ...(exceptId ? { NOT: { id: exceptId } } : {}) },
    select: { id: true },
  });
  if (taken) throw conflict('A role with that name already exists');
}

export async function create(c: Ctx, dto: CreateRoleInput, lang: string | null) {
  const name = dto.name.trim();

  const role = await getDb(c).$transaction(async (tx) => {
    await assertRoleNameAvailable(tx, name);
    const created = await tx.roles.create({ data: { name } });
    await tx.role_translations.createMany({
      data: dto.translations.map((t) => ({ role_id: created.id, lang: t.lang, title: t.title, description: t.description ?? null })),
    });
    return created;
  });

  audit(c, { action: AUDIT_ACTIONS.ROLE_CREATED, resourceType: 'role', resourceId: role.id, changes: { method: 'POST', path: '/api/v1/roles' } });

  return { message: 'Role created', data: await hydrateRole(c, role.id, lang) };
}

export async function update(c: Ctx, id: string, dto: UpdateRoleInput, lang: string | null) {
  const db = getDb(c);
  const role = await db.roles.findUnique({ where: { id } });
  if (!role) throw notFound('Role not found');

  const name = dto.name?.trim() || undefined;
  const renamed = name !== undefined && name !== role.name;

  await db.$transaction(async (tx) => {
    if (renamed) await assertRoleNameAvailable(tx, name, id);
    await tx.roles.update({ where: { id }, data: name ? { name } : {} });
    for (const t of dto.translations ?? []) {
      await tx.role_translations.upsert({
        where: { role_id_lang: { role_id: id, lang: t.lang } },
        create: { role_id: id, lang: t.lang, title: t.title, description: t.description ?? null },
        update: { title: t.title, description: t.description ?? null },
      });
    }
  });

  audit(c, {
    action: AUDIT_ACTIONS.ROLE_UPDATED,
    resourceType: 'role',
    resourceId: id,
    changes: { method: 'PATCH', path: `/api/v1/roles/${id}`, ...(renamed ? { name: { before: role.name, after: name } } : {}) },
  });

  return { message: 'Role updated', data: await hydrateRole(c, id, lang) };
}

export async function remove(c: Ctx, id: string) {
  // The row lock makes a concurrent user_roles insert (KEY SHARE through its FK) either commit first
  // and be counted, or wait; without it the cascade could silently drop an assignment in flight.
  await getDb(c).$transaction(async (tx) => {
    const role = await tx.roles.findUnique({ where: { id } });
    if (!role) throw notFound('Role not found');

    const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM roles WHERE id = ${id}::uuid FOR UPDATE`;
    if (locked.length === 0) throw notFound('Role not found');

    if ((await tx.user_roles.count({ where: { role_id: id } })) > 0) throw conflict('Cannot delete a role that is assigned to users');

    await tx.role_permissions.deleteMany({ where: { role_id: id } });
    await tx.role_translations.deleteMany({ where: { role_id: id } });
    await tx.roles.delete({ where: { id } });
  });

  audit(c, { action: AUDIT_ACTIONS.ROLE_DELETED, resourceType: 'role', resourceId: id, changes: { method: 'DELETE', path: `/api/v1/roles/${id}` } });

  return { message: 'Role deleted', data: null };
}

/** 404s, then the privilege envelope: an actor may only grant or revoke a permission they hold. */
async function loadRoleAndPermission(c: Ctx, roleId: string, permissionId: string, actor: CurrentUser, verb: 'grant' | 'revoke') {
  const db = getDb(c);
  const [role, permission] = await Promise.all([db.roles.findUnique({ where: { id: roleId } }), db.permissions.findUnique({ where: { id: permissionId } })]);
  if (!role) throw notFound('Role not found');
  if (!permission) throw notFound('Permission not found');
  assertWithinActorEnvelope(actor.permissions, [permission.name], `You cannot ${verb} a permission you do not hold yourself`);
}

export async function assignPermission(c: Ctx, roleId: string, permissionId: string, actor: CurrentUser, lang: string | null) {
  await loadRoleAndPermission(c, roleId, permissionId, actor, 'grant');

  await getDb(c).role_permissions.upsert({
    where: { role_id_permission_id: { role_id: roleId, permission_id: permissionId } },
    create: { role_id: roleId, permission_id: permissionId },
    update: {},
  });

  await invalidateRoleHolders(c, roleId);

  audit(c, {
    actorId: actor.id,
    action: AUDIT_ACTIONS.PERMISSION_ASSIGNED_TO_ROLE,
    resourceType: 'role',
    resourceId: roleId,
    changes: { method: 'POST', path: `/api/v1/roles/${roleId}/permissions`, permissionId },
  });

  return { message: 'Permission assigned', data: await hydrateRole(c, roleId, lang) };
}

export async function removePermission(c: Ctx, roleId: string, permissionId: string, actor: CurrentUser, lang: string | null) {
  await loadRoleAndPermission(c, roleId, permissionId, actor, 'revoke');

  // Checked in the delete's transaction so the snapshot cannot drift.
  const result = await getDb(c).$transaction(async (tx) => {
    await assertNotLastAdministrator(tx, { kind: 'remove-permission', roleId, permissionId });
    return tx.role_permissions.deleteMany({ where: { role_id: roleId, permission_id: permissionId } });
  });
  if (result.count === 0) throw notFound('Permission is not assigned to this role');

  await invalidateRoleHolders(c, roleId);

  audit(c, {
    actorId: actor.id,
    action: AUDIT_ACTIONS.PERMISSION_REMOVED_FROM_ROLE,
    resourceType: 'role',
    resourceId: roleId,
    changes: { method: 'DELETE', path: `/api/v1/roles/${roleId}/permissions/${permissionId}`, permissionId },
  });

  return { message: 'Permission removed', data: await hydrateRole(c, roleId, lang) };
}

export async function findAllPermissions(c: Ctx, lang: string | null, page: number, limit: number) {
  const db = getDb(c);
  const [permissions, total, active] = await Promise.all([
    db.permissions.findMany({ include: { permission_translations: true }, orderBy: { name: 'asc' }, skip: (page - 1) * limit, take: limit }),
    db.permissions.count(),
    loadActiveLanguages(db),
  ]);
  return {
    message: 'Permissions fetched',
    data: {
      items: permissions.map((p) => ({
        id: p.id,
        name: p.name,
        permission_translations: p.permission_translations,
        translation: resolveTranslation(p.permission_translations, lang, { active }),
      })),
      pagination: buildPaginationMeta(page, limit, total),
    },
  };
}
