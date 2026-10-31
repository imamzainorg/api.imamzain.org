-- ===========================================================================
-- 20261031100000_books_pdf_access
--
-- Additive. Who may download a book's PDF: 'public' (everyone, the behaviour
-- every existing book keeps) or 'app' (only callers that send the mobile app's
-- key, see worker/src/lib/app-client.ts). Only meaningful while pdf_url is set.
--
-- The DEFAULT makes this a metadata-only change on Postgres 11+, and the CHECK
-- scans a table of a few hundred rows. Safe to apply before the Worker that
-- reads the column is deployed: the old Worker never selects it.
-- ===========================================================================

ALTER TABLE books ADD COLUMN pdf_access text NOT NULL DEFAULT 'public';

ALTER TABLE books
  ADD CONSTRAINT chk_books_pdf_access CHECK (pdf_access IN ('public', 'app'));
