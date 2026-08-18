-- academic_paper_translations.slug/meta_title/meta_description/og_image_id
-- (added in 20260607120000_book_paper_slugs_and_seo_meta, mirroring
-- posts/books) turned out to be a structurally dead feature: the public
-- site has no detail route for academic papers at all (per
-- src/feeds/feeds.service.ts's own comment — papers open in a modal on
-- /research/scientific-platform, not a dedicated page), so nothing ever
-- reaches a search engine or social scraper to consume these fields, and
-- GET /academic-papers/by-slug/:slug has never been reachable from the
-- public site's navigation. Removing rather than leaving unused schema +
-- API surface + an SEO promise the app can't keep.
--
-- Confirmed before writing this: no production row has ever set og_image_id
-- (checked via the reference count already guarded in media.service.ts's
-- delete() method, which is updated alongside this migration).

DROP INDEX IF EXISTS "uq_academic_paper_translations_lang_slug";
DROP INDEX IF EXISTS "idx_academic_paper_translations_og_image";

ALTER TABLE "academic_paper_translations" DROP COLUMN IF EXISTS "slug";
ALTER TABLE "academic_paper_translations" DROP COLUMN IF EXISTS "meta_title";
ALTER TABLE "academic_paper_translations" DROP COLUMN IF EXISTS "meta_description";
ALTER TABLE "academic_paper_translations" DROP COLUMN IF EXISTS "og_image_id";
