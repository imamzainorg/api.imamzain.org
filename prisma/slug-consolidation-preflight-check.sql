-- Pre-flight diagnostic for Phase B of the content-slug consolidation.
-- READ-ONLY — safe to run against production any time, including before
-- Phase A. Answers two questions Phase B's global UNIQUE constraint needs
-- answered first:
--
--   1. Cross-language collisions: the OLD constraint was unique per
--      (lang, slug) — so post A's Arabic default slug "welcome" and post
--      B's English default slug "welcome" were both allowed. The NEW
--      spine-level constraint is global. If any such pair exists, Phase B's
--      CREATE UNIQUE INDEX will fail (safely, no partial state) until it's
--      resolved by hand.
--   2. Rows with no default translation: the "exactly one is_default=true
--      row" rule is enforced only in application code (assertExactlyOneDefault
--      in src/common/utils/translation.util.ts), not by a DB constraint —
--      so it's possible for legacy/imported data to violate it. Any such
--      row's spine `slug` stayed NULL after Phase A's backfill. For posts
--      and static_pages (slug currently required at the translation level),
--      a non-empty result here means Phase C's `SET NOT NULL` would fail.
--
-- Run this AFTER Phase A (20260818130000) has been applied. Every query
-- below should return zero rows for Phase B to be safe to write.

-- 1a. Cross-language slug collisions, per resource type.
SELECT 'posts' AS resource, slug, COUNT(*) AS colliding_rows
FROM posts
WHERE slug IS NOT NULL AND deleted_at IS NULL
GROUP BY slug
HAVING COUNT(*) > 1

UNION ALL

SELECT 'books', slug, COUNT(*)
FROM books
WHERE slug IS NOT NULL AND deleted_at IS NULL
GROUP BY slug
HAVING COUNT(*) > 1

UNION ALL

SELECT 'static_pages', slug, COUNT(*)
FROM static_pages
WHERE slug IS NOT NULL AND deleted_at IS NULL
GROUP BY slug
HAVING COUNT(*) > 1;

-- 1b. Same check including soft-deleted rows (matters because the delete/
-- restore suffix trick only frees a slug once a row is actually trashed —
-- a live row and a soft-deleted-but-not-yet-suffixed row could still clash
-- if Phase A's backfill ran before any suffixing logic existed for the
-- spine column). Informational — a non-zero result here is lower urgency
-- than 1a since these rows aren't both publicly reachable at once.
SELECT 'posts (incl. trash)' AS resource, slug, COUNT(*) AS colliding_rows
FROM posts
WHERE slug IS NOT NULL
GROUP BY slug
HAVING COUNT(*) > 1;

-- 2. Rows that came out of Phase A's backfill with a NULL slug — meaning
-- either no is_default=true translation exists, or (for books/papers only)
-- the default translation itself has a NULL slug.
SELECT 'posts: missing default-translation slug' AS issue, COUNT(*) AS row_count
FROM posts WHERE slug IS NULL AND deleted_at IS NULL
UNION ALL
SELECT 'static_pages: missing default-translation slug', COUNT(*)
FROM static_pages WHERE slug IS NULL AND deleted_at IS NULL;
-- (books is expected to have some NULLs — slug is optional there today,
-- same as after the migration. Not a failure signal.)
