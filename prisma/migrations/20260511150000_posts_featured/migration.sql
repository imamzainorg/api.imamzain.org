-- ===========================================================================
-- posts.is_featured — editorial flag for the homepage hero / "featured" rail
-- ===========================================================================
-- Editors flip this on a small number of posts they want surfaced on the
-- public site regardless of date. The corresponding API filter is
-- ?featured=true on GET /posts, orthogonal to ?sort=newest|views.
--
-- Apply with:
--   psql "$DIRECT_URL" -f prisma/migrations/20260511150000_posts_featured/migration.sql
--   npm run prisma:pull && npm run prisma:generate
--
-- Idempotent — re-running is a no-op.
-- ===========================================================================

ALTER TABLE posts
  ADD COLUMN IF NOT EXISTS is_featured boolean NOT NULL DEFAULT false;

-- Partial index for the "small set of featured posts" homepage query.
-- Excludes deleted / unpublished so the public hero query is a single index
-- scan with no recheck.
CREATE INDEX IF NOT EXISTS idx_posts_featured_public
  ON posts(published_at DESC NULLS LAST, id ASC)
  WHERE is_featured = true AND is_published = true AND deleted_at IS NULL;
