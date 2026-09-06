-- ===========================================================================
-- 20260906120000_hadith_display_date
--
-- Replaces the hadith-of-the-day ROTATION FORMULA with direct editorial
-- scheduling. Previously "today's hadith" was daysSinceEpoch % activeCount
-- against the current pool -- any edit to the pool (add/remove/reorder)
-- silently changed what every unpinned date was reported to have shown,
-- including dates that had already passed.
--
-- The fix: give each hadith its own display_date. An editor sets it
-- deliberately, only when a hadith is thematically tied to a specific
-- calendar occasion -- it is never auto-assigned. "Today's hadith" becomes
-- `WHERE display_date = today`: a lookup, not a computation over mutable
-- state, so it cannot drift. When nothing is scheduled for today, the API
-- falls back to a genuinely random undated hadith and writes nothing back
-- (see DailyHadithsService.getToday) -- a hadith is scheduled to a date
-- only by deliberate editorial choice, never as a side effect of being
-- shown.
--
-- Uniqueness on display_date is a PARTIAL index (declared in this
-- migration) rather than a plain UNIQUE constraint, scoped to
-- `display_date IS NOT NULL AND deleted_at IS NULL`: soft-deleting a
-- hadith frees its date for another hadith to claim, matching how this
-- schema already handles unique columns under soft-delete elsewhere
-- (see the slug suffix scheme; a DATE column can't take a text suffix,
-- so a partial index is the direct equivalent here).
--
-- Additive only -- no existing column or table touched yet. The old
-- display_order / is_active / created_by columns, daily_hadith_pins
-- (confirmed 0 rows in production immediately before this migration was
-- written), and daily_hadith_translations.is_default are dropped in a
-- separate, explicitly-confirmed migration: 20260906130000. Do not apply
-- that one until the new application code (which stops reading all of the
-- above) is deployed.
--
-- Re-running is safe; every ADD/CREATE uses IF NOT EXISTS.
-- ===========================================================================

ALTER TABLE daily_hadiths
  ADD COLUMN IF NOT EXISTS display_date date;

CREATE UNIQUE INDEX IF NOT EXISTS daily_hadiths_display_date_key
  ON daily_hadiths (display_date)
  WHERE display_date IS NOT NULL AND deleted_at IS NULL;

-- Surrogate PK for daily_hadith_translations, replacing the composite
-- (hadith_id, lang) primary key. Added here as a plain column; the PK
-- swap itself (drop the old composite PK, promote this to PK, keep
-- (hadith_id, lang) as a plain UNIQUE constraint) happens in the
-- destructive migration once every row has a populated id.
ALTER TABLE daily_hadith_translations
  ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid();

UPDATE daily_hadith_translations SET id = gen_random_uuid() WHERE id IS NULL;

ALTER TABLE daily_hadith_translations
  ALTER COLUMN id SET NOT NULL;
