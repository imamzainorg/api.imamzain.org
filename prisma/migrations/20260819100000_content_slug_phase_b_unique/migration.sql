-- Content-slug consolidation — PHASE B of 3 (constraint only, still additive/safe).
--
-- Adds the global uniqueness rule to the spine-level `slug` column that
-- Phase A (migration 20260818130000) added but deliberately left
-- unconstrained. The pre-flight collision check
-- (prisma/slug-consolidation-preflight-check.sql) confirmed zero
-- cross-language collisions and zero missing defaults for posts/books/
-- static_pages as of 2026-08-18; re-run it again immediately before
-- applying this to production, since content may have changed since.
--
-- Mirrors uq_audios_slug (migration 20260608120000) exactly: a partial
-- unique index, not a plain unique constraint, so a soft-deleted row's
-- suffixed slug never collides with a live row's slug, and NULL slugs
-- (books only) don't collide with each other either.
--
-- Application code still reads/writes the OLD translation-level slug
-- until Phase C's code cutover ships alongside this — this migration by
-- itself only adds a DB-level safety net; it does not change app
-- behaviour on its own.
--
-- Additive only — safe to deploy alone. Re-running is a no-op
-- (IF NOT EXISTS guarded).

CREATE UNIQUE INDEX IF NOT EXISTS uq_posts_slug ON posts (slug) WHERE slug IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_books_slug ON books (slug) WHERE slug IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_static_pages_slug ON static_pages (slug) WHERE slug IS NOT NULL;
