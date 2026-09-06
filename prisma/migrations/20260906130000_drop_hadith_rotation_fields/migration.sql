-- ===========================================================================
-- 20260906130000_drop_hadith_rotation_fields
--
-- Destructive half of the hadith-scheduling change started in
-- 20260906120000. Removes everything the old rotation/pin mechanism
-- needed that the application no longer reads anywhere:
--
--   - daily_hadiths.display_order / is_active / created_by -- rotation
--     ordering, active-pool filtering, and creator attribution. The
--     latter is already covered by audit_logs (DAILY_HADITH_CREATED
--     records the actor for every row).
--   - daily_hadith_translations.is_default -- the language fallback is
--     now a plain `orderBy: { lang: 'asc' }` so 'ar' sorts first; see
--     resolveTranslation call sites in daily-hadiths.service.ts.
--   - daily_hadith_translations' old (hadith_id, lang) primary key, in
--     favour of the surrogate `id` column added in 20260906120000.
--     (hadith_id, lang) becomes a plain UNIQUE constraint instead, so
--     "one translation per language per hadith" is still enforced.
--   - daily_hadith_pins entirely. Confirmed 0 rows in production
--     (imamzain-api-db) immediately before 20260906120000 was written --
--     no data-preservation step needed.
--
-- DO NOT apply until 20260906120000 has been applied AND the new
-- application code (which no longer references any column or table
-- dropped here) is deployed. Requires its own explicit go-ahead, kept
-- separate from the additive migration -- do not bundle the two.
-- ===========================================================================

ALTER TABLE daily_hadiths
  DROP CONSTRAINT IF EXISTS daily_hadiths_created_by_fkey;

DROP INDEX IF EXISTS idx_daily_hadiths_created_by;
DROP INDEX IF EXISTS idx_daily_hadiths_rotation;

ALTER TABLE daily_hadiths
  DROP COLUMN IF EXISTS display_order,
  DROP COLUMN IF EXISTS is_active,
  DROP COLUMN IF EXISTS created_by;

ALTER TABLE daily_hadith_translations
  DROP COLUMN IF EXISTS is_default;

-- Drop the original composite primary key by looking its name up rather
-- than hardcoding it (it was auto-named by Postgres when the table was
-- first created as `PRIMARY KEY (hadith_id, lang)` with no explicit
-- constraint name -- almost certainly daily_hadith_translations_pkey by
-- Postgres's default convention, but this is defensive against it having
-- been renamed).
DO $$
DECLARE
  pk_name text;
BEGIN
  SELECT constraint_name INTO pk_name
  FROM information_schema.table_constraints
  WHERE table_name = 'daily_hadith_translations' AND constraint_type = 'PRIMARY KEY';
  IF pk_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE daily_hadith_translations DROP CONSTRAINT %I', pk_name);
  END IF;
END $$;

ALTER TABLE daily_hadith_translations
  ADD PRIMARY KEY (id);

ALTER TABLE daily_hadith_translations
  ADD CONSTRAINT daily_hadith_translations_hadith_id_lang_key UNIQUE (hadith_id, lang);

DROP TABLE IF EXISTS daily_hadith_pins;
