-- ===========================================================================
-- 20260526120000_form_notification_failed_at
--
-- Adds notification_failed_at to contact_submissions and proxy_visit_requests
-- so the API can surface failed admin-notification emails on the dashboard.
--
-- Previously the FormsService swallowed EmailService failures with only a
-- logger.warn, which meant a stale SMTP configuration silently dropped every
-- contact form submission email until somebody noticed via Hostinger /
-- Sentry. With this column, /dashboard/stats can return a count of forms
-- with a failed notification, and on-call has something to alert on.
--
-- Re-runnable: IF NOT EXISTS guards on both columns.
-- ===========================================================================

ALTER TABLE contact_submissions
  ADD COLUMN IF NOT EXISTS notification_failed_at TIMESTAMPTZ NULL;

ALTER TABLE proxy_visit_requests
  ADD COLUMN IF NOT EXISTS notification_failed_at TIMESTAMPTZ NULL;
