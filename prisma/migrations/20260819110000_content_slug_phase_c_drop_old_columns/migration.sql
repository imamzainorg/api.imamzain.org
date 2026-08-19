-- Content-slug consolidation — PHASE C of 3 (destructive: drop old columns).
--
-- DO NOT bundle this with an additive migration. Deploy this ONLY after the
-- Phase C app-code cutover (the commit that moves posts/books/static-pages
-- create/update/delete/restore/findBySlug + feeds.service.ts +
-- homepage.service.ts + search.service.ts over to the spine-level `slug`
-- column) has been live in production and confirmed working. Once that's
-- true, nothing reads or writes post_translations.slug,
-- book_translations.slug, or static_page_translations.slug any more, and
-- it is safe to remove them.
--
-- Per this project's migration-splitting practice: this file is checked in
-- alongside the Phase B migration (20260819100000) but is meant to be
-- EXCLUDED from the `prisma migrate deploy` run that ships Phase B + the
-- app-code cutover (temporarily move this migration's folder out of
-- prisma/migrations/ for that one deploy, then move it back — still
-- pending, untouched) and applied on its own, later, as an explicit,
-- separately-confirmed step.

-- Safety net: re-run the Phase A backfill in case a row is still missing
-- its spine-level slug (should be none — verified before this migration
-- ships; cheap insurance since the source columns are about to disappear).
UPDATE "posts" p
SET "slug" = t."slug"
FROM "post_translations" t
WHERE t."post_id" = p."id" AND t."is_default" = true AND p."slug" IS NULL;

UPDATE "static_pages" sp
SET "slug" = t."slug"
FROM "static_page_translations" t
WHERE t."page_id" = sp."id" AND t."is_default" = true AND sp."slug" IS NULL;

-- Tighten to NOT NULL, matching the requiredness the old translation-level
-- column always had (books.slug stays nullable — book_translations.slug
-- was always optional too).
ALTER TABLE "posts" ALTER COLUMN "slug" SET NOT NULL;
ALTER TABLE "static_pages" ALTER COLUMN "slug" SET NOT NULL;

-- Drop the old translation-level slug columns and their constraints.
DROP INDEX IF EXISTS "post_translations_lang_slug_key";
ALTER TABLE "post_translations" DROP COLUMN IF EXISTS "slug";

DROP INDEX IF EXISTS "uq_book_translations_lang_slug";
ALTER TABLE "book_translations" DROP COLUMN IF EXISTS "slug";

ALTER TABLE "static_page_translations" DROP CONSTRAINT IF EXISTS "static_page_translations_lang_slug_key";
ALTER TABLE "static_page_translations" DROP COLUMN IF EXISTS "slug";
