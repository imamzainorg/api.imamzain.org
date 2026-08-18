-- Content-slug consolidation — PHASE A of 3 (additive only, zero risk).
--
-- Why: `slug` currently lives on the per-language translation table for
-- posts, books and static_pages (`@@unique([lang, slug])` or a
-- partial-unique equivalent). But the real public site
-- (src/feeds/feeds.service.ts) only ever surfaces ONE canonical URL per
-- resource — the default translation's slug — and explicitly avoids
-- emitting one URL per language to dodge a duplicate-content SEO penalty.
-- Every legacy row seeded so far also has exactly one translation, so the
-- per-language flexibility has never been used. `audios` already does this
-- correctly: a single, language-agnostic `slug` column on the spine table.
-- This migration brings posts / books / static_pages in line with that
-- pattern.
--
-- academic_papers is deliberately excluded: its slug + SEO fields turned
-- out to be a structurally dead feature (no public detail route exists to
-- ever serve them — see the separate migration removing them entirely).
--
-- This file ONLY adds a new nullable spine-level `slug` column and
-- backfills it from each row's current default translation — it does not
-- touch, constrain, or drop anything that exists today. Application code
-- keeps reading/writing the old translation-level slug until Phase C cuts
-- over. Safe to run against production with zero behavioural change and
-- zero chance of failure (no uniqueness is enforced yet — that's Phase B,
-- after a pre-flight check for cross-language slug collisions the OLD
-- per-language uniqueness could have allowed, which the NEW global
-- uniqueness would not).

ALTER TABLE "posts" ADD COLUMN IF NOT EXISTS "slug" TEXT;
ALTER TABLE "books" ADD COLUMN IF NOT EXISTS "slug" TEXT;
ALTER TABLE "static_pages" ADD COLUMN IF NOT EXISTS "slug" TEXT;

-- Backfill from each row's default translation. This mirrors exactly what
-- resolveTranslation(translations, null) already does at read time (the
-- function feeds.service.ts and every findOne/findBySlug call uses), so the
-- canonical slug every visitor already sees does not change.
UPDATE "posts" p
SET "slug" = t."slug"
FROM "post_translations" t
WHERE t."post_id" = p."id" AND t."is_default" = true AND p."slug" IS NULL;

UPDATE "books" b
SET "slug" = t."slug"
FROM "book_translations" t
WHERE t."book_id" = b."id" AND t."is_default" = true AND t."slug" IS NOT NULL AND b."slug" IS NULL;

UPDATE "static_pages" sp
SET "slug" = t."slug"
FROM "static_page_translations" t
WHERE t."page_id" = sp."id" AND t."is_default" = true AND sp."slug" IS NULL;
