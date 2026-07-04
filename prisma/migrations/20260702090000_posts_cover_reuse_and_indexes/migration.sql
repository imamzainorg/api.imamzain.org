-- posts.cover_image_id was UNIQUE by accident (books has no such constraint and
-- the media library is built for reuse). Replace the unique with a plain
-- index: the index itself must stay because the FK's ON DELETE SET NULL and the
-- media-delete reference count both scan posts by cover_image_id.
--
-- The unique exists in two physical forms depending on how the database was
-- built: production (pre-baseline, via db push) carries a UNIQUE CONSTRAINT;
-- databases created from the baseline migration carry a bare unique index.
-- Handle both — DROP CONSTRAINT also drops its backing index, making the
-- DROP INDEX a no-op there. IF EXISTS/IF NOT EXISTS keep a retry safe.
ALTER TABLE "posts" DROP CONSTRAINT IF EXISTS "posts_cover_image_id_key";
DROP INDEX IF EXISTS "posts_cover_image_id_key";
CREATE INDEX IF NOT EXISTS "idx_posts_cover_image" ON "posts"("cover_image_id");

-- CMS media list orders by created_at DESC.
CREATE INDEX IF NOT EXISTS "idx_media_created_at" ON "media"("created_at" DESC);

-- Dashboard recent-attempts count and admin list ORDER BY started_at DESC.
CREATE INDEX IF NOT EXISTS "idx_contest_attempts_started_at" ON "qutuf_sajjadiya_contest_attempts"("started_at" DESC);
