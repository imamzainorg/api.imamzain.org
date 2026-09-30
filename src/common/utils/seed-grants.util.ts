/**
 * Which of a default role's listed permissions the seed may grant on this run.
 *
 * The seed is re-run in production whenever a release adds permissions. It
 * used to upsert EVERY listed grant each time, which silently handed back any
 * permission an administrator had deliberately removed from a default role.
 * Default grants are therefore create-only:
 *
 *   - a role created by this run gets its full default set;
 *   - an existing role only gains permissions that this run itself created
 *     (a new feature's permissions must reach the roles meant to have them);
 *   - everything else is left exactly as the administrators set it.
 *
 * `reset` restores the old "re-apply every default" behaviour on purpose
 * (SEED_RESET_ROLE_GRANTS=true) — the escape hatch for a role that was
 * stripped by mistake and that nobody can repair through the API any more.
 */
export interface RoleGrantPlanInput {
  /** Permission names the seed lists for this role. */
  listed: readonly string[];
  /** True when this run inserted the role row. */
  roleIsNew: boolean;
  /** Permission names the role already holds in the database. */
  alreadyGranted: ReadonlySet<string>;
  /** Permission names this run inserted into `permissions`. */
  newPermissions: ReadonlySet<string>;
  reset?: boolean;
}

export interface RoleGrantPlan {
  /** Grants to insert now. */
  grant: string[];
  /** Listed, missing, and deliberately left alone (an admin removed them). */
  leftRemoved: string[];
}

export function planRoleGrants(input: RoleGrantPlanInput): RoleGrantPlan {
  const grant: string[] = [];
  const leftRemoved: string[] = [];

  for (const name of new Set(input.listed)) {
    if (input.alreadyGranted.has(name)) continue;
    if (input.reset || input.roleIsNew || input.newPermissions.has(name)) {
      grant.push(name);
    } else {
      leftRemoved.push(name);
    }
  }

  return { grant, leftRemoved };
}
