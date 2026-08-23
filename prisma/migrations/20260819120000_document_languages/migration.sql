-- Content-language tagging for books and academic papers.
--
-- `books.language` / the per-paper `language` field in journals.json and
-- student.json answer "what language is the actual PDF/book written in" —
-- a different question from `*_translations.lang`, which answers "what
-- language is THIS title/summary text written in" (a Persian paper can
-- still carry an Arabic title row for the Arabic UI). Both source JSON
-- exports already carry this per-item, it was just never seeded.
--
-- Array, not a single value: books.json already expresses it as an array
-- (a bilingual Arabic/English edition is a real thing in this library),
-- and there is no reason academic_papers should be more restrictive.
--
-- Additive only — no existing column touched. Re-running is safe.

ALTER TABLE "books" ADD COLUMN IF NOT EXISTS "document_languages" TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE "academic_papers" ADD COLUMN IF NOT EXISTS "document_languages" TEXT[] NOT NULL DEFAULT '{}';
