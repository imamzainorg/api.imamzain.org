-- ===========================================================================
-- CMS extensions: newsletter campaigns + media variants
-- ===========================================================================
-- Apply with:
--   psql "$DIRECT_URL" -f prisma/migrations/20260510120000_cms_extensions/migration.sql
-- Then run:
--   npm run prisma:pull && npm run prisma:generate
--
-- The migration is idempotent — re-running is a no-op (CREATE ... IF NOT EXISTS
-- + DO blocks for enums). Safe to apply via psql; no Prisma Migrate involvement.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. Newsletter campaigns
-- ---------------------------------------------------------------------------
-- Editor-composed messages sent to all (or a filtered subset of) active
-- subscribers. Workflow: editor publishes a post / book / contest -> CMS
-- prompts to send a newsletter -> editor reviews auto-generated draft ->
-- sends. Status transitions: draft -> scheduled? -> sending -> sent | failed.
--
-- NOTE on SMTP: the API currently ships with Hostinger SMTP, which has
-- per-connection sending limits (typically ~100/hour, ~300/day). For lists
-- larger than a few hundred subscribers, the campaign sender will need to
-- either (a) batch sends with sleeps between batches, or (b) be migrated to
-- a transactional ESP (Resend / Brevo / Mailgun) keeping info@imamzain.org
-- as the From address. Today the list is small, so batching is sufficient.
-- ---------------------------------------------------------------------------

DO $$ BEGIN
  CREATE TYPE newsletter_campaign_status AS ENUM (
    'draft',
    'scheduled',
    'sending',
    'sent',
    'failed',
    'cancelled'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


CREATE TABLE IF NOT EXISTS newsletter_campaigns (
  id                    uuid                       PRIMARY KEY DEFAULT gen_random_uuid(),
  subject               text                       NOT NULL,
  body_html             text                       NOT NULL,
  status                newsletter_campaign_status NOT NULL DEFAULT 'draft',
  scheduled_at          timestamptz                NULL,
  sent_at               timestamptz                NULL,
  recipient_count       integer                    NULL,
  delivered_count       integer                    NOT NULL DEFAULT 0,
  failed_count          integer                    NOT NULL DEFAULT 0,
  -- Optional link back to the source content that triggered the campaign
  -- (resource_type matches the existing audit_logs.resource_type values:
  -- 'post', 'book', 'academic_paper', etc.).
  source_resource_type  text                       NULL,
  source_resource_id    uuid                       NULL,
  created_by            uuid                       NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at            timestamptz                NOT NULL DEFAULT now(),
  updated_at            timestamptz                NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_newsletter_campaigns_status
  ON newsletter_campaigns(status);

CREATE INDEX IF NOT EXISTS idx_newsletter_campaigns_scheduled
  ON newsletter_campaigns(scheduled_at)
  WHERE status = 'scheduled';

CREATE INDEX IF NOT EXISTS idx_newsletter_campaigns_created_at
  ON newsletter_campaigns(created_at DESC);


-- Per-recipient tracking lets us:
--   - resume after a partial-failure batch
--   - avoid double-sending if SMTP retries
--   - render an editor-facing delivery report ("247/250 delivered, 3 bounced")
CREATE TABLE IF NOT EXISTS newsletter_campaign_recipients (
  campaign_id    uuid        NOT NULL REFERENCES newsletter_campaigns(id) ON DELETE CASCADE,
  subscriber_id  uuid        NOT NULL REFERENCES newsletter_subscribers(id) ON DELETE CASCADE,
  sent_at        timestamptz NULL,
  failed_at      timestamptz NULL,
  error_message  text        NULL,
  PRIMARY KEY (campaign_id, subscriber_id)
);

CREATE INDEX IF NOT EXISTS idx_ncr_pending
  ON newsletter_campaign_recipients(campaign_id)
  WHERE sent_at IS NULL AND failed_at IS NULL;


-- ---------------------------------------------------------------------------
-- 2. Media variants
-- ---------------------------------------------------------------------------
-- Pre-generated resized copies of an uploaded image. Generated once at
-- confirmUpload time using sharp; stored as separate R2 objects under
--   media/variants/<media_id>/w<width>.webp
-- This lets the public site serve responsive images without paying for
-- Cloudflare Image Resizing transforms (the free tier is 5000 unique
-- transforms/month and standardised pre-generated variants stay at $0).
--
-- Sizes: 320 (mobile thumb), 768 (tablet), 1280 (desktop), 1920 (hero).
-- Format: webp for all variants. The original keeps its uploaded format.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS media_variants (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  media_id    uuid        NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  width       integer     NOT NULL,
  url         text        NOT NULL,
  file_size   bigint      NOT NULL,
  format      text        NOT NULL DEFAULT 'webp',
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (media_id, width)
);

CREATE INDEX IF NOT EXISTS idx_media_variants_media_id
  ON media_variants(media_id);
