-- ===========================================================================
-- 20260512100000_search_indexes_and_filters
--
-- Two changes, both purely additive:
--
-- 1. pg_trgm + GIN indexes on every column the API does substring search on.
--    Prisma's `contains: { mode: 'insensitive' }` compiles to ILIKE '%x%',
--    which a B-tree index cannot use. A GIN trigram index can — Postgres
--    drops from a sequential scan to an indexed scan, and search latency
--    becomes O(matches) instead of O(rows). Cheapest possible perf win
--    once the corpus grows past a few hundred rows per resource.
--
-- 2. Helpful B-tree indexes for the new admin filters added in round 6:
--    - posts.is_published (drives the new `?status=` filter)
--    - posts.published_at (drives the scheduled-vs-future check on the
--      scheduled bucket; also already used by the auto-publish cron)
--    - media.mime_type (drives the new `?mime_type=` filter on the
--      media library admin endpoint)
--
-- Re-running is safe — every CREATE uses IF NOT EXISTS.
-- ===========================================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ── Trigram indexes (substring ILIKE search) ────────────────────────────────

-- Posts: title and body are searched via `?search=` on /posts and /search.
CREATE INDEX IF NOT EXISTS idx_post_translations_title_trgm
  ON post_translations USING GIN (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_post_translations_body_trgm
  ON post_translations USING GIN (body gin_trgm_ops);

-- Books: title, author, description searched via /books `?search=` and /search.
CREATE INDEX IF NOT EXISTS idx_book_translations_title_trgm
  ON book_translations USING GIN (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_book_translations_author_trgm
  ON book_translations USING GIN (author gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_book_translations_description_trgm
  ON book_translations USING GIN (description gin_trgm_ops);

-- Academic papers: title + abstract searched via /academic-papers and /search.
CREATE INDEX IF NOT EXISTS idx_academic_paper_translations_title_trgm
  ON academic_paper_translations USING GIN (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_academic_paper_translations_abstract_trgm
  ON academic_paper_translations USING GIN (abstract gin_trgm_ops);

-- Gallery image translations: title + description searched via /search.
CREATE INDEX IF NOT EXISTS idx_gallery_image_translations_title_trgm
  ON gallery_image_translations USING GIN (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_gallery_image_translations_description_trgm
  ON gallery_image_translations USING GIN (description gin_trgm_ops);

-- Media library: filename + alt_text searched via the new /media `?search=`.
CREATE INDEX IF NOT EXISTS idx_media_filename_trgm
  ON media USING GIN (filename gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_media_alt_text_trgm
  ON media USING GIN (alt_text gin_trgm_ops);

-- ── B-tree indexes for admin filters ────────────────────────────────────────

-- Already covered by idx_posts_published (is_published, published_at) — no
-- new index needed for the post status filter; the existing composite serves
-- the `is_published=false AND published_at >= now()` scheduled lookup.

-- Mime type filter on the media library — supports `?mime_type=image/jpeg`.
CREATE INDEX IF NOT EXISTS idx_media_mime_type
  ON media (mime_type);
