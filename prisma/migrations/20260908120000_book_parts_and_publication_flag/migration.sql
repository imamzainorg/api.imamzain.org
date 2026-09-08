-- Multi-part book series + the institution's cross-cutting "الإصدارات"
-- (Publications) flag. Additive only — no existing column touched, no data
-- rewritten. Safe to re-run (every statement is guarded).
--
-- 1. parent_id: self-reference on "books". NULL for a normal standalone
--    book. When set, this row is one part of the series whose "cover"
--    record (title/author/category/cover image, no PDF of its own) is the
--    parent. One level deep only — a part can never itself be a parent;
--    that invariant is enforced in books.service.ts, not here, because a
--    CHECK constraint can't see sibling rows.
--
-- 2. is_publication: the legacy source data lets one book carry BOTH a
--    topical category ("الصحيفة السجادية", "رسالة الحقوق", …) and
--    "الإصدارات" — the institution's flagship-Publications list. The
--    existing schema only has room for ONE category_id, so the original
--    seed silently kept whichever category came first and dropped
--    "الإصدارات" whenever it wasn't. This flag decouples "is this one of
--    our Publications" from "what topic is it filed under" so both survive.

ALTER TABLE "books" ADD COLUMN IF NOT EXISTS "parent_id" UUID;
ALTER TABLE "books" ADD COLUMN IF NOT EXISTS "is_publication" BOOLEAN NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'books_parent_id_fkey'
  ) THEN
    ALTER TABLE "books"
      ADD CONSTRAINT "books_parent_id_fkey"
      FOREIGN KEY ("parent_id") REFERENCES "books"("id")
      ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'books_parent_id_not_self_check'
  ) THEN
    ALTER TABLE "books"
      ADD CONSTRAINT "books_parent_id_not_self_check" CHECK ("parent_id" IS NULL OR "parent_id" != "id");
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "idx_books_parent_id" ON "books"("parent_id");
CREATE INDEX IF NOT EXISTS "idx_books_is_publication" ON "books"("is_publication");
