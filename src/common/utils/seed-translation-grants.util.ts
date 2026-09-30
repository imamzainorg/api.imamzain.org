/**
 * Whether the seed may (re)write a title/description translation row for one
 * language on this run. Used for both `permission_translations` and
 * `role_translations` — the two share the exact same (title, description)
 * shape and the exact same problem.
 *
 * This is the same problem `planRoleGrants` (seed-grants.util.ts) solves for
 * role→permission grants: the seed used to upsert `update: { title,
 * description }` unconditionally on every run, which silently clobbered any
 * wording a CMS admin had since customized. Writes are therefore create-only:
 *
 *   - a row that doesn't exist yet always gets written — that covers both a
 *     brand-new permission/role (the seed authors its first text) and an
 *     existing one that simply never had a translation for that language
 *     (filling a gap isn't trampling anything);
 *   - an existing row is left alone, since an admin may have edited it;
 *   - `reset` (SEED_RESET_ROLE_GRANTS=true — the same escape hatch used for
 *     role grants, not a second flag) restores the old "always overwrite"
 *     behaviour on purpose.
 */
export interface ExistingTranslation {
  title: string;
  description: string | null;
}

export interface DesiredTranslation {
  title: string;
  description?: string;
}

export interface TranslationWritePlanInput {
  /** The existing (resource_id, lang) row, or null if none exists yet. */
  existing: ExistingTranslation | null;
  /** The title/description the seed currently lists for this resource + language. */
  desired: DesiredTranslation;
  /** True when this run inserted the parent permission/role row itself. */
  isNewRow: boolean;
  reset?: boolean;
}

/** Returns what to write, or null to leave the existing row untouched. */
export function planTranslationWrite(input: TranslationWritePlanInput): DesiredTranslation | null {
  if (!input.existing || input.isNewRow || input.reset) return input.desired;
  return null;
}
