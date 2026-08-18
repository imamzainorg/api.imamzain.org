-- Draft/publish workflow for books, academic_papers and gallery_images —
-- matching the existing posts/audios/static_pages pattern. Previously every
-- row of these three types went live the instant it was created, with no
-- way to stage content before an official release date or temporarily hide
-- a photo without hard-deleting it.
--
-- DEFAULT TRUE is deliberate: every existing row must stay publicly visible
-- after this migration — this only adds the *capability* to draft new
-- content going forward, it does not hide anything that's live today.

ALTER TABLE "books" ADD COLUMN IF NOT EXISTS "is_published" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "academic_papers" ADD COLUMN IF NOT EXISTS "is_published" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "gallery_images" ADD COLUMN IF NOT EXISTS "is_published" BOOLEAN NOT NULL DEFAULT true;
