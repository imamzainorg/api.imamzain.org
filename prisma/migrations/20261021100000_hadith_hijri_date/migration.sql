-- ===========================================================================
-- 20261021100000_hadith_hijri_date
--
-- Today's hadith is now chosen by the Hijri date Najaf announces (sistani.org),
-- not by a Gregorian display_date: each hadith carries the Hijri month and day
-- it belongs to, and repeats every Hijri year. A 30th in a month that turns out
-- to have 29 days is simply not shown that year.
--
--   * Both columns are nullable, together: a hadith with no Hijri date is kept
--     (a restore whose day was taken comes back without one) but never shown.
--   * One live hadith per Hijri day: the unique index is partial, so a
--     soft-deleted hadith frees its day.
--
-- Additive only. display_date and daily_hadith_random_picks are dropped by the
-- next migration, once the Worker that stops reading them is deployed.
-- ===========================================================================

ALTER TABLE daily_hadiths
  ADD COLUMN IF NOT EXISTS hijri_month smallint,
  ADD COLUMN IF NOT EXISTS hijri_day   smallint;

ALTER TABLE daily_hadiths
  ADD CONSTRAINT daily_hadiths_hijri_date_check CHECK (
    (hijri_month IS NULL AND hijri_day IS NULL)
    OR (hijri_month BETWEEN 1 AND 12 AND hijri_day BETWEEN 1 AND 30)
  );

CREATE UNIQUE INDEX IF NOT EXISTS daily_hadiths_hijri_date_key
  ON daily_hadiths (hijri_month, hijri_day)
  WHERE hijri_month IS NOT NULL AND deleted_at IS NULL;
