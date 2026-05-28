-- Performance audit follow-up: partial indexes for soft-delete-filtered list
-- queries, and submitted_at indexes for forms list / dashboard time-window
-- filters. CONCURRENTLY would be nicer in production but Prisma's migration
-- runner wraps statements in a transaction, which forbids it. The tables
-- here are small enough that the brief lock is acceptable on every env we
-- target; switch to a manual `psql` step if a production rollout proves
-- otherwise.

-- ── Partial indexes for "is live" list queries (deleted_at IS NULL) ───────
-- The existing idx_posts_published(is_published, published_at) does not
-- include deleted_at, so the planner has to filter after the index scan.
CREATE INDEX IF NOT EXISTS idx_posts_live_published_at
  ON posts (published_at DESC, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_books_live_created_at
  ON books (created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_academic_papers_live_created_at
  ON academic_papers (created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_gallery_images_live_created_at
  ON gallery_images (created_at DESC)
  WHERE deleted_at IS NULL;

-- ── submitted_at ordering for forms list endpoints + dashboard windows ───
CREATE INDEX IF NOT EXISTS idx_contact_submissions_submitted_at
  ON contact_submissions (submitted_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_proxy_visit_requests_submitted_at
  ON proxy_visit_requests (submitted_at DESC)
  WHERE deleted_at IS NULL;

-- ── notification_failed_at dashboard predicate ───────────────────────────
-- "unsent_notifications" pulls rows where notification_failed_at IS NOT NULL.
-- The predicate is sparse (the failure path is rare), so a partial index
-- keeps the index tiny and the dashboard count effectively O(1).
CREATE INDEX IF NOT EXISTS idx_contact_submissions_notif_failed
  ON contact_submissions (notification_failed_at)
  WHERE deleted_at IS NULL AND notification_failed_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_proxy_visit_requests_notif_failed
  ON proxy_visit_requests (notification_failed_at)
  WHERE deleted_at IS NULL AND notification_failed_at IS NOT NULL;
