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

-- Second-tier safety net: a row with ZERO translations at all (no default
-- to backfill from — e.g. static_pages had 10 soft-deleted rows from a
-- failed 2026-05-30 batch op, see round-14 audit §19.h) is invisible to the
-- pre-flight check above, which only looks at deleted_at IS NULL rows.
-- NOT NULL is a column-level constraint with no deleted_at exception, so
-- any surviving NULL gets a synthetic, guaranteed-unique placeholder
-- instead of blocking the migration. This caused a real failed deploy
-- attempt (20260819110000, started 2026-08-19 06:50:53 UTC) before this
-- fix was added — Postgres rolled the whole transaction back cleanly, no
-- data was left inconsistent, but `prisma migrate resolve --rolled-back`
-- was needed before deploys could proceed again.
UPDATE "posts" SET "slug" = 'orphan-' || "id" WHERE "slug" IS NULL;
UPDATE "static_pages" SET "slug" = 'orphan-' || "id" WHERE "slug" IS NULL;

-- Tighten to NOT NULL, matching the requiredness the old translation-level
-- column always had (books.slug stays nullable — book_translations.slug
-- was always optional too).
ALTER TABLE "posts" ALTER COLUMN "slug" SET NOT NULL;
ALTER TABLE "static_pages" ALTER COLUMN "slug" SET NOT NULL;

-- Drop the old translation-level slug columns and their constraints.
-- post_translations_lang_slug_key turns out to be a genuine table
-- CONSTRAINT in production (not a bare index, despite how the baseline
-- migration creates it) — DROP INDEX fails with "cannot drop index ...
-- because constraint ... requires it". Confirmed by a real failed deploy
-- attempt (started 2026-08-23 08:00:36 UTC); rolled back cleanly, no data
-- affected. DROP CONSTRAINT ... CASCADE removes the backing index too.
ALTER TABLE "post_translations" DROP CONSTRAINT IF EXISTS "post_translations_lang_slug_key";
ALTER TABLE "post_translations" DROP COLUMN IF EXISTS "slug";

DROP INDEX IF EXISTS "uq_book_translations_lang_slug";
ALTER TABLE "book_translations" DROP COLUMN IF EXISTS "slug";

ALTER TABLE "static_page_translations" DROP CONSTRAINT IF EXISTS "static_page_translations_lang_slug_key";
ALTER TABLE "static_page_translations" DROP COLUMN IF EXISTS "slug";
