// RBAC invariants shared by users and roles (src/common/utils/rbac.util.ts).
//
// 1. Privilege envelope: an actor may only manage a subject whose permissions are all within the
//    actor's own; otherwise the seeded `admin` role (users:update, no roles:*) could reset a
//    super-admin's password and log in as them.
// 2. Last administrator: at least one active user must always hold every permission, or nobody could
//    ever repair the role graph through the API (nobody can grant what they don't hold).
import type { Prisma, PrismaClient } from '../generated/prisma/client';
import { conflict, forbidden } from './errors';

type RbacClient = Prisma.TransactionClient | PrismaClient;

export const MANAGE_USER_ENVELOPE_MESSAGE = 'You cannot manage a user who holds permissions beyond your own';

export const LAST_ADMINISTRATOR_MESSAGE =
  'This change would leave no active user holding every permission — grant another account the full permission set first';

/** 403 unless the actor holds every `subjectPermissions` entry. Equal sets pass: peers may manage each other. */
export function assertWithinActorEnvelope(actorPermissions: Iterable<string> | undefined, subjectPermissions: Iterable<string>, message: string): void {
  const own = new Set(actorPermissions ?? []);
  for (const permission of subjectPermissions) {
    if (!own.has(permission)) throw forbidden(message);
  }
}

export type AdministratorChange =
  | { kind: 'delete-user'; userId: string }
  | { kind: 'remove-role'; userId: string; roleId: string }
  | { kind: 'remove-permission'; roleId: string; permissionId: string };

interface UserRolesSnapshot {
  id: string;
  user_roles: { role_id: string; roles: { role_permissions: { permission_id: string }[] } }[];
}

function effectivePermissionIds(user: UserRolesSnapshot, change: AdministratorChange | null): Set<string> {
  const ids = new Set<string>();
  for (const ur of user.user_roles) {
    if (change?.kind === 'remove-role' && change.userId === user.id && change.roleId === ur.role_id) continue;
    for (const rp of ur.roles.role_permissions) {
      if (change?.kind === 'remove-permission' && change.roleId === ur.role_id && change.permissionId === rp.permission_id) continue;
      ids.add(rp.permission_id);
    }
  }
  return ids;
}

/**
 * 409 when `change` would leave no active user holding the full permission set. Pass the transaction
 * client so the check and the write share one snapshot. If nobody holds the full set already, the
 * change is let through: refusing would block the repair.
 */
export async function assertNotLastAdministrator(db: RbacClient, change: AdministratorChange): Promise<void> {
  const [totalPermissions, users] = await Promise.all([
    db.permissions.count(),
    db.users.findMany({
      where: { deleted_at: null },
      select: { id: true, user_roles: { select: { role_id: true, roles: { select: { role_permissions: { select: { permission_id: true } } } } } } },
    }),
  ]);
  if (totalPermissions === 0) return;

  const isAdministrator = (user: UserRolesSnapshot, applied: AdministratorChange | null) => effectivePermissionIds(user, applied).size >= totalPermissions;

  const before = users.filter((u) => isAdministrator(u, null)).length;
  if (before === 0) return;

  const after = users.filter((u) => !(change.kind === 'delete-user' && u.id === change.userId) && isAdministrator(u, change)).length;
  if (after === 0) throw conflict(LAST_ADMINISTRATOR_MESSAGE);
}
