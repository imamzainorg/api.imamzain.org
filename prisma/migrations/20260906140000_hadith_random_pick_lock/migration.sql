-- ===========================================================================
-- 20260906140000_hadith_random_pick_lock
--
-- The /today random fallback (drawn when nothing has an editor-set
-- display_date for the day) was intentionally re-rolled on every single
-- request, with nothing persisted. In practice that meant two visitors
-- could see different hadiths within the same day depending on which
-- origin instance or CDN edge served them. Locks the fallback instead:
-- the first request each day that finds nothing scheduled draws randomly
-- and records the winner here; every later request that day reads this
-- row instead of drawing again, so every visitor sees the same hadith
-- for the rest of that day.
--
-- Deliberately a separate table from daily_hadiths.display_date -- that
-- column is reserved for a deliberate editorial decision (a hadith tied
-- to a specific occasion) and must never be set as a side effect of being
-- randomly shown. This table only ever records "which hadith stood in
-- for this day", nothing more; a scheduled hadith always wins over an
-- existing lock for the same date, unconditionally, on every request.
--
-- hadith_id is nullable + ON DELETE SET NULL: hard-deleting a hadith
-- isn't exposed via any API today (only soft-delete, which this table
-- deliberately still honours -- once locked, a day keeps its pick even
-- if that hadith is later soft-deleted, same precedent as display_date
-- lookups). This FK only guards a manual hard delete performed directly
-- against the database.
--
-- Additive only -- no existing table or column touched. Re-running is
-- safe.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS daily_hadith_random_picks (
  pick_date date           PRIMARY KEY,
  hadith_id uuid           REFERENCES daily_hadiths(id) ON DELETE SET NULL,
  locked_at timestamptz(6) NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_daily_hadith_random_picks_hadith
  ON daily_hadith_random_picks (hadith_id);
