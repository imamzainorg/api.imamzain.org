-- View counters for academic_papers, audios and gallery_images — matching
-- the existing posts/books pattern (posts_views_check / books_views_check).
-- All three already have a public detail route (and audios/gallery already
-- have real traffic) with nothing tracking popularity. Additive only:
-- NOT NULL with a default, so existing rows just start at 0.

ALTER TABLE "academic_papers" ADD COLUMN IF NOT EXISTS "views" BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "academic_papers" ADD CONSTRAINT "academic_papers_views_check" CHECK (views >= 0);

ALTER TABLE "audios" ADD COLUMN IF NOT EXISTS "views" BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "audios" ADD CONSTRAINT "audios_views_check" CHECK (views >= 0);

ALTER TABLE "gallery_images" ADD COLUMN IF NOT EXISTS "views" BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "gallery_images" ADD CONSTRAINT "gallery_images_views_check" CHECK (views >= 0);
