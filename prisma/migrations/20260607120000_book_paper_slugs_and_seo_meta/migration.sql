-- ===========================================================================
-- 20260607120000_book_paper_slugs_and_seo_meta
--
-- 1. Slugs for books & academic papers
--    Per-translation, editor-entered latin slug (same shape as posts) so the
--    public site can serve human/SEO-friendly URLs (`/{lang}/books/{slug}`)
--    instead of UUIDs. NULLABLE: existing rows have no latin source to backfill
--    from Arabic titles, so they stay NULL until an editor sets one; new rows
--    can require it at the API layer. Uniqueness is a PARTIAL unique index on
--    (lang, slug) WHERE slug IS NOT NULL — NULLs don't collide, and the live
--    constraint matches the per-lang slug rule used elsewhere. Soft-delete
--    suffixes the slug (like posts) so trashing a row frees the slug.
--
-- 2. SEO meta for static pages, books & academic papers
--    Per-translation meta_title / meta_description / og_image_id, mirroring
--    post_translations. og_image_id is an optional FK to media; ON DELETE SET
--    NULL so hard-deleting an image can't dangle the reference.
--
-- Additive only — no existing column is altered. Re-running is safe (every
-- statement is guarded with IF NOT EXISTS or a DO-block constraint check).
-- ===========================================================================

-- ── 1. Slugs ────────────────────────────────────────────────────────────────

ALTER TABLE book_translations ADD COLUMN IF NOT EXISTS slug text;
CREATE UNIQUE INDEX IF NOT EXISTS uq_book_translations_lang_slug
  ON book_translations (lang, slug) WHERE slug IS NOT NULL;

ALTER TABLE academic_paper_translations ADD COLUMN IF NOT EXISTS slug text;
CREATE UNIQUE INDEX IF NOT EXISTS uq_academic_paper_translations_lang_slug
  ON academic_paper_translations (lang, slug) WHERE slug IS NOT NULL;

-- ── 2. SEO meta ───────────────────────────────────────────────────────────────

ALTER TABLE static_page_translations
  ADD COLUMN IF NOT EXISTS meta_title       text,
  ADD COLUMN IF NOT EXISTS meta_description text,
  ADD COLUMN IF NOT EXISTS og_image_id      uuid;

ALTER TABLE book_translations
  ADD COLUMN IF NOT EXISTS meta_title       text,
  ADD COLUMN IF NOT EXISTS meta_description text,
  ADD COLUMN IF NOT EXISTS og_image_id      uuid;

ALTER TABLE academic_paper_translations
  ADD COLUMN IF NOT EXISTS meta_title       text,
  ADD COLUMN IF NOT EXISTS meta_description text,
  ADD COLUMN IF NOT EXISTS og_image_id      uuid;

-- og_image_id foreign keys + lookup indexes (DO-block guarded for idempotency).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'static_page_translations_og_image_id_fkey') THEN
    ALTER TABLE static_page_translations
      ADD CONSTRAINT static_page_translations_og_image_id_fkey
      FOREIGN KEY (og_image_id) REFERENCES media(id) ON UPDATE NO ACTION ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'book_translations_og_image_id_fkey') THEN
    ALTER TABLE book_translations
      ADD CONSTRAINT book_translations_og_image_id_fkey
      FOREIGN KEY (og_image_id) REFERENCES media(id) ON UPDATE NO ACTION ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'academic_paper_translations_og_image_id_fkey') THEN
    ALTER TABLE academic_paper_translations
      ADD CONSTRAINT academic_paper_translations_og_image_id_fkey
      FOREIGN KEY (og_image_id) REFERENCES media(id) ON UPDATE NO ACTION ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_static_page_translations_og_image
  ON static_page_translations (og_image_id);
CREATE INDEX IF NOT EXISTS idx_book_translations_og_image
  ON book_translations (og_image_id);
CREATE INDEX IF NOT EXISTS idx_academic_paper_translations_og_image
  ON academic_paper_translations (og_image_id);
