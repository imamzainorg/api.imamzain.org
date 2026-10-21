-- ===========================================================================
-- 20261021110000_drop_hadith_gregorian_schedule
--
-- Destructive. Drops what the Gregorian schedule and the random fallback used:
-- daily_hadiths.display_date (with its partial unique index) and
-- daily_hadith_random_picks. Today's hadith is looked up by Hijri date
-- (20261021100000_hadith_hijri_date); a day with no hadith shows none.
--
-- Apply only after the Worker that reads hijri_month / hijri_day is deployed:
-- the previous version still queries both.
-- ===========================================================================

DROP TABLE IF EXISTS daily_hadith_random_picks;

DROP INDEX IF EXISTS daily_hadiths_display_date_key;

ALTER TABLE daily_hadiths DROP COLUMN IF EXISTS display_date;
