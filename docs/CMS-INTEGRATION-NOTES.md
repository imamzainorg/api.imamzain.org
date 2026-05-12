# CMS & Main-Site Integration Notes

> **Note on scope.** This document is the **chronological release notes**
> for the API — round-by-round summaries of what changed and when. For
> ongoing reference, use:
>
> - **[/docs](https://api.imamzain.org/docs)** — interactive OpenAPI / Scalar UI, per-endpoint reference.
> - **[integration.md](integration.md)** — cross-cutting integration handbook (auth flow, envelopes, pagination, language resolution, media upload, sanitisation allowlist, rate limits, URL conventions, cron schedules).
> - **[permissions.md](permissions.md)** — permission catalogue, default role mappings, audit-action vocabulary.
>
> If you're integrating from scratch, start with `integration.md`. If
> you're catching up on what shipped recently, read this file from the
> top.

---

## 1. Schema migration to apply first

Before running the API against production, apply:

```text
prisma/migrations/20260510120000_cms_extensions/migration.sql
```

The migration adds three tables (none of the CMS code paths break before
applying — they just don't have anywhere to write):

| Table | Purpose |
| --- | --- |
| `newsletter_campaigns` | Editor-composed broadcasts to active subscribers |
| `newsletter_campaign_recipients` | Per-subscriber delivery tracking |
| `media_variants` | Pre-generated WebP sizes per uploaded image |

Apply with:

```bash
psql "$DIRECT_URL" -f prisma/migrations/20260510120000_cms_extensions/migration.sql
npm run prisma:pull
npm run prisma:generate
```

The generated client gains the new typed models on step 3. The migration is
idempotent — re-running is a no-op.

---

## 2. Media variants — public-site impact

### What changed

`POST /media/confirm` now triggers a synchronous sharp pipeline that:

- Reads the original out of R2.
- Generates WebP variants at standard widths: **320, 768, 1280, 1920 px**.
- Skips widths that would up-scale (a 480 px source returns at most one
  variant, the 320 px one).
- Uploads each to `media/variants/<media_id>/w<width>.webp`.
- Inserts `media_variants` rows for each successful one.

Generation happens during the upload request (typically 1–3 s for normal
CMS uploads using `Promise.all` parallelism). Failures are isolated — the
media row still succeeds and the editor can call
`POST /media/:id/regenerate-variants` later.

### New response shape

Every endpoint that returns a media object — `confirmUpload`, `findOne`,
`findAll`, `regenerateVariants` — now includes a `variants[]` array:

```jsonc
{
  "id": "9c8d…",
  "url": "https://cdn.imamzain.org/media/9c8d-photo.jpg",
  "filename": "photo.jpg",
  "alt_text": "صورة توضيحية",
  "mime_type": "image/jpeg",
  "file_size": 482103,
  "width": 2400,
  "height": 1800,
  "variants": [
    { "width": 320,  "url": "https://cdn.imamzain.org/media/variants/9c8d/w320.webp",  "file_size": 18432, "format": "webp" },
    { "width": 768,  "url": "https://cdn.imamzain.org/media/variants/9c8d/w768.webp",  "file_size": 64210, "format": "webp" },
    { "width": 1280, "url": "https://cdn.imamzain.org/media/variants/9c8d/w1280.webp", "file_size": 142933, "format": "webp" },
    { "width": 1920, "url": "https://cdn.imamzain.org/media/variants/9c8d/w1920.webp", "file_size": 268431, "format": "webp" }
  ]
}
```

### Public site — recommended usage

Use `<img srcset>` with the variants array. Fall back to the original `url`
when no variant of the right size exists:

```tsx
function ResponsiveImage({ media, sizes = "100vw", className }: Props) {
  const variants = media.variants ?? [];
  if (variants.length === 0) {
    return <img src={media.url} alt={media.alt_text ?? ""} className={className} loading="lazy" />;
  }
  const srcSet = variants.map(v => `${v.url} ${v.width}w`).join(", ");
  // Pick the largest variant <= the layout size as the fallback src.
  const largest = variants[variants.length - 1].url;
  return (
    <img
      src={largest}
      srcSet={srcSet}
      sizes={sizes}
      alt={media.alt_text ?? ""}
      className={className}
      loading="lazy"
      decoding="async"
    />
  );
}
```

### CMS — recommended usage

- After `POST /media/confirm`, the response already contains `variants`.
  No follow-up call needed.
- If `variants` is empty (sharp failed mid-upload — e.g. corrupt image,
  timeout), surface a "Regenerate variants" button on the media detail
  page that calls `POST /media/:id/regenerate-variants`.
- Don't show the per-variant sizes in the editor UI — they're an
  implementation detail. Only show the original.

### What you DON'T need to do

- No client-side resizing.
- No `?w=…` query parameters.
- No Cloudflare Image Resizing transforms.

---

## 3. HTML sanitisation on `posts.translations[].body`

### What sanitisation does

The API now sanitises the `body` field on `POST /posts` and
`PATCH /posts/:id` server-side before storing it. The allowlist mirrors the
Tiptap StarterKit schema (`p`, `h1-6`, `ul / ol / li`, `blockquote`,
`pre / code`, `strong / em / u / s / sub / sup / mark`, `a`, `img`,
`table` family, `span`, `div`).

URL schemes are restricted: `http`, `https`, `mailto`, `tel` for `href`;
`http`, `https`, `data` for `<img src>`. `style` attributes are stripped.
Inline event handlers (`onclick`, etc.) are stripped. `target="_blank"`
links automatically gain `rel="noopener noreferrer"`.

The body field also enforces a 200 KB UTF-8 byte cap (matches the CMS's
`MAX_BODY_BYTES`).

### CMS — what you should still do

Keep the existing client-side `sanitizeEditorHtml` and `byteLength` checks
in the editor. The server-side pass is **defence-in-depth** — it does not
replace the client-side editor schema, which still gives users feedback as
they type.

### Public site — what you should know

You can render `post.translation.body` via `dangerouslySetInnerHTML` (or
the framework equivalent) without further sanitisation. It's been through:

1. Tiptap's parser (CMS editor).
2. The CMS's URL/event-handler regex strip (`sanitizeEditorHtml`).
3. The API's `sanitize-html` allowlist (server-side).

If you want to keep your renderer paranoid (good practice), `sanitize-html`
or DOMPurify on the server-rendered output is fine. It just won't find
anything to remove on normal data.

### Stored data note

Posts created **before** this change were stored without server-side
sanitisation. The data is fine if the only content source has been the
CMS, but if you want to backfill: write a one-shot script that loads each
`post_translations.body`, runs it through `sanitizeEditorHtml`, and
updates if it differs. The CMS team can run this against staging first.

---

## 4. Newsletter campaigns (table only — endpoints not yet implemented)

### What's in the migration

Two tables — `newsletter_campaigns` and `newsletter_campaign_recipients` —
ready for a campaign-sending feature. **No API endpoints exist yet.**

### Suggested workflow when endpoints are added (Option B from the design discussion)

1. Editor publishes a post / book / contest.
2. CMS prompts: *"Send a newsletter about this? [Compose]"*.
3. CMS calls `POST /newsletter/campaigns` with a draft `subject` /
   `body_html` (pre-filled from a template) and an optional
   `source_resource_type` / `source_resource_id` linking back to the
   triggering content.
4. Editor reviews / edits / hits send.
5. CMS calls `POST /newsletter/campaigns/:id/send` (immediate) or
   `POST /newsletter/campaigns/:id/schedule` (with `scheduled_at`).
6. The API enqueues `newsletter_campaign_recipients` rows for every active
   subscriber and processes them in batches.

### Why per-recipient rows

`newsletter_campaign_recipients` lets the sender:

- Resume a partially-sent batch after a crash without double-sending.
- Track per-recipient `sent_at` / `failed_at` / `error_message`.
- Render an editor-facing "247/250 delivered, 3 bounced" report.

### SMTP capacity caveat

The current SMTP path (`info@imamzain.org` via Hostinger) has per-account
sending limits, typically ~100/hr or ~300/day. As long as the active
subscriber count stays in the low hundreds, batching with sleeps is
sufficient. If the list grows, migrate to Resend / Brevo / Mailgun keeping
`info@imamzain.org` as the From — none of the campaign code needs to
change beyond swapping the transport.

This caveat is recorded inline in the SQL migration's header comment for
future maintainers.

---

## 5. Recap of what changed in this round

| # | Area | Change | CMS impact | Main-site impact |
| --- | --- | --- | --- | --- |
| 9 | Newsletter campaigns | SQL only; tables added | None yet | None |
| 20 | Posts body | Server-side sanitisation + 200 KB byte cap | None — keeps client cleanup; just don't lift the cap | Free render of body without further sanitisation |
| 24 | Image variants | Sharp-generated WebP sizes on upload | Read `variants[]` from media responses; expose Regenerate button | Use `<img srcset>` from `variants[]` |

---

## 6. Round 2 changes (this push)

The four code-only items below shipped without any DB migration.
They use the existing schema (no new tables / no new columns).

### a. Scheduled publishing cron

Editors can now schedule posts. Set `is_published: false` and
`published_at: "2026-06-01T09:00:00Z"`; the API auto-publishes when
`published_at <= now()` (cron runs every minute).

The CMS UI implication: stop forcing editors to "publish now" — let
them pick a future time and trust the cron. The audit log entry on
the auto-flip carries `{ scheduled: true, by: 'cron' }` so admin
history clearly tells editor-driven publishes apart from automatic
ones.

### b. Audit-log filter by `resource_id`

`GET /audit-logs?resource_type=post&resource_id=<uuid>` returns the
full event history for one specific record. The CMS can render a
"Recent activity" panel on each post / book / paper detail page by
hitting this endpoint.

### c. `GET /dashboard/stats`

One round-trip → all the headline counts the CMS home screen needs.
Permission: `dashboard:read` (seeded; assigned to super-admin, admin,
editor, moderator). Response shape:

```jsonc
{
  "recent_window_days": 7,
  "posts":   { "total": 142, "published": 128, "drafts": 14, "recent": 6 },
  "library": { "books": 87, "academic_papers": 23, "gallery_images": 412, "media_assets": 504 },
  "users":   { "total": 9 },
  "newsletter": { "active_subscribers": 1280, "inactive_subscribers": 47, "recent_subscribers": 12 },
  "forms":   { "contact_new": 4, "contact_recent": 11, "proxy_visit_pending": 2, "proxy_visit_recent": 5 },
  "contest": { "attempts_recent": 318 }
}
```

Use `recent_window_days` to label the "this week" cards; the field is
hardcoded server-side so the CMS doesn't have to mirror the constant.

### d. Trash + restore

Every soft-deletable resource now has:

```text
GET  /<resource>/trash          — paginated list of trashed records
POST /<resource>/:id/restore    — undo the soft-delete
```

Resources: `posts`, `books`, `academic-papers`, `gallery`,
`post-categories`, `book-categories`, `gallery-categories`,
`academic-paper-categories`. Permission: the existing
`<resource>:delete` (anyone who can delete should be able to recover).

**Restore conflict semantics.** Posts and books used the
`__del_<timestamp>` suffix scheme on soft-delete to free up unique
slugs / ISBNs. Restore reverses the suffix:

- If a *live* post has taken the original `(lang, slug)` since the
  delete → 409 Conflict; the operator must rename one side and retry.
- If a live book has taken the original `isbn` since the delete →
  same 409 path.

The trash listing endpoints already strip the suffix from `slug` /
`isbn` in the response, so the CMS can show the original value
without doing the regex itself.

Categories don't have the suffix scheme (a pre-existing
inconsistency), so their restore is a simple `deleted_at = null`
toggle.

### e. Permission seed updates

Two permissions were used by code but not previously seeded; the
seed file now covers them:

- `dashboard:read` — assigned to super-admin, admin, editor, moderator.
- `newsletter:update` — used by the admin unsubscribe / resubscribe
  routes from round 1; assigned to super-admin, admin, moderator.

Re-run `npm run prisma:seed` to pick them up. The seed uses upsert
so re-running on a populated DB is safe — it just adds the new
permission rows and their role assignments without touching anything
else.

---

## 7. Round 3 changes (this push) — Tier 1 finale

Apply the SQL migration first:

```bash
psql "$DIRECT_URL" -f prisma/migrations/20260511100000_tier1_finale/migration.sql
npm run prisma:pull && npm run prisma:generate
```

Then re-run the seed to pick up the new permissions + initial settings:

```bash
npm run prisma:seed
```

### a. SEO fields on posts

`post_translations` gains three optional columns:

- `meta_title` — rendered in `<title>` and the SERP heading. Falls back
  to `title` when null.
- `meta_description` — SERP snippet + `og:description`. Falls back to
  `summary` (or a body excerpt) when null.
- `og_image_id` — UUID FK to `media`. Falls back to the post's
  `cover_image_id` when null.

CMS additions: three new inputs on the post editor's per-language tab
(short text, longer text, image picker). The server validates that
`og_image_id` references an existing media row and surfaces a 404 if
not — the inputs should clear on a category change so a stale ID
doesn't survive into the submit body.

Public-site additions: read `post.translation.meta_title` etc. and
inject into the page `<head>` via your framework's metadata API. For
each null field, apply the fallback documented above (so the public
page always has *some* meta tag, even if the editor left the field
blank).

### b. `GET /settings` — editable site config

The CMS needs a Settings page. Endpoints:

```text
GET    /settings/public      — anonymous; only is_public=true keys
GET    /settings             — admin; full list (settings:read)
GET    /settings/:key        — admin; single (settings:read)
PUT    /settings/:key        — admin; upsert (settings:update)
DELETE /settings/:key        — admin; delete (settings:delete)
```

The body for `PUT`:

```jsonc
{
  "value": "Imam Zain Foundation",   // always stringified on the wire
  "type": "string",                  // only honoured on first write
  "description": "Footer site title",
  "is_public": true
}
```

Response values are decoded server-side based on `type`:

```jsonc
{ "key": "site_name", "value": "Imam Zain Foundation", "type": "string", ... }
{ "key": "max_recent_items", "value": 6, "type": "number", ... }
{ "key": "show_donation_banner", "value": true, "type": "boolean", ... }
{ "key": "homepage_hero", "value": { "title": "…", "cta": "…" }, "type": "json", ... }
```

`type` is **immutable after creation**. Trying to change it returns 409;
delete and re-create to retype a setting.

Seeded keys (initial values are empty strings for the social URLs; the
seed never overwrites existing values, so re-running is safe):
`site_name`, `site_tagline`, `default_language`, `contact_email`,
`notifications_email_to`, `social_facebook`, `social_twitter`,
`social_instagram`, `social_youtube`.

Public site usage: hit `GET /settings/public` at build / fetch time and
key into the response by `key`. Don't cache `notifications_email_to` —
it's admin-only (is_public=false) and the public site shouldn't see it.

### c. `POST /users/:id/reset-password` — admin password reset

CMS user-management page should grow a "Reset password" button on each
row. Clicking it opens a small dialog with a new-password input; on
submit:

```http
POST /api/v1/users/<userId>/reset-password
Content-Type: application/json
Authorization: Bearer <admin jwt>

{ "new_password": "the-new-password-they-typed" }
```

Permission required: `users:update` (already granted to super-admin
and admin). The API bumps `token_version` and revokes every active
refresh token, so the affected user is force-logged-out everywhere on
their next request. The admin is responsible for handing the new
password to the user out-of-band (in person, Slack, phone).

No self-service "forgot password" exists because the users table has
no email column — recovery is by admin action.

### d. `/newsletter/campaigns` — full sender lifecycle

The schema tables shipped earlier; this push adds the API:

```text
POST   /newsletter/campaigns                  — create (draft or scheduled)
GET    /newsletter/campaigns?status=…         — paginated list
GET    /newsletter/campaigns/:id              — detail + delivery counters
PATCH  /newsletter/campaigns/:id              — update (draft / scheduled only)
POST   /newsletter/campaigns/:id/send         — queue for sending now
POST   /newsletter/campaigns/:id/cancel       — stop the send loop
DELETE /newsletter/campaigns/:id              — hard-delete (draft / cancelled)
```

Permissions: reads → `newsletter:read`; writes / send / cancel →
`newsletter:update`; delete → `newsletter:delete`.

**Composing a body.** The `body_html` field is server-side sanitised
against the same Tiptap allowlist used for post bodies, so the CMS can
reuse its existing editor. Two placeholders are substituted per
recipient at send time:

- `{{email}}` — the recipient's email.
- `{{unsubscribe_url}}` — a per-subscriber link with the HMAC token
  already embedded.

If `{{unsubscribe_url}}` is **absent** from the body, the API appends a
small footer with the link automatically — every outbound email has a
working unsubscribe.

**Send flow.** `POST /:id/send` returns immediately with
`{ recipient_count }` after populating a row per active subscriber in
`newsletter_campaign_recipients`. An `EVERY_MINUTE` cron then processes
50 pending recipients per campaign per tick, updating counters on the
campaign row as it goes. When all rows are processed the status flips
to `sent`. State lives in the recipient table so a process crash mid-
send doesn't lose or double-send anything — the cron resumes from
`sent_at IS NULL AND failed_at IS NULL` on next tick.

**Scheduling.** Send a `scheduled_at` ISO timestamp on create; the
campaign sits in `scheduled` until the cron's next tick at or after
that time, then it transitions to `sending` and processing begins.

**Throughput.** With Hostinger SMTP the practical ceiling is ~50–100
emails per minute per the upstream rate limit; the default
`BATCH_SIZE_PER_TICK=50` is comfortably below that. When the
subscriber list grows past a few hundred, switch to a transactional
ESP (Resend / Brevo / Mailgun) and raise the batch size — the code
itself doesn't need changes beyond pointing nodemailer elsewhere.

**Env vars for unsubscribe links.** Set `NEWSLETTER_UNSUBSCRIBE_URL_BASE`
to the front-end's unsubscribe page (default
`https://imamzain.org/newsletter/unsubscribe`). The API appends
`?email=<…>&token=<…>` and that page POSTs to `/newsletter/unsubscribe`.

---

## 8. Round 4 polish (this push)

A small cleanup batch on top of the tier-1 finale.

### a. SQL — apply before the rest

```bash
psql "$DIRECT_URL" -f prisma/migrations/20260511150000_posts_featured/migration.sql
npm run prisma:pull && npm run prisma:generate
```

Adds `posts.is_featured boolean DEFAULT false` plus a partial index
tuned for the public homepage query.

### b. `is_featured` + sort

`GET /posts` gains two orthogonal query params:

- `?featured=true` — limits to flagged posts (homepage hero / featured rail).
- `?sort=newest` (default) or `?sort=views` — popular sort.

`CreatePostDto` / `UpdatePostDto` accept `is_featured` (writable via
the existing `posts:create` / `posts:update` permissions). Every post
response includes the flag.

Homepage hero query: `GET /posts?featured=true&sort=newest&limit=5`.
Popular sidebar: `GET /posts?sort=views&limit=5`.

### c. `reading_time_minutes` on post translations

Every post translation in list / detail responses now carries a
`reading_time_minutes` integer — server-side derived from body text
length (~1000 chars / minute, tuned for mixed Arabic + English).
Minimum 1 for any non-empty body, 0 for empty. No schema change.

Use in the CMS / public site to render "5 min read" tags without
duplicating the heuristic on every consumer.

### d. `GET /audit-logs/:id` detail endpoint

Pairs with the existing `?resource_id=` filter on the list. Use to
deep-link from an activity-feed panel into a single audit event.

### e. Soft-delete consistency on categories

Pre-existing gap: posts and books suffixed unique columns
(`(lang, slug)` and `isbn`) on soft-delete so a new record could
claim the value while the old one sat in the trash. The four category
services didn't — a soft-deleted category permanently held its
`(lang, slug)` and blocked any new category from claiming the slug.

This commit makes all four category services match the post pattern:
suffix on `softDelete`, strip-back-off on `restore`, refused with 409
if the original slug was claimed by a live category in the meantime.

No API surface change — the CMS sees the suffixed values only via the
trash listing (which already strips them in the response).

### f. Media variant backfill

```bash
npm run prisma:backfill-variants
```

Walks the `media` table, regenerates WebP variants for any row that
doesn't yet have them. One-time use for catching up media uploaded
before the variant pipeline shipped in round 2.

Safe to re-run — idempotent (skips rows that already have variants).

### g. Swagger fix

`POST /newsletter/campaigns/:id/send` advertised `CampaignResponseDto`
(full campaign) but actually returns `{ id, recipient_count }`. Added
`CampaignSendResponseDto` so typed clients see the real shape.

---

## 9. Round 5 — tier 3 (this push)

Pure code; no migration. Four new capabilities for the CMS and public
site, all backed by existing tables.

### a. Global search — `GET /search`

```text
GET /search?q=<term>&types=post,book,academic_paper,gallery_image&limit=10
```

- **Public** — only returns content visible to anonymous users
  (published posts; non-deleted books / papers / gallery).
- `q` is 2–200 characters. Insensitive substring match — no
  Postgres full-text index yet; revisit if the corpus or query volume
  grows past the comfort of `ILIKE`.
- `types` is optional and case-sensitive enum; omitting it searches all
  four resource types. Comma-separated.
- `limit` is per-type (default 10, max 50). The total response can
  therefore contain up to `4 × limit` hits.
- Rate-limited to 60 req/min/IP.

Response shape (buckets are absent when the corresponding type is not
requested):

```jsonc
{
  "q": "الإمام",
  "post":           { "items": [{ "type": "post", "id": "...", "title": "...", "summary": "...", "lang": "ar", "slug": "...", "cover_image_url": "..." }], "total": 4 },
  "book":           { "items": [...], "total": 2 },
  "academic_paper": { "items": [...], "total": 1 },
  "gallery_image":  { "items": [...], "total": 0 }
}
```

Per-hit language resolution: the matched translation is the one that
actually contained the query; the `Accept-Language` header only kicks
in to break ties when multiple translations match. This way an Arabic
search that surfaces an English summary returns the English row, not
the Arabic default whose text doesn't contain the query.

### b. Public sitemap — `GET /sitemap.xml`

Returns an `application/xml` urlset of every published post, with
`xhtml:link` hreflang alternates per translation. Cached with
`Cache-Control: public, max-age=900` so the CDN takes most of the
load.

URL shape: `${PUBLIC_SITE_URL}/{lang}/posts/{slug}`. Set
`PUBLIC_SITE_URL` (defaults to `https://imamzain.org`) to the
canonical origin you want search engines to crawl.

The endpoint emits every published row in one document. At current
corpus size (low thousands of posts × two languages) this is well
inside the 50k-URL practical cap for a single sitemap; if the corpus
grows we'll split into a sitemap-index pointing at chunked sub-
sitemaps. Public-site responsibility is just to reference it in
`robots.txt`:

```text
Sitemap: https://api.imamzain.org/api/v1/sitemap.xml
```

### c. Posts RSS feed — `GET /rss/posts.xml`

RSS 2.0 feed of the 50 most recent published posts, resolved to each
post's default translation (RSS readers don't model language
alternates well — one item per post). `application/rss+xml`, same
15-minute `Cache-Control` as the sitemap.

`PUBLIC_SITE_NAME` (defaults to `Imam Zain Foundation`) controls the
`<channel><title>`. `PUBLIC_SITE_URL` controls the `<channel><link>`.

Hook into the public-site `<head>`:

```html
<link rel="alternate" type="application/rss+xml" title="ImamZain.org"
      href="https://api.imamzain.org/api/v1/rss/posts.xml" />
```

### d. Bulk operations on posts

Two new endpoints for the CMS list view's checkbox toolbar:

```text
POST /posts/bulk/publish     — body: { ids: [...], is_published: true|false }
POST /posts/bulk/delete      — body: { ids: [...] }
```

- Permissions: `posts:update` for bulk-publish, `posts:delete` for
  bulk-delete.
- Max 200 ids per call. Duplicates are de-duped server-side.
- Posts that are missing, already soft-deleted, or already in the
  requested publish state are listed in the response `skipped` array
  so the CMS can render "8 published, 2 already published".
- Each row is audit-logged exactly like the single-item path, with an
  extra `bulk: true` marker in `changes` so admin history can
  distinguish bulk actions from one-off clicks.
- The whole batch runs in a single transaction — partial failures
  roll back every row.

Response shape:

```jsonc
{
  "message": "8 post(s) published",
  "data": { "affected": 8, "skipped": ["<uuid>", "<uuid>"] }
}
```

### e. New env vars (all optional with sensible defaults)

```bash
PUBLIC_SITE_URL=https://imamzain.org          # sitemap + RSS link base
PUBLIC_SITE_NAME=Imam Zain Foundation         # RSS channel title
NEWSLETTER_UNSUBSCRIBE_URL_BASE=...           # already in use from round 3
```

---

## 10. Round 6 (this push) — performance + workflow gaps

Pure code + one additive SQL migration. No breaking changes.

### a. Apply the SQL migration first

```bash
psql "$DIRECT_URL" -f prisma/migrations/20260512100000_search_indexes_and_filters/migration.sql
npm run prisma:pull && npm run prisma:generate
```

Adds `pg_trgm` extension and GIN trigram indexes on every column the
API does substring `contains` search on (post title + body, book title +
author + description, paper title + abstract, gallery title +
description, media filename + alt_text), plus a B-tree index on
`media.mime_type` for the new filter. Re-runnable; everything is
`IF NOT EXISTS`.

### b. Cache-Control on public reads

Every public GET now sets `Cache-Control: public, max-age=…, s-maxage=…`
and `Vary: Accept-Language`. Cloudflare (or any other CDN) absorbs the
bulk of public traffic; the origin only handles requests for content
the CDN doesn't yet have or that has expired.

TTL summary:

| Endpoints | Browser | CDN |
| --- | --- | --- |
| Posts / books / papers / gallery list + detail | 60s | 5m |
| Categories (all four) list + detail | 5m | 30m |
| `/search` | 30s | 60s |
| `/settings/public` | 15m | 60m |
| `/languages` | 60m | 24h |
| `/forms/qutuf-sajjadiya-contest/questions` | 5m | 60m |
| `/homepage` (new) | 60s | 5m |
| `/sitemap.xml`, `/rss/posts.xml` | 15m | 15m (unchanged) |

The CMS, the public site, and the integration handbook all describe
what to do with these headers — see
[integration.md#caching-strategy--cost-notes-for-consumer-apps](integration.md#caching-strategy--cost-notes-for-consumer-apps).

NestJS / Express already emits a weak `ETag` on every JSON response;
the CDN turns `If-None-Match` into 304 responses automatically.

### c. `GET /homepage` — composite aggregator

```text
GET /homepage?featured_limit=5&popular_limit=5&recent_limit=10
```

Returns three buckets in one round trip: `featured` (is_featured=true,
newest first), `popular` (highest view count), `recent` (newest
published). Replaces the public-site fan-out of three separate
`/posts` calls.

Cards are deliberately slim — no `body`, no `post_attachments` — since
homepage tiles never render the body. Includes `cover_image`,
`translation`, `category`, and a `reading_time_minutes` derived from
the summary.

CDN-cacheable, same `public, max-age=60, s-maxage=300` as the post
endpoints. Limits clamp to 0–20 per bucket.

### d. `GET /posts/admin?status=...`

Admin tab filter. Values: `draft`, `scheduled`, `published`, `all`
(default). The CMS can finally render proper "Drafts (14)" /
"Scheduled (2)" / "Published (128)" tabs without fetching all posts
and filtering client-side.

Definitions:

- `draft`: `is_published=false` AND (`published_at` is null OR in the
  past)
- `scheduled`: `is_published=false` AND `published_at` is in the
  future
- `published`: `is_published=true`
- `all` (default): everything (current behaviour)

The public `GET /posts` route ignores `status` — anonymous callers only
ever see published posts.

### e. `GET /media?search=&mime_type=`

The media library admin endpoint now accepts:

- `search` — substring match on `filename` + `alt_text`,
  case-insensitive. Backed by GIN trigram indexes so it stays cheap as
  the library grows.
- `mime_type` — exact match. Common values: `image/jpeg`, `image/png`,
  `image/webp`, `image/gif`.

The CMS media picker should always pass at least one of these once the
library grows past a few dozen items.

### f. Notes for the CMS team

- New `?status=` filter on `GET /posts/admin` — wire it into the CMS
  posts list page as tabs.
- New `?search=` + `?mime_type=` on `GET /media` — required for the
  media picker once the library grows. Debounce search input by ≥ 300 ms.
- `GET /dashboard/stats` — don't poll faster than 30 s/refresh.
- `GET /auth/me` is for initial profile load only; render permission
  gates from the JWT's `permissions[]` array, not by re-calling /me.
- Campaign composer: fetch recipient count via
  `GET /newsletter/subscribers?is_active=true&limit=1` and read
  `pagination.total`, don't poll.

### g. Notes for the front-end team

- **Route the public site through Cloudflare (orange cloud).** That's
  where almost all the cost savings come from — the Cache-Control
  headers we ship are useless if the CDN isn't in front of the API.
- Confirm Cloudflare's "Respect origin Cache-Control" rule is ON; do
  not override with hard-coded edge TTLs.
- Use `GET /homepage` instead of three `/posts` calls.
- Always render `<img srcset>` from `media.variants[]`, never the
  original URL.
- Build-time fetch `/settings/public` and `/languages`; bundle into the
  static site. Don't re-fetch per page render.
- Public search bar: debounce ≥ 300 ms, abort in-flight on new
  keystroke.
- `POST /posts/:id/view`: fire only after a 5 s dwell, not on every
  visit.
- Use the `translations[]` array on post / book responses to emit
  `<link rel="alternate" hreflang>` tags in `<head>` for SEO.

The full caching strategy + monitoring guidance lives in
[integration.md#caching-strategy--cost-notes-for-consumer-apps](integration.md#caching-strategy--cost-notes-for-consumer-apps).

---

## 11. Open follow-ups (still not in this push)

- Self-service password reset flow (would need an `email` column on
  `users` plus the `password_reset_tokens` table described in the
  migration header).
- Tags many-to-many (deferred — structural decision).
- 2FA on admin accounts (skipped — high-trust in-house deployment).
- Personal access tokens (skipped — no automation needs today).
- Versioning / revision history on content edits.
- Sitemap-index / chunked sub-sitemaps once published-post count
  approaches the 50k-URL cap (likely years away).
