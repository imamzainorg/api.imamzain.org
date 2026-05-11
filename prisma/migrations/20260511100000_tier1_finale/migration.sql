-- ===========================================================================
-- Tier-1 finale: password reset + site settings + SEO fields on posts
-- ===========================================================================
-- Apply with:
--   psql "$DIRECT_URL" -f prisma/migrations/20260511100000_tier1_finale/migration.sql
-- Then run:
--   npm run prisma:pull && npm run prisma:generate
--
-- Idempotent — re-running is a no-op.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- (Password reset table is intentionally not created here.)
--
-- The `users` table has no `email` column, so a self-service "forgot
-- password" flow has nowhere to send a token. For the current in-house
-- threat model (small team, physical access controls, employees
-- onboarded out-of-band), password recovery is admin-driven: an
-- authenticated admin calls POST /users/:id/reset-password to set a
-- new password directly on behalf of a user who has forgotten theirs.
-- No token table is needed for this flow.
--
-- If the model later expands to remote contractors or external users,
-- (a) add `email` to `users`, and (b) re-introduce a
-- `password_reset_tokens` table with the schema below:
--
--   id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
--   user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
--   token_hash  text NOT NULL UNIQUE,   -- SHA-256 of the raw token
--   expires_at  timestamptz NOT NULL,
--   used_at     timestamptz NULL,        -- non-null after redemption
--   ip          inet NULL,
--   created_at  timestamptz NOT NULL DEFAULT now()
-- ---------------------------------------------------------------------------


-- ---------------------------------------------------------------------------
-- 1. Site settings
-- ---------------------------------------------------------------------------
-- Key/value store for things editors should be able to change without a
-- redeploy: site name, contact email, social links, default language,
-- footer text per language, the addresses that receive form notifications,
-- etc. `type` lets the API serialise/deserialise the `value` text column.
-- `is_public` gates the GET /settings/public endpoint so the front-end can
-- read site metadata without authenticating; admin-only settings stay
-- invisible to anonymous callers.
-- ---------------------------------------------------------------------------

DO $$ BEGIN
  CREATE TYPE site_setting_type AS ENUM ('string', 'number', 'boolean', 'json');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS site_settings (
  key          text              PRIMARY KEY,
  value        text              NOT NULL,
  type         site_setting_type NOT NULL DEFAULT 'string',
  description  text              NULL,
  is_public    boolean           NOT NULL DEFAULT false,
  updated_at   timestamptz       NOT NULL DEFAULT now(),
  updated_by   uuid              NULL REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_site_settings_public
  ON site_settings(is_public)
  WHERE is_public = true;


-- ---------------------------------------------------------------------------
-- 2. SEO fields on post_translations
-- ---------------------------------------------------------------------------
-- - meta_title:       used in <title> + the Google SERP heading; usually
--                     shorter/punchier than the on-page title. Null falls
--                     back to the regular title at render time.
-- - meta_description: the SERP snippet + the og:description card text;
--                     ~155 char target. Null falls back to summary or
--                     a body excerpt at render time.
-- - og_image_id:      the image used for og:image / twitter:image when
--                     the URL is shared. Null falls back to the post's
--                     cover_image_id at render time.
-- ---------------------------------------------------------------------------

ALTER TABLE post_translations
  ADD COLUMN IF NOT EXISTS meta_title        text NULL,
  ADD COLUMN IF NOT EXISTS meta_description  text NULL,
  ADD COLUMN IF NOT EXISTS og_image_id       uuid NULL;

-- Add the FK separately so re-running doesn't try to recreate the
-- constraint (ALTER TABLE ... ADD CONSTRAINT has no IF NOT EXISTS).
DO $$ BEGIN
  ALTER TABLE post_translations
    ADD CONSTRAINT post_translations_og_image_id_fkey
    FOREIGN KEY (og_image_id) REFERENCES media(id)
    ON UPDATE NO ACTION ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_post_translations_og_image
  ON post_translations(og_image_id);
