-- ===========================================================================
-- 20260917110000_books_series_integrity
--
-- Two integrity rules for multi-part book series (audit round 19, findings
-- B-Book1 and B-Book4). Additive only, every statement guarded -- safe to
-- re-run, and a no-op wherever the object already exists.
--
-- 1. chk_books_parts
--    Production has carried this CHECK since before the migration history
--    started, but no migration ever created it. So the same payload was a 500
--    in production and a 201 in dev / CI, and link-book-parts.ts only found
--    out by crashing into it. This brings every other database in line with
--    production, using production's exact definition (read from pg_constraint
--    on 2026-09-17): part_number and parts are both NULL or both set, and
--    part_number never exceeds parts.
--
--    Added NOT VALID on purpose: where the constraint is new (dev machines,
--    long-lived staging copies) existing rows are not re-checked, so a stray
--    legacy row cannot fail the deploy -- every INSERT/UPDATE from here on is
--    still enforced. Production is unaffected (the constraint already exists
--    there, fully validated). books.service.ts validates the same rule first
--    and answers 400 with a readable message.
--
-- 2. uq_books_parent_part_number
--    Two live parts of one series could share a part number, leaving the
--    parts list (ordered by part_number) in an arbitrary order. Partial:
--    only live rows that actually carry both values take part, so a trashed
--    part frees its number and unnumbered parts stay legal.
--
--    Pre-flight run against production on 2026-09-17 (read-only):
--      52 parts, all live, all numbered; 0 duplicate (parent_id, part_number)
--      groups, with or without trashed rows; 0 deleted parents with live
--      parts; 0 two-level chains.  ->  the index builds cleanly.
--
--    Re-check before deploying to any other long-lived database:
--      SELECT parent_id, part_number, count(*)
--      FROM books
--      WHERE parent_id IS NOT NULL AND part_number IS NOT NULL AND deleted_at IS NULL
--      GROUP BY 1, 2 HAVING count(*) > 1;
-- ===========================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_books_parts' AND conrelid = 'books'::regclass
  ) THEN
    ALTER TABLE "books"
      ADD CONSTRAINT "chk_books_parts" CHECK (
        ("part_number" IS NULL AND "parts" IS NULL)
        OR ("part_number" IS NOT NULL AND "parts" IS NOT NULL AND "part_number" <= "parts")
      ) NOT VALID;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "uq_books_parent_part_number"
  ON "books" ("parent_id", "part_number")
  WHERE "parent_id" IS NOT NULL AND "part_number" IS NOT NULL AND "deleted_at" IS NULL;
