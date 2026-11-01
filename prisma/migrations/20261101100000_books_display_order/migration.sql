-- ===========================================================================
-- 20261101100000_books_display_order
--
-- Additive. A manual position for each book, set from the CMS
-- (PUT /api/v1/books/admin/order). Ascending; 0 means "not placed yet", and
-- books with the same value fall back to newest first, so every existing book
-- keeps today's order until someone reorders the list.
--
-- The DEFAULT makes this a metadata-only change on Postgres 11+. Safe to apply
-- before the Worker that reads the column is deployed: the old Worker never
-- selects it.
-- ===========================================================================

ALTER TABLE books ADD COLUMN display_order integer NOT NULL DEFAULT 0;
