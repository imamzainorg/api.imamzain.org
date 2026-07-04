-- posts.cover_image_id was UNIQUE by accident (books has no such constraint and
-- the media library is built for reuse). Replace the unique index with a plain
-- index: the index itself must stay because the FK's ON DELETE SET NULL and the
-- media-delete reference count both scan posts by cover_image_id.
DROP INDEX "posts_cover_image_id_key";
CREATE INDEX "idx_posts_cover_image" ON "posts"("cover_image_id");

-- CMS media list orders by created_at DESC.
CREATE INDEX "idx_media_created_at" ON "media"("created_at" DESC);

-- Dashboard recent-attempts count and admin list ORDER BY started_at DESC.
CREATE INDEX "idx_contest_attempts_started_at" ON "qutuf_sajjadiya_contest_attempts"("started_at" DESC);
