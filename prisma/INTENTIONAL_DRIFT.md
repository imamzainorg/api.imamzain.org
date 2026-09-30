# Intentional schema drift

`prisma migrate diff` (see `.github/workflows/ci.yml`'s "Check schema.prisma
against applied migrations" step, and the local `npm run check:drift` script)
compares the database produced by `prisma/migrations/**` against
`prisma/schema.prisma`. Prisma's schema DSL cannot express **partial indexes**
(`CREATE INDEX ... WHERE ...`) or **CHECK constraints** at all, so every object
below exists only in raw migration SQL, on purpose, and can never be added to
schema.prisma.

In practice `prisma migrate diff` does not flag these as drift today — Prisma
can't represent them on either side of the comparison, so it treats both sides
as equal for these objects. This file exists as the fallback for the day that
stops being true (a Prisma upgrade, a different diff invocation, someone
runs `db pull` and it materializes a partial shadow of one of these): **check
here first** before assuming a reported diff is a real bug. If an object below
is what's being reported, it's expected. If the diff mentions something not in
this list, that's real drift — investigate it.

Whenever a migration adds one of these, add a row here in the same PR.

## Partial indexes (`CREATE [UNIQUE] INDEX ... WHERE ...`)

| Index | Table | Migration | Why it can't be in schema.prisma |
|---|---|---|---|
| `idx_posts_featured_public` | `posts` | `20260511150000_posts_featured` | Partial: `WHERE is_featured AND is_published AND deleted_at IS NULL` — Prisma `@@index` has no `WHERE` clause. |
| `idx_site_settings_public` | `site_settings` | `20260511100000_tier1_finale` | Partial: `WHERE is_public = true`. |
| `idx_newsletter_campaigns_scheduled` | `newsletter_campaigns` | `20260510120000_cms_extensions` | Partial: `WHERE status = 'scheduled'`. |
| `idx_ncr_pending` | `newsletter_campaign_recipients` | `20260510120000_cms_extensions` | Partial: `WHERE sent_at IS NULL AND failed_at IS NULL`. |
| `idx_static_pages_published` | `static_pages` | `20260528150000_static_pages_and_stores` | Partial: `WHERE deleted_at IS NULL AND is_published = true`. |
| `idx_posts_live_published_at` | `posts` | `20260528120000_perf_partial_indexes` | Partial: `WHERE deleted_at IS NULL`. |
| `idx_books_live_created_at` | `books` | `20260528120000_perf_partial_indexes` | Partial: `WHERE deleted_at IS NULL`. |
| `idx_academic_papers_live_created_at` | `academic_papers` | `20260528120000_perf_partial_indexes` | Partial: `WHERE deleted_at IS NULL`. |
| `idx_gallery_images_live_created_at` | `gallery_images` | `20260528120000_perf_partial_indexes` | Partial: `WHERE deleted_at IS NULL`. |
| `idx_contact_submissions_submitted_at` | `contact_submissions` | `20260528120000_perf_partial_indexes` | Partial: `WHERE deleted_at IS NULL`. |
| `idx_proxy_visit_requests_submitted_at` | `proxy_visit_requests` | `20260528120000_perf_partial_indexes` | Partial: `WHERE deleted_at IS NULL`. |
| `idx_contact_submissions_notif_failed` | `contact_submissions` | `20260528120000_perf_partial_indexes` | Partial: `WHERE deleted_at IS NULL AND notification_failed_at IS NOT NULL`. |
| `idx_proxy_visit_requests_notif_failed` | `proxy_visit_requests` | `20260528120000_perf_partial_indexes` | Partial: `WHERE deleted_at IS NULL AND notification_failed_at IS NOT NULL`. |
| `uq_audios_slug` | `audios` | `20260608120000_audios` | Partial unique: `WHERE slug IS NOT NULL` (optional editor slug — many NULLs must coexist). |
| `uniq_contest_attempts_phone` | `qutuf_sajjadiya_contest_attempts` | `20260525120000_contest_contact_unique` | Partial unique: `WHERE phone IS NOT NULL`. |
| `uniq_contest_attempts_email` | `qutuf_sajjadiya_contest_attempts` | `20260525120000_contest_contact_unique` | Partial unique: `WHERE email IS NOT NULL`. |
| `uq_posts_slug` | `posts` | `20260819100000_content_slug_phase_b_unique` | Partial unique: `WHERE slug IS NOT NULL`. |
| `uq_books_slug` | `books` | `20260819100000_content_slug_phase_b_unique` | Partial unique: `WHERE slug IS NOT NULL`. |
| `uq_static_pages_slug` | `static_pages` | `20260819100000_content_slug_phase_b_unique` | Partial unique: `WHERE slug IS NOT NULL`. |
| `daily_hadiths_display_date_key` | `daily_hadiths` | `20260906120000_hadith_display_date` | Partial unique: `WHERE display_date IS NOT NULL AND deleted_at IS NULL`. |
| `uq_books_parent_part_number` | `books` | `20260917110000_books_series_integrity` | Partial unique: `WHERE parent_id IS NOT NULL AND part_number IS NOT NULL AND deleted_at IS NULL` — see the comment on `books.part_number` in schema.prisma. |
| `idx_newsletter_recipients_pending` | `newsletter_campaign_recipients` | `20260917130000_newsletter_delivery_and_double_opt_in` | Partial: `WHERE sent_at IS NULL AND failed_at IS NULL`. |
| `idx_newsletter_recipients_sent_at` | `newsletter_campaign_recipients` | `20260917130000_newsletter_delivery_and_double_opt_in` | Partial: `WHERE sent_at IS NOT NULL`. |
| `idx_newsletter_subscribers_confirmation_sent` | `newsletter_subscribers` | `20260917130000_newsletter_delivery_and_double_opt_in` | Partial: `WHERE confirmation_sent_at IS NOT NULL`. |
| `idx_contact_pending_notification` | `contact_submissions` | `20260917120000_form_notification_outbox` | Partial: `WHERE notified_at IS NULL AND deleted_at IS NULL`. |
| `idx_proxy_visit_pending_notification` | `proxy_visit_requests` | `20260917120000_form_notification_outbox` | Partial: `WHERE notified_at IS NULL AND deleted_at IS NULL`. |

## CHECK constraints (`ADD CONSTRAINT ... CHECK (...)`)

| Constraint | Table | Migration | Why it can't be in schema.prisma |
|---|---|---|---|
| `academic_paper_translations_page_count_check` | `academic_paper_translations` | `00000000000000_baseline` | `CHECK (page_count > 0)` — Prisma DSL has no CHECK support. |
| `books_pages_check` | `books` | `00000000000000_baseline` | `CHECK (pages > 0)`. |
| `books_part_number_check` | `books` | `00000000000000_baseline` | `CHECK (part_number > 0)`. |
| `books_parts_check` | `books` | `00000000000000_baseline` | `CHECK (parts > 0)`. |
| `books_views_check` | `books` | `00000000000000_baseline` | `CHECK (views >= 0)`. |
| `books_parent_id_not_self_check` | `books` | `20260908120000_book_parts_and_publication_flag` | `CHECK (parent_id IS NULL OR parent_id != id)` — a book can't be its own series parent. |
| `chk_books_parts` | `books` | `20260917110000_books_series_integrity` | `CHECK` (both `part_number`/`parts` NULL, or both set with `part_number <= parts`) — mirrored in `books.service.ts` for a readable 400; see the comment on `books.part_number` in schema.prisma. Added `NOT VALID`. |
| `contact_submissions_country_check` | `contact_submissions` | `00000000000000_baseline` | `CHECK (country ~ '^[A-Z]{2}$')` — regex CHECK. |
| `media_mime_type_check` | `media` | `00000000000000_baseline` | `CHECK (mime_type LIKE 'image/%')`. |
| `media_file_size_check` | `media` | `00000000000000_baseline` | `CHECK (file_size > 0)`. |
| `media_width_check` | `media` | `00000000000000_baseline` | `CHECK (width > 0)`. |
| `media_height_check` | `media` | `00000000000000_baseline` | `CHECK (height > 0)`. |
| `posts_views_check` | `posts` | `00000000000000_baseline` | `CHECK (views >= 0)`. |
| `academic_papers_views_check` | `academic_papers` | `20260818135000_add_view_counters` | `CHECK (views >= 0)`. |
| `audios_views_check` | `audios` | `20260818135000_add_view_counters` | `CHECK (views >= 0)`. |
| `gallery_images_views_check` | `gallery_images` | `20260818135000_add_view_counters` | `CHECK (views >= 0)`. |
| `proxy_visit_requests_phone_check` | `proxy_visit_requests` | `00000000000000_baseline` | `CHECK (phone ~ '^\+[1-9]\d{1,14}$')` — E.164 regex CHECK. |
| `proxy_visit_requests_country_check` | `proxy_visit_requests` | `00000000000000_baseline` | `CHECK (country ~ '^[A-Z]{2}$')`. |
| `qutuf_sajjadiya_contest_answers_selected_check` | `qutuf_sajjadiya_contest_answers` | `00000000000000_baseline` | `CHECK (selected = ANY (ARRAY['A','B','C','D']))`. |
| `chk_newsletter_subscriber_active` | `newsletter_subscribers` | `20260917130000_newsletter_delivery_and_double_opt_in` | `CHECK (NOT is_active OR (unsubscribed_at IS NULL AND deleted_at IS NULL))` — replaced the untracked `chk_subscriber_state`; see the comment on `newsletter_subscribers.confirmed_at` in schema.prisma. Added `NOT VALID`. |

Note: several of the tables above already carry Prisma's own
`/// This table contains check constraints and requires additional setup for
migrations.` comment, auto-generated the last time someone ran `prisma db
pull` against a database that had these CHECKs. That comment is a symptom of
the same limitation this file documents — it does not enumerate which
constraints, hence this file.
