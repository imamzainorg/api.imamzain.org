-- ===========================================================================
-- 20260917120000_form_notification_outbox
--
-- Admin notifications for the two public forms move from "one e-mail per
-- submission, fired inline" to an outbox drained by a cron (audit round 19,
-- finding S2). Inline sending let anyone turn the contact / proxy-visit forms
-- into an SMTP-quota burner: N submissions = N e-mails from the one shared
-- mailbox, which then also fails whatever newsletter campaign is in flight.
-- It was also fire-and-forget: a restart between the INSERT and the send lost
-- the notification for good.
--
-- notified_at records when the admin team was told about a row. NULL means
-- "still waiting": src/forms/form-notifications.service.ts picks those up,
-- sends ONE digest for however many are pending (at most one e-mail per
-- cool-down window) and stamps them. A failed send leaves them pending, so
-- they are retried instead of being lost.
--
-- Backfill: every row that exists when this migration runs is stamped
-- notified_at = submitted_at. Without that, the first tick after deploy would
-- mail a digest of the entire submission history. The backfill sits inside the
-- "column did not exist yet" branch on purpose: re-running the migration must
-- never mark genuinely pending rows as handled.
--
-- NOTE for operators -- production, 2026-09-17 (read-only check): 20 of 20
-- contact submissions and 87 of 91 proxy-visit requests carry
-- notification_failed_at, i.e. these notifications have essentially never been
-- delivered. Those historical rows are NOT re-sent by this change; review them
-- in the CMS, and check the SMTP_* settings on the host.
--
-- Additive only. Safe to re-run.
-- ===========================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'contact_submissions' AND column_name = 'notified_at'
  ) THEN
    ALTER TABLE "contact_submissions" ADD COLUMN "notified_at" timestamptz(6);
    UPDATE "contact_submissions" SET "notified_at" = "submitted_at";
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'proxy_visit_requests' AND column_name = 'notified_at'
  ) THEN
    ALTER TABLE "proxy_visit_requests" ADD COLUMN "notified_at" timestamptz(6);
    UPDATE "proxy_visit_requests" SET "notified_at" = "submitted_at";
  END IF;
END $$;

-- The outbox scan: a handful of pending rows out of a growing history.
CREATE INDEX IF NOT EXISTS "idx_contact_pending_notification"
  ON "contact_submissions" ("submitted_at")
  WHERE "notified_at" IS NULL AND "deleted_at" IS NULL;

CREATE INDEX IF NOT EXISTS "idx_proxy_visit_pending_notification"
  ON "proxy_visit_requests" ("submitted_at")
  WHERE "notified_at" IS NULL AND "deleted_at" IS NULL;
