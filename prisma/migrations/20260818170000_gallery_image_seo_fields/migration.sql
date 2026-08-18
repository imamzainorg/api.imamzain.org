-- ===========================================================================
-- 20260818170000_gallery_image_seo_fields
--
-- SEO meta for gallery images, mirroring the pattern already used by
-- post_translations / book_translations / academic_paper_translations /
-- static_page_translations (see 20260607120000_book_paper_slugs_and_seo_meta).
-- gallery had a public detail route (GET /gallery/:id) but no SEO fields —
-- the other four content types all got this, gallery was the one gap.
--
-- Per-translation meta_title / meta_description / og_image_id. og_image_id
-- is an optional FK to media; ON DELETE SET NULL so hard-deleting an image
-- can't dangle the reference (media.service.ts's delete() reference-count
-- guard is updated in the same commit to cover this new FK).
--
-- Additive only — no existing column is altered. Re-running is safe (every
-- statement is guarded with IF NOT EXISTS or a DO-block constraint check).
-- ===========================================================================

ALTER TABLE gallery_image_translations
  ADD COLUMN IF NOT EXISTS meta_title       text,
  ADD COLUMN IF NOT EXISTS meta_description text,
  ADD COLUMN IF NOT EXISTS og_image_id      uuid;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gallery_image_translations_og_image_id_fkey') THEN
    ALTER TABLE gallery_image_translations
      ADD CONSTRAINT gallery_image_translations_og_image_id_fkey
      FOREIGN KEY (og_image_id) REFERENCES media(id) ON UPDATE NO ACTION ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_gallery_image_translations_og_image
  ON gallery_image_translations (og_image_id);
