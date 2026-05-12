-- ===========================================================================
-- 20260512200000_daily_hadiths_and_youtube
--
-- Two new feature areas. Both are additive — no existing tables touched.
--
-- 1. Daily hadiths
--    A small CMS-managed list of hadiths that rotate through the public
--    homepage one per calendar day. The "today's hadith" is picked
--    server-side from (daysSinceEpoch % active_count) so the homepage
--    response is identical for every visitor on the same date and can
--    be cached aggressively at the CDN.
--
--    Editors can pin a specific hadith to a specific date via
--    daily_hadith_pins; that overrides the natural rotation for that
--    one day, then rotation resumes the next day.
--
-- 2. YouTube content
--    Local mirror of the imamzain YouTube channel's videos + playlists,
--    populated by a 6-hour cron in the API. The homepage and the
--    dedicated /videos page on the public site read from these tables;
--    we never hit the YouTube Data API on the request path. Keeps
--    API quota use predictable and lets the homepage be cached even
--    when YouTube is slow / down.
--
-- Re-running is safe; every CREATE uses IF NOT EXISTS.
-- ===========================================================================

-- ── Daily hadiths ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS daily_hadiths (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  display_order integer     NOT NULL DEFAULT 0,
  is_active     boolean     NOT NULL DEFAULT true,
  created_at    timestamptz(6) NOT NULL DEFAULT now(),
  updated_at    timestamptz(6) NOT NULL DEFAULT now(),
  created_by    uuid        REFERENCES users(id),
  deleted_at    timestamptz(6)
);

CREATE INDEX IF NOT EXISTS idx_daily_hadiths_rotation
  ON daily_hadiths (display_order, id)
  WHERE deleted_at IS NULL AND is_active = true;

CREATE INDEX IF NOT EXISTS idx_daily_hadiths_created_by
  ON daily_hadiths (created_by);

CREATE TABLE IF NOT EXISTS daily_hadith_translations (
  hadith_id  uuid     NOT NULL REFERENCES daily_hadiths(id) ON DELETE CASCADE,
  lang       char(2)  NOT NULL REFERENCES languages(code) ON DELETE CASCADE,
  content    text     NOT NULL,
  source     text,
  is_default boolean  NOT NULL DEFAULT false,
  PRIMARY KEY (hadith_id, lang)
);

CREATE TABLE IF NOT EXISTS daily_hadith_pins (
  pin_date   date         PRIMARY KEY,
  hadith_id  uuid         NOT NULL REFERENCES daily_hadiths(id) ON DELETE CASCADE,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  created_by uuid         REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_daily_hadith_pins_hadith
  ON daily_hadith_pins (hadith_id);

-- ── YouTube content ─────────────────────────────────────────────────────────

-- Single row per unique YouTube video. The `video_id` is the 11-character
-- YouTube ID (e.g. "dQw4w9WgXcQ"). `last_synced_at` lets us evict rows
-- the YouTube API has stopped returning (deleted / privated videos).
CREATE TABLE IF NOT EXISTS youtube_videos (
  id              uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id        text           UNIQUE NOT NULL,
  title           text           NOT NULL,
  description     text,
  thumbnail_url   text,
  channel_id      text           NOT NULL,
  channel_title   text,
  published_at    timestamptz(6),
  duration        text,           -- ISO 8601, e.g. "PT5M30S"
  view_count      bigint,
  like_count      bigint,
  last_synced_at  timestamptz(6) NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_youtube_videos_published
  ON youtube_videos (published_at DESC NULLS LAST);

-- Single row per public playlist on the channel.
CREATE TABLE IF NOT EXISTS youtube_playlists (
  id              uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  playlist_id     text           UNIQUE NOT NULL,
  title           text           NOT NULL,
  description     text,
  thumbnail_url   text,
  item_count      integer,
  channel_id      text           NOT NULL,
  published_at    timestamptz(6),
  last_synced_at  timestamptz(6) NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_youtube_playlists_published
  ON youtube_playlists (published_at DESC NULLS LAST);

-- Join table preserving playlist ordering. `position` is the YouTube-side
-- index inside the playlist (0-based).
CREATE TABLE IF NOT EXISTS youtube_playlist_items (
  playlist_id uuid    NOT NULL REFERENCES youtube_playlists(id) ON DELETE CASCADE,
  video_id    uuid    NOT NULL REFERENCES youtube_videos(id) ON DELETE CASCADE,
  position    integer NOT NULL,
  PRIMARY KEY (playlist_id, video_id)
);

CREATE INDEX IF NOT EXISTS idx_youtube_playlist_items_position
  ON youtube_playlist_items (playlist_id, position);
