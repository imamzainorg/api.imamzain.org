-- ===========================================================================
-- 20260917130000_newsletter_delivery_and_double_opt_in
--
-- Schema for two newsletter changes from audit round 19. No column or table is
-- dropped and no existing value is rewritten except the backfill described
-- below. Every statement is guarded -- safe to re-run.
--
-- A. Campaign delivery that survives real SMTP (S10, B-News1..3)
--    newsletter_campaign_recipients gains
--      attempts       how many sends were tried for this recipient
--      next_retry_at  when a transiently-failed recipient may be tried again
--                     (back-off); NULL = eligible now
--      claimed_until  short lease taken right before the SMTP call, so two
--                     workers can never mail the same row and a crash frees
--                     the row again after a few minutes
--    newsletter_campaigns gains
--      paused_until   set by the sender's circuit breaker when SMTP looks down
--                     or over quota -- the campaign is skipped until then
--      last_error     why (shown in the CMS)
--
-- B. Double opt-in (S9, B-News5, B-News7)
--    newsletter_subscribers gains
--      confirmed_at          when the CURRENT consent was given (the click on
--                            the confirmation link); re-stamped on re-confirm
--      confirmation_sent_at  last time a confirmation e-mail was claimed
--    Backfill: every subscriber that exists when this runs is grandfathered
--    with confirmed_at = subscribed_at -- they joined under single opt-in and
--    must keep receiving mail. The backfill sits inside the "column did not
--    exist yet" branch so that a re-run can never confirm a pending signup.
--
-- C. chk_subscriber_state  ->  chk_newsletter_subscriber_active
--    Production carries a CHECK that no migration ever created (read from
--    pg_constraint on 2026-09-17):
--        (is_active AND unsubscribed_at IS NULL)
--     OR (NOT is_active AND unsubscribed_at IS NOT NULL)
--    It was already wrong for the code on main: deleting an ACTIVE subscriber
--    sets is_active = false and leaves unsubscribed_at NULL, which this CHECK
--    rejects -- so DELETE /newsletter/subscribers/:id fails in production for
--    exactly the rows it is most used on, while passing in dev and CI (which
--    never had the constraint). It also has no room for a signup that is not
--    confirmed yet (inactive, never unsubscribed).
--
--    Replaced by the invariant that actually matters, and that every database
--    now shares:  an ACTIVE subscriber is neither unsubscribed nor deleted.
--        NOT is_active OR (unsubscribed_at IS NULL AND deleted_at IS NULL)
--    Deliberately does NOT require confirmed_at: during a deploy the previous
--    release keeps inserting is_active = true rows for a few minutes after
--    this migration has run, and those inserts must not start failing.
--
--    This only RELAXES what is accepted; no existing row can violate it
--    (production: 1 subscriber, active, never unsubscribed, not deleted).
--    Added NOT VALID so an odd legacy row in some other long-lived database
--    cannot fail the deploy -- new writes are enforced everywhere regardless.
-- ===========================================================================

-- A ---------------------------------------------------------------------------
ALTER TABLE "newsletter_campaign_recipients" ADD COLUMN IF NOT EXISTS "attempts" integer NOT NULL DEFAULT 0;
ALTER TABLE "newsletter_campaign_recipients" ADD COLUMN IF NOT EXISTS "next_retry_at" timestamptz(6);
ALTER TABLE "newsletter_campaign_recipients" ADD COLUMN IF NOT EXISTS "claimed_until" timestamptz(6);

ALTER TABLE "newsletter_campaigns" ADD COLUMN IF NOT EXISTS "paused_until" timestamptz(6);
ALTER TABLE "newsletter_campaigns" ADD COLUMN IF NOT EXISTS "last_error" text;

-- The sender's scan: pending rows of one campaign, soonest-eligible first.
CREATE INDEX IF NOT EXISTS "idx_newsletter_recipients_pending"
  ON "newsletter_campaign_recipients" ("campaign_id", "next_retry_at")
  WHERE "sent_at" IS NULL AND "failed_at" IS NULL;

-- The rolling-hour budget: "how many went out in the last 60 minutes".
CREATE INDEX IF NOT EXISTS "idx_newsletter_recipients_sent_at"
  ON "newsletter_campaign_recipients" ("sent_at")
  WHERE "sent_at" IS NOT NULL;

-- B ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'newsletter_subscribers' AND column_name = 'confirmed_at'
  ) THEN
    ALTER TABLE "newsletter_subscribers" ADD COLUMN "confirmed_at" timestamptz(6);
    UPDATE "newsletter_subscribers" SET "confirmed_at" = "subscribed_at";
  END IF;
END $$;

ALTER TABLE "newsletter_subscribers" ADD COLUMN IF NOT EXISTS "confirmation_sent_at" timestamptz(6);

-- The confirmation-mail hourly cap counts recent claims.
CREATE INDEX IF NOT EXISTS "idx_newsletter_subscribers_confirmation_sent"
  ON "newsletter_subscribers" ("confirmation_sent_at")
  WHERE "confirmation_sent_at" IS NOT NULL;

-- C ---------------------------------------------------------------------------
ALTER TABLE "newsletter_subscribers" DROP CONSTRAINT IF EXISTS "chk_subscriber_state";

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_newsletter_subscriber_active' AND conrelid = 'newsletter_subscribers'::regclass
  ) THEN
    ALTER TABLE "newsletter_subscribers"
      ADD CONSTRAINT "chk_newsletter_subscriber_active" CHECK (
        NOT "is_active" OR ("unsubscribed_at" IS NULL AND "deleted_at" IS NULL)
      ) NOT VALID;
  END IF;
END $$;
