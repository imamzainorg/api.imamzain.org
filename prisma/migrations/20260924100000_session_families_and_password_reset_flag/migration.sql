-- ===========================================================================
-- 20260924100000_session_families_and_password_reset_flag
--
-- Tier 2 audit, cluster B.
--
-- S13 — refresh-token families. Reuse detection used to revoke EVERY session of
-- the user (and bump token_version) whenever an already-rotated token showed up,
-- so a benign concurrent refresh, or a stale token left on a logged-out device,
-- signed the user out everywhere. Tokens now belong to a family (one per login);
-- rotation inherits family_id and stamps replaced_by_id on the old row. A token
-- rotated a few seconds ago is treated as a benign race; an older one revokes
-- only its own family. A revoked row WITHOUT replaced_by_id was ended by logout /
-- a password change and is simply dead.
--
--   * family_id defaults to gen_random_uuid(), so every existing row becomes its
--     own family and the previous app version (which never writes the column)
--     keeps inserting valid rows while a deploy is in flight.
--   * replaced_by_id is a plain uuid, not a foreign key: the daily retention
--     sweep deletes rows independently and a dangling pointer must not block it.
--
-- B-RBAC2 — users.must_change_password. Admin-set passwords were permanent.
-- adminResetPassword sets the flag, the user's own change-password clears it.
-- Server-side enforcement is opt-in (ENFORCE_PASSWORD_CHANGE_AFTER_RESET), so
-- adding the column changes nothing for anyone until the CMS ships its screen.
--
-- Additive only. Re-running is safe. Adding family_id rewrites refresh_tokens
-- (a volatile default is evaluated per row); the table holds at most a week of
-- tokens, so the ACCESS EXCLUSIVE lock is held for milliseconds.
-- ===========================================================================

ALTER TABLE refresh_tokens
  ADD COLUMN IF NOT EXISTS family_id uuid NOT NULL DEFAULT gen_random_uuid();

ALTER TABLE refresh_tokens
  ADD COLUMN IF NOT EXISTS replaced_by_id uuid;

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_family_id
  ON refresh_tokens (family_id);

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false;
