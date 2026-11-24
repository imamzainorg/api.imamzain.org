-- ===========================================================================
-- 20261124100000_video_curation
--
-- Additive. The editorial layer over the YouTube mirror (docs/YOUTUBE-REDESIGN.md, section 9):
--   * youtube_videos.kind: video | short | live, written by the sync from the
--     channel's format playlists. Live items are never served by /videos.
--   * video_entries: one row per mirrored video the site knows: slug, status
--     (published | pending | hidden), featured flag and order, speaker.
--   * video_series: one row per mirrored playlist: slug, section, hidden flag,
--     order on the videos page, speaker.
-- Neither table has a foreign key to the mirror: the sync deletes mirror rows
-- that go private, and the editorial row (and its public slug) must outlive that.
--
-- Safe to apply before the Worker that reads it is deployed: the old Worker
-- never selects these tables or the new column.
-- ===========================================================================

CREATE TYPE youtube_video_kind AS ENUM ('video', 'short', 'live');
CREATE TYPE video_status AS ENUM ('published', 'pending', 'hidden');
CREATE TYPE video_section AS ENUM ('programmes', 'commentaries', 'majalis', 'events');

ALTER TABLE youtube_videos ADD COLUMN kind youtube_video_kind NOT NULL DEFAULT 'video';

CREATE TABLE video_entries (
    youtube_video_id text PRIMARY KEY,
    slug             text NOT NULL,
    status           video_status NOT NULL,
    is_featured      boolean NOT NULL DEFAULT false,
    featured_order   integer NOT NULL DEFAULT 0,
    speaker_id       uuid REFERENCES speakers(id) ON DELETE SET NULL ON UPDATE NO ACTION,
    created_at       timestamptz(6) NOT NULL DEFAULT now(),
    updated_at       timestamptz(6) NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_video_entries_slug ON video_entries (slug);
CREATE INDEX idx_video_entries_status ON video_entries (status);

CREATE TABLE video_series (
    youtube_playlist_id text PRIMARY KEY,
    slug                text NOT NULL,
    section             video_section,
    is_hidden           boolean NOT NULL DEFAULT false,
    display_order       integer NOT NULL DEFAULT 0,
    speaker_id          uuid REFERENCES speakers(id) ON DELETE SET NULL ON UPDATE NO ACTION,
    created_at          timestamptz(6) NOT NULL DEFAULT now(),
    updated_at          timestamptz(6) NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_video_series_slug ON video_series (slug);
