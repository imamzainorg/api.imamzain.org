import { ConflictException, ForbiddenException } from '@nestjs/common';
import type { Prisma, PrismaClient } from '@prisma/client';

/**
 * RBAC invariants shared by the users and roles services.
 *
 * 1. Privilege envelope — an actor may only manage (reset the password of,
 *    rename, delete, grant to, revoke from) a subject whose permissions are all
 *    within the actor's own. Without it, the seeded `admin` role (which holds
 *    `users:update` but not `roles:*`) could reset a super-admin's password,
 *    log in as them, and own everything.
 *
 * 2. Last administrator — at least one active user must always hold every
 *    permission in the system, otherwise no account can ever repair the role
 *    graph again (the envelope rule means nobody can grant what they don't
 *    hold, so an all-permissions holder is the only recovery path that does
 *    not involve editing the database by hand).
 */

export type RbacClient = Prisma.TransactionClient | PrismaClient;

export const MANAGE_USER_ENVELOPE_MESSAGE =
  'You cannot manage a user who holds permissions beyond your own';

export const LAST_ADMINISTRATOR_MESSAGE =
  'This change would leave no active user holding every permission — grant another account the full permission set first';

/**
 * Throw 403 unless every `subjectPermissions` entry is also held by the actor.
 * Equal sets pass (peers may manage each other); only a strict superset is refused.
 */
export function assertWithinActorEnvelope(
  actorPermissions: Iterable<string> | undefined,
  subjectPermissions: Iterable<string>,
  message: string,
): void {
  const own = new Set(actorPermissions ?? []);
  for (const permission of subjectPermissions) {
    if (!own.has(permission)) throw new ForbiddenException(message);
  }
}

export type AdministratorChange =
  | { kind: 'delete-user'; userId: string }
  | { kind: 'remove-role'; userId: string; roleId: string }
  | { kind: 'remove-permission'; roleId: string; permissionId: string };

interface UserRolesSnapshot {
  id: string;
  user_roles: {
    role_id: string;
    roles: { role_permissions: { permission_id: string }[] };
  }[];
}

function effectivePermissionIds(user: UserRolesSnapshot, change: AdministratorChange | null): Set<string> {
  const ids = new Set<string>();
  for (const ur of user.user_roles) {
    if (change?.kind === 'remove-role' && change.userId === user.id && change.roleId === ur.role_id) continue;
    for (const rp of ur.roles.role_permissions) {
      if (
        change?.kind === 'remove-permission' &&
        change.roleId === ur.role_id &&
        change.permissionId === rp.permission_id
      ) {
        continue;
      }
      ids.add(rp.permission_id);
    }
  }
  return ids;
}

/**
 * Throw 409 when applying `change` would leave zero active users holding the
 * full permission set. Runs against the caller's transaction client so the
 * check and the mutation share one snapshot.
 *
 * If the invariant is already broken (nobody holds the full set), the change
 * is allowed through — refusing would block the very operations an operator
 * needs to repair the state.
 */
export async function assertNotLastAdministrator(db: RbacClient, change: AdministratorChange): Promise<void> {
  const [totalPermissions, users] = await Promise.all([
    db.permissions.count(),
    db.users.findMany({
      where: { deleted_at: null },
      select: {
        id: true,
        user_roles: {
          select: {
            role_id: true,
            roles: { select: { role_permissions: { select: { permission_id: true } } } },
          },
        },
      },
    }),
  ]);
  if (totalPermissions === 0) return;

  const isAdministrator = (user: UserRolesSnapshot, applied: AdministratorChange | null) =>
    effectivePermissionIds(user, applied).size >= totalPermissions;

  const before = users.filter((u) => isAdministrator(u, null)).length;
  if (before === 0) return;

  const after = users.filter(
    (u) => !(change.kind === 'delete-user' && u.id === change.userId) && isAdministrator(u, change),
  ).length;
  if (after === 0) throw new ConflictException(LAST_ADMINISTRATOR_MESSAGE);
}
