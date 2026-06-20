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

### Upload flow — new fields on `POST /media/upload-url`

The response now includes two additional fields the CMS should consume:

```jsonc
{
  "uploadUrl": "https://bucket.r2.cloudflarestorage.com/...?X-Amz-Signature=…",
  "key":       "media/originals/9c8d4f7a-1b2e-4c5d-9e6f-7a8b9c0d1e2f/shrine-photo.jpg",
  "mediaId":   "9c8d4f7a-1b2e-4c5d-9e6f-7a8b9c0d1e2f",  // ← the id the media row will get at confirm
  "maxBytes":  26214400                                  // ← 25 MB for images
}
```

- **`mediaId`**: pre-generated server-side and embedded in the R2 key.
  Available before the PUT completes so the CMS can stage references
  (e.g. wire it into a draft post body, optimistic UI in the media
  library) without waiting for `/media/confirm`.
- **`maxBytes`**: per-MIME upload cap. Validate against `File.size`
  client-side before starting the PUT — otherwise the user uploads,
  waits, then sees a 413 from `/media/confirm` with the R2 object
  already purged. Surface a clear error like "Image exceeds 25 MB".

### R2 storage layout (FYI)

```text
media/
  originals/<mediaId>/<slug>.<ext>     ← the file the CMS uploaded
  variants/<mediaId>/w{320,768,1280,1920}.webp
```

Originals are kept (not deleted after variant generation) so future
re-processing — AVIF support, larger variants for 4K hero images,
AI-driven features — remains possible. Variant URLs are stable and
immutable; no cache-busting needed on the frontend.

### Size cap rejection (413)

If the file slips past client validation and the actual byte count
exceeds `maxBytes`, `POST /media/confirm` returns 413 and deletes the
R2 object as part of the same call (no orphan storage). Display the
413's `error` message verbatim — it already names the limit and MIME.

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
| `/homepage` (new) | 15m | 60m |
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

## 11. Round 7 (this push) — daily hadiths + YouTube mirror + slim homepage

Two new domains and a homepage rewrite to match what the front-end's
`src/app/page.tsx` actually consumes. No breaking changes to existing
endpoints; the homepage response shape did change — it's a new
endpoint, so this is the first stable contract.

### a. Apply the round-7 SQL migration first

```bash
psql "$DIRECT_URL" -f prisma/migrations/20260512200000_daily_hadiths_and_youtube/migration.sql
npm run prisma:pull && npm run prisma:generate
```

Adds six tables (3 hadith, 3 youtube) — all additive, no existing
table touched.

Then re-run the seed to pick up the four new `daily-hadiths:*`
permissions and the editor-role mapping:

```bash
npm run prisma:seed
```

### b. Daily hadiths

A small CMS-managed table that rotates one hadith per UTC day across
the public homepage. The endpoint exists at:

```text
GET    /daily-hadiths/today                          — public, CDN-cached
GET    /daily-hadiths                                 — admin list
GET    /daily-hadiths/:id                             — admin detail
POST   /daily-hadiths                                 — admin create
PATCH  /daily-hadiths/:id                             — admin update
DELETE /daily-hadiths/:id                             — admin soft-delete
GET    /daily-hadiths/pins                            — admin list pins
POST   /daily-hadiths/pins                            — admin pin to a date
DELETE /daily-hadiths/pins/:pin_date                  — admin unpin
```

**Rotation rule.** Active hadiths are ordered by `(display_order asc,
id asc)`, then today's index = `daysSinceEpoch (UTC) % count`. Same
day → same hadith for every visitor, which is exactly what makes
the homepage cacheable for hours.

**Override.** An editor can pin a specific hadith to a specific
calendar date via `POST /daily-hadiths/pins` with body `{ pin_date:
"2026-05-15", hadith_id: "uuid" }`. The pin overrides the rotation
for that one day; the next day, rotation resumes. Pinning an inactive
hadith is allowed (the pin is an explicit override).

**Empty table.** `GET /daily-hadiths/today` returns `data: null`; the
homepage block degrades gracefully.

**Permissions:** `daily-hadiths:read/create/update/delete`. The
**editor** role gets all four by default — hadiths are content, not
admin config.

### c. YouTube mirror

The API now maintains a local mirror of the channel's videos and
playlists, refreshed every 6 hours by a background cron. Public
endpoints read exclusively from the mirror; YouTube is never on the
request path. Quota use is ~10–20 units per sync — well below the
10k/day free quota.

```text
GET /youtube/videos                            — paginated, newest first
GET /youtube/playlists                         — paginated, newest first
GET /youtube/playlists/:playlistId/videos     — playlist + ordered videos
```

All public, all CDN-cached for 15 min. `:playlistId` is the YouTube
playlist ID (e.g. `PLxxxx`), not an internal UUID.

**Env vars** (both optional — sync is silently skipped if either is
missing):

```bash
YOUTUBE_API_KEY=<key from Google Cloud Console>
YOUTUBE_CHANNEL_ID=<UCxxxxxxxxxxxxxxxxxxxxxx>
```

**Bootstrap.** A first sync fires 30 seconds after server boot, so
freshly-deployed servers don't have to wait up to 6h before the
homepage has videos. Subsequent runs are on the `0 */6 * * *` cron.

**Operational note.** The sync deletes-and-rebuilds the playlist→video
join rows each run; that's how we mirror YouTube reordering /
removals. Videos that have been deleted from YouTube fall out
naturally on the next sync (they won't appear in `playlistItems`).

### d. `GET /homepage` — rewritten shape

Replaces the earlier "featured / popular / recent" shape with the
exact set of fields the public site's `src/app/page.tsx` consumes,
and nothing more. Old version is gone; this is the stable contract.

```jsonc
{
  "hadith_of_day": { "id": "...", "content": "...", "source": "...", "lang": "ar", "is_pinned": false },
  "news": [
    { "slug": "...", "image": "...", "summary": "...", "title": "..." }
    // up to 4: featured first, fall back to most-recent published when fewer featured exist
  ],
  "publications": [
    { "id": "...", "slug": "...", "title": "...", "image": "...", "pages": 220, "views": 1500 }
    // latest 10 books by created_at
  ],
  "videos": [
    { "title": "...", "url": "<videoId>", "desc": "...", "thumbnail": "...", "date": "..." }
    // most recent 7 from the YouTube mirror
  ],
  "gallery": {
    "slider":     [{ "id": "...", "path": "..." } /* latest 10 gallery images */],
    "categories": [{ "id": "...", "name": "..." } /* all gallery categories in the requested language */]
  }
}
```

Cache: `Cache-Control: public, max-age=900, s-maxage=3600`, varies by
`Accept-Language`. Per-day stable cache key — the CDN should serve
the same response for the bulk of visitors in a given language.

### e. Notes for the CMS team

- A new "Daily Hadiths" section needs to land in the CMS sidebar.
  Recommended flow: list view + create dialog with three translation
  tabs (ar/en/fa); detail view with a "Pin to date" calendar widget.
- Hadith content max length is 4000 chars (`content`) / 500 chars
  (`source`). Both are plain text — no rich-text editor needed.
- `display_order` controls rotation position. Leave it null on
  create; the server appends to the end.
- Pins are upsert-on-write — re-pinning the same date replaces. To
  return that day to rotation, `DELETE /daily-hadiths/pins/2026-05-15`.
- The YouTube content isn't editable from the CMS — it's fully driven
  by the YouTube channel. If you need to remove a video from the API
  response, remove / privatise it on YouTube; the next 6h sync drops
  it locally.

### f. Notes for the front-end team

- **`GET /homepage` is now the single endpoint** for the public
  home route. Drop any direct calls to `/posts?featured=true`,
  `/books?...`, `/gallery?...`, and `/videos` that the homepage
  components currently make.
- **Video URL building.** `url` field is the bare 11-char YouTube ID.
  Build embed URLs front-end-side as `https://www.youtube.com/embed/{url}`
  or watch URLs as `https://www.youtube.com/watch?v={url}`.
- **Hadith block.** Hide if `hadith_of_day` is null. Otherwise show
  `content` and (if `source` is non-null) `source` underneath.
- **News fallback.** The server already handles "fewer than 4
  featured" by topping up from recent published posts — don't
  duplicate that logic client-side.
- **Publications `slug`.** Identical to `id` (books have no separate
  slug column). Link with `/books/{slug}` as you do today; either
  field works.
- **Gallery slider.** Latest 10 images; the response order is newest
  first. Maintain the existing image-rendering swap if you want
  oldest-first display.
- **Gallery categories.** All of them, with `id` + localised `name`.
  Clicking goes to `/gallery?category_id={id}` — pure server-driven
  list, no more hard-coded pairings.
- **Videos page.** If/when you build a dedicated /videos page beyond
  the homepage's 7-card preview, use `GET /youtube/videos?page=&limit=`
  and `GET /youtube/playlists/:playlistId/videos`. Both are
  CDN-cached and read-only.

### g. Audit actions added in this round

- `DAILY_HADITH_CREATED`, `DAILY_HADITH_UPDATED`, `DAILY_HADITH_DELETED`,
  `DAILY_HADITH_PINNED`, `DAILY_HADITH_UNPINNED`

YouTube sync runs do **not** emit per-row audit logs — that would be
noisy and the sync is a system action, not a user action. Sync
success / failure shows up in application logs only.

---

## 12. Round 8 (this push) — media pipeline refresh

Three changes in the media-upload flow that the CMS needs to adjust
for. Everything else in this push is either runtime-compatible or
internal (see the "no-action" notes at the end of this section).

### a. `POST /media/upload-url` — two new fields in the response

**Old shape:**

```jsonc
{ "uploadUrl": "...", "key": "...", "publicUrl": "..." }
```

**New shape:**

```jsonc
{
  "uploadUrl": "https://bucket.r2.cloudflarestorage.com/...?X-Amz-Signature=…",
  "key":       "media/originals/9c8d4f7a-1b2e-4c5d-9e6f-7a8b9c0d1e2f/shrine-photo.jpg",
  "publicUrl": "https://cdn.imamzain.org/media/originals/9c8d4f7a-1b2e-4c5d-9e6f-7a8b9c0d1e2f/shrine-photo.jpg",
  "mediaId":   "9c8d4f7a-1b2e-4c5d-9e6f-7a8b9c0d1e2f",
  "maxBytes":  26214400
}
```

- **`mediaId`** — the UUID of the media row that will exist after
  `/media/confirm`. It's pinned to that value at confirm time, so it's
  safe to use *before* the upload completes. Use it to:
  - Optimistically render the media-library tile while the PUT is in flight.
  - Wire the id into a draft post body's `attachment_ids` list before
    calling `/media/confirm` (the post draft endpoint accepts the id;
    if the upload ultimately fails the attachment FK will reject it,
    which is correct behaviour).
  - Skip the second round-trip you used to need just to learn the id.
- **`maxBytes`** — per-MIME upload cap, currently **25 MB** for every
  image type. **Validate `file.size <= maxBytes` client-side before
  starting the PUT.** If you skip this, the user sits through a full
  upload, then hits 413 from `/media/confirm` (see point b). Recommended:
  gate the file picker / drop-zone validation on this value rather than
  hard-coding 25 MB in the CMS — the cap may change for new MIME types
  (PDFs are planned at 150 MB) and you'll get it for free.

### b. `POST /media/confirm` — new 413 case to handle

If R2's authoritative `Content-Length` exceeds `maxBytes`, `/media/confirm`
returns:

```jsonc
// HTTP 413 PayloadTooLarge
{
  "success": false,
  "error":   "File exceeds the 25 MB limit for image/jpeg",
  "timestamp": "...",
  "path": "/api/v1/media/confirm"
}
```

The R2 object is deleted in the same call, so the CMS does **not** need
to do any cleanup. Just surface the `error` string verbatim in the
upload-error UI — it already names both the cap and the MIME.

If the CMS implements the client-side check in (a), this 413 only fires
for adversarial / out-of-spec clients, not for normal user flows.

### c. R2 key format changed for new uploads

| Object                     | R2 key pattern                                          |
| -------------------------- | ------------------------------------------------------- |
| **New uploads**            | `media/originals/<mediaId>/<slug>.<ext>`                |
| **Existing uploads**       | `media/<uuid>-<slug>.<ext>` (unchanged)                 |
| **Variants** (all uploads) | `media/variants/<mediaId>/w{320,768,1280,1920}.webp`    |

Both the new and legacy original-key formats keep working — `/media/confirm`
accepts either, and `DELETE /media/:id` cleans up the right path
automatically.

The CMS normally treats `key` as an opaque blob handed back to
`/media/confirm`, so no code change is required in the upload flow.
**Only flag this if** you display the raw R2 key in a debug / inspector
view, in which case the human-readable slug now sits inside the
`<mediaId>/` folder instead of being prefixed with the random uuid.

The `media.url` field on every media response is still the canonical
public URL; consumers should keep reading it directly rather than
reconstructing it from the key.

### d. Image variants are now EXIF-oriented (no CMS action needed, just a UX win)

Sideways phone photos used to come out sideways in the variants while
the original looked correct (browsers auto-rotate based on EXIF
orientation; sharp didn't unless asked). Variants are now rotated and
the EXIF tag stripped, so what you see in the variant matches the
original.

If the CMS was previously preferring the original URL for previews to
dodge sideways thumbnails, you can switch back to the largest variant
for previews — variants are now visually identical to the EXIF-rotated
original.

### e. No-action items also shipped this round

These are either runtime-compatible or invisible to the CMS:

- **Originals are kept after variant generation** (not deleted). The
  upload pipeline writes both the source and the four WebP variants to
  R2 and keeps both, so future re-processing — AVIF, larger variants,
  ML-driven features — remains possible. The CMS doesn't need to track
  or manage originals separately; `DELETE /media/:id` still cleans both
  folders in one call.
- **`sanitize-html` bumped to 2.17.4** to patch the `<xmp>` raw-text
  XSS reported by Apostrophe. The Tiptap allowlist never included
  `<xmp>` so neither side was directly exposed; no config change needed.
- **`fast-xml-builder` pinned to ^1.1.7 via npm overrides** to clear two
  Dependabot alerts on a transitive AWS-SDK dep. Internal — no API
  surface impact.
- **400 `ApiBadRequestResponse` documented on every list / body
  endpoint** in Scalar. The actual runtime behaviour is unchanged
  (global `ValidationPipe` was already returning 400 for `?page=abc`
  etc.); Scalar just now correctly shows the case alongside 200/404/etc.
  No CMS code change needed; your existing validation-error handler
  already covers it.

---

## 13. Round 9 (this push) — engineering cleanup, no API surface change

This push is an internal de-slop and refactor: the audit-log writer was
centralised into a single `AuditService`, ~70 inlined call sites + 38
empty `try { ... } catch {}` blocks were removed, and a layer of typing
was put on top of Prisma `where` / `data` payloads. **No route URL, no
request DTO, no response envelope, no status code, no audit-log
`action` string, and no audit `changes` field changed.** Read the
sections below only if the listed item is something your client
currently exercises.

### 13.1 Rate limits added — minor but observable

- `PATCH /api/v1/auth/me/password` is now rate-limited per IP:
  **5 requests / 15 minutes**. Was previously only under the global
  throttler (1000 / 15 min). The "change my own password" UI in the CMS
  should already surface 429s using the existing
  `TooManyRequestsErrorDto` body shape (`success: false`, `error: "ThrottlerException: Too Many Requests"`).
- `POST /api/v1/users/:id/reset-password` (admin-driven reset) is now
  rate-limited per IP: **10 / 15 min**. Same `429` shape.

If your client does a "change-password test" or rapid resets in QA,
expect 429s after ~5 calls. There is no functional change otherwise.

### 13.2 Sanitiser tightened on `data:` image URLs

`POST/PATCH` endpoints that accept HTML body (posts, newsletter
campaigns) keep the existing Tiptap allowlist, with one stricter rule:
`<img src="data:...">` is now accepted **only** for these MIME types:

```text
image/png   image/jpeg   image/gif   image/webp   image/svg+xml
```

Anything else (including `data:text/html`, `data:application/...`)
drops the entire `<img>` element. Real editor output uses image MIMEs,
so the CMS rich-text editor and existing post bodies are unaffected.
The only practical effect: a malicious admin can't smuggle inline HTML
through a `data:text/html` payload anymore.

### 13.3 Audit-log writer is now centralised — internal only

`audit_logs.action` values and the `changes` JSON shape are unchanged —
your audit-dashboard queries against `action`, `resource_type`,
`changes.method`, `changes.path`, etc. continue to work.

One subtle policy change worth flagging only for the audit dashboard
team: on three code paths — `POST /posts/bulk/publish`, `POST
/posts/bulk/delete`, and the once-per-minute scheduled-publish cron —
audit rows are now written **after** the transaction commits rather
than inside it. Previously, a DB failure on audit-write would also
roll back the post-state change; now the state change commits and the
audit-write failure is logged but does not roll back. This brings
those three paths in line with every single-row mutation, which always
worked this way (the old `try { ... } catch {}` swallow you'd see in
the legacy code). In normal operation you won't see any difference —
`audit_logs` rows land the same way.

### 13.4 Newsletter unsubscribe-token signing — ops action required

`NewsletterService` now refuses to boot if **neither**
`NEWSLETTER_UNSUBSCRIBE_SECRET` **nor** `JWT_SECRET` is set. Previously
it silently fell back to an empty signing key, which made unsubscribe
tokens trivially forgeable.

Action for the ops team: every existing environment already has
`JWT_SECRET` set (it is and always was required), so production is
unaffected. New deployments and local dev `.env` files must include at
least `JWT_SECRET`. Setting a distinct `NEWSLETTER_UNSUBSCRIBE_SECRET`
remains optional — only useful if you want to rotate the unsubscribe
key without invalidating JWTs.

### 13.5 Bug fixes for the website team

- `GET /api/v1/posts/by-slug/:slug` — same response shape, but now
  served in a single DB query instead of two. Expect lower latency on
  the public post detail page; no client change needed.
- `POST /api/v1/posts/:id/view` — fixed a TOCTOU race where a post
  soft-deleted between the read and the update could still get its
  view counter incremented. Same response, same `404` semantics, just
  honest about concurrency now.

### 13.6 Env vars now validated at boot

`config/env.validation.ts` now type-checks the following vars when they
are set (all optional; missing values still boot in dev):

- `BCRYPT_ROUNDS` — must be integer 4–15 if set
- `R2_UPLOAD_URL_TTL_SECONDS` — must be integer 60–86400 if set
- `SENTRY_DSN`, `LOG_LEVEL`, `NEWSLETTER_UNSUBSCRIBE_URL_BASE`,
  `EMAIL_FROM`, `EMAIL_TO`, `PUBLIC_SITE_URL`, `PUBLIC_SITE_NAME`,
  `SMTP_HOST/PORT/USER/PASS/SECURE`, `TWILIO_ACCOUNT_SID/AUTH_TOKEN/
  WHATSAPP_FROM/TEMPLATE_SID` — string/int validation when set

A bad value (e.g. `BCRYPT_ROUNDS=99` or `SMTP_PORT=foo`) will now fail
the boot with a clear `Invalid environment configuration:` error
instead of silently behaving wrong at request time.

### 13.7 Internal-only changes worth knowing about

These don't change any external surface but they're worth knowing if
you read the service code:

- `audit_logs.create(...)` calls are gone from every service in favour
  of `AuditService.write(...)`. The action strings and `changes`
  payload shape are unchanged.
- `where: any`, `data: any`, `as any` removed from the service layer.
  Replaced with `Prisma.*WhereInput` / `Prisma.*UpdateInput` /
  `Prisma.PrismaClientKnownRequestError`.
- Pagination math (`page`, `limit`, `skip`, `pages`) consolidated into
  `common/utils/pagination.util.ts`. The output `pagination` envelope
  shape is unchanged.
- bcrypt cost factor resolution moved into
  `common/utils/bcrypt.util.ts` (was duplicated three times).
- `AuthService.login`/`refresh`/`getMe` share a single
  `findUserWithPermissions` helper (was duplicated three times).
- `JwtStrategy` reads `JWT_SECRET` via `ConfigService` instead of at
  module-load time. Same secret, same JWTs.
- `AllExceptionsFilter` uses `Nest Logger` instead of `console.error`
  for unhandled errors. Sentry capture path is unchanged.

---

## 14. Round 10 (this push) — pre-release hardening

This push closes the pre-release audit (`docs/pre-release-audit-tasks.md`).
Every change below is a tightening or a contract-correction, **not** a
redesign — generated clients keep working, but the schema is now
trustworthy in places it previously over- or under-promised. Read the
sections that touch endpoints your client actually exercises.

### 14.1 New migration to apply

```text
prisma/migrations/20260526120000_form_notification_failed_at/migration.sql
```

Adds a nullable `notification_failed_at TIMESTAMPTZ` column to
`contact_submissions` and `proxy_visit_requests`. The migration is
idempotent (`ADD COLUMN IF NOT EXISTS`). Required before
`/dashboard/stats.forms.unsent_notifications` returns anything but zero
— without it, every form submit logs a warning. Apply with:

```bash
npx prisma migrate deploy
```

### 14.2 User responses no longer leak `token_version` / `deleted_at`

Every endpoint that returns a user (`GET /users/:id`, `POST /users`,
`PATCH /users/:id`, `POST /users/:id/roles`,
`DELETE /users/:id/roles/:roleId`) now returns exactly the fields
declared in `UserDetailDataDto`: `{ id, username, is_active, created_at,
updated_at, user_roles, permissions }`.

Previously the `findOne` destructure spread leaked `token_version` (an
internal counter used for forced-logout) and `deleted_at` (always
`null` on these endpoints since they only return live users) into the
response. The DTO never declared either, so generated clients aren't
typed against them — flag only if your CMS code reads
`user.token_version` directly. Use `is_active` (already in the DTO) for
the soft-delete state.

### 14.3 `POST` / `PATCH` on the four `*-categories` resources — full hydration

The four create + four update endpoints —

```text
POST   /api/v1/post-categories            PATCH  /api/v1/post-categories/:id
POST   /api/v1/book-categories            PATCH  /api/v1/book-categories/:id
POST   /api/v1/gallery-categories         PATCH  /api/v1/gallery-categories/:id
POST   /api/v1/academic-paper-categories  PATCH  /api/v1/academic-paper-categories/:id
```

— now return the full hydrated category with `<resource>_translations[]`
and a resolved `translation` field, matching the
`<*>CategoryCreatedResponseDto` / `<*>CategoryDetailResponseDto`
declared in Scalar.

**Old `POST` response shape:**

```jsonc
{ "id": "uuid", "created_at": "...", "deleted_at": null }
```

**Old `PATCH` response shape:**

```jsonc
{ "message": "Category updated", "data": null }
```

**New shape (both):**

```jsonc
{
  "message": "Category created",
  "data": {
    "id": "uuid",
    "created_at": "...",
    "deleted_at": null,
    "post_category_translations": [
      { "lang": "ar", "title": "أخبار", "slug": "akhbar", "description": null },
      { "lang": "en", "title": "News",   "slug": "news",   "description": null }
    ],
    "translation": { "lang": "ar", "title": "أخبار", "slug": "akhbar", "description": null }
  }
}
```

This is a **breaking change for the `PATCH` endpoints only** — anyone
who was specifically reading `data === null` to short-circuit needs to
update. The CMS likely wasn't, since the controllers' OpenAPI
`@ApiOkResponse` always declared the full DTO; reality just didn't
match until now.

### 14.4 Trash listings now include `translation` + stripped slugs

Eight endpoints —

```text
GET /api/v1/posts/trash              GET /api/v1/post-categories/trash
GET /api/v1/books/trash              GET /api/v1/book-categories/trash
GET /api/v1/gallery/trash            GET /api/v1/gallery-categories/trash
GET /api/v1/academic-papers/trash    GET /api/v1/academic-paper-categories/trash
```

— now include a resolved `translation` field on every item, and the
`__del_<timestamp>` suffix is stripped from
`<resource>_translations[].slug` before serialisation. Matches what the
controllers' Swagger docstrings already promised.

The CMS trash view can stop running the suffix-strip in JS and stop
defaulting `translation` to the first array element — both are now
authoritative server-side.

### 14.5 `POST /media/confirm` — new 410 case for expired uploads

If a CMS user lets a pre-signed upload URL sit for more than 15 minutes
before calling `/media/confirm`, the confirm now fails fast:

```jsonc
// HTTP 410 Gone
{
  "success": false,
  "error":   "Upload URL has expired — request a new one",
  "timestamp": "...",
  "path": "/api/v1/media/confirm"
}
```

Previously the confirm succeeded as long as the row hadn't been
cleaned up by the hourly cron (so the window where you could
successfully confirm a stale upload was up to 60 minutes). On 410,
prompt the user to re-pick the file and call `/media/upload-url` again.

### 14.6 Rate limits on the media-upload endpoints

```text
POST /api/v1/media/upload-url   60 requests / minute / IP
POST /api/v1/media/confirm      60 requests / minute / IP
```

Returned as a standard `429` envelope (`TooManyRequestsErrorDto`).
Normal interactive uploads are well under this cap; only batched /
scripted migrations need to pace themselves. The previous global
throttler (1000 / 15 min) still applies on top.

### 14.7 `PATCH /media/:id` — request DTO trimmed

`UpdateMediaDto` now accepts **only** `filename` and `alt_text`.
Sending any of `mime_type`, `file_size`, `width`, `height` returns a
400 validation error. Previously those fields were accepted and
silently ignored, because R2's `HeadObject` is the authoritative source
for them at confirm time — there is no scenario where the CMS should
overwrite them.

If the CMS form was including these fields in the PATCH body (most
likely from a generic "edit media metadata" form), drop them — keeping
them around will now break the request.

### 14.8 `POST /forms/qutuf-sajjadiya-contest/start` — new `attempt_token` field

The `/start` response now includes an `attempt_token` alongside
`attempt_id`:

```jsonc
{
  "message": "Contest started",
  "data": {
    "attempt_id":    "9f86d081-...",
    "attempt_token": "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"
  }
}
```

The token is an HMAC-SHA256 of the attempt id with a server-side
secret. Pass it back in the `/submit` body:

```jsonc
POST /api/v1/forms/qutuf-sajjadiya-contest/submit
{
  "attempt_id":    "9f86d081-...",
  "attempt_token": "9f86d081884c...",
  "answers":       [ /* ... */ ]
}
```

**Rollout policy: optional today, will become required.** Submits
without `attempt_token` continue to work and log a server-side warning
so we can track adoption. A wrong token returns 401 immediately. Once
the contest UI is shipping the token, we'll flip the validator to
required (will be communicated in a follow-up round).

Without token-binding, anyone who guesses or intercepts an
`attempt_id` can submit on behalf of the contestant. With it, they
also need the matching token, which never leaves the contestant's
device.

### 14.9 `/dashboard/stats` — new `forms.unsent_notifications` counter

```jsonc
"forms": {
  "contact_new": 4,
  "contact_recent": 11,
  "proxy_visit_pending": 2,
  "proxy_visit_recent": 5,
  "unsent_notifications": 0   // ← new
}
```

Count of `contact_submissions` + `proxy_visit_requests` whose admin
notification email failed. A non-zero value is an operational alert
(stale SMTP credentials, mail provider outage, etc.) — the row was
still saved, just the notification didn't go out. Surface it on the
CMS home screen so the team isn't flying blind on email failures.

Requires the migration in [14.1](#141-new-migration-to-apply). Until
applied, the column doesn't exist and Prisma queries against it will
fail — the column-existence check is the only deploy-ordering
constraint in this round.

### 14.10 New audit-log action: `NEWSLETTER_CAMPAIGN_COMPLETED`

The newsletter campaign sender now writes one audit row per campaign
at the `sending → sent` transition. The `changes` JSON carries the
final counters:

```jsonc
{
  "action":         "NEWSLETTER_CAMPAIGN_COMPLETED",
  "resource_type":  "newsletter_campaign",
  "resource_id":    "<campaign_uuid>",
  "user_id":        null,                       // system-driven, no actor
  "changes": {
    "delivered_count": 1247,
    "failed_count":    3,
    "recipient_count": 1250
  }
}
```

Add to the audit-log dashboard's known-action list. The other newsletter
campaign actions (`*_CREATED`, `*_UPDATED`, `*_DELETED`, `*_CANCELLED`,
`*_SEND_QUEUED`) are unchanged.

Related correctness fix on the same sender: a subscriber who
unsubscribes **between** `/send` (which snapshots all recipients) and
the per-tick processing now correctly skips the send. The recipient
row is marked `failed_at` with
`error_message: 'Subscriber unsubscribed before send'`. No CMS code
change; surfaces only in the per-campaign recipient breakdown if you
expose one.

### 14.11 Audit-log `changes` JSON — sensitive keys are now stripped

Defence-in-depth. The audit-log read endpoint (`GET /audit-logs`,
permission `audit-logs:read`) returns `changes` verbatim, so any
service that accidentally writes a sensitive value through that field
would leak it. The `AuditService.write()` path now strips a recursive
deny-list before persist:

```text
password, password_hash, new_password, old_password,
token, access_token, refresh_token,
secret, api_key, authorization
```

Matching is case-insensitive and applies to nested objects + arrays of
objects. No current call site writes these keys (we audited); this is
purely a guard against future regressions.

The CMS audit-log viewer will never see these keys. If any historical
audit row already contained one, it was persisted before this guard —
not retroactively stripped.

### 14.12 `assignRole` is now idempotent

```text
POST /api/v1/users/:id/roles  { "role_id": "<role-already-assigned>" }
```

Now returns 200 with the user detail unchanged, **without** writing a
new `user_roles` row, **without** emitting a
`ROLE_ASSIGNED_TO_USER` audit row. Previously it wrote a no-op audit
row every time — useful nowhere, noisy in the audit-log dashboard.

Re-assignment via the CMS role picker is now safe to spam; the audit
trail only reflects state changes.

### 14.13 `DELETE /users/:id/roles/:roleId` — specific 404 message

Previously, removing an unassigned role returned the generic Prisma
P2025 fallback (`error: "Record not found"`). Now:

```jsonc
// HTTP 404
{ "success": false, "error": "Role is not assigned to this user", ... }
```

The CMS can surface the error verbatim in the role-management UI's
toast.

### 14.14 No-action items also shipped this round

These are either runtime-compatible or invisible to the CMS:

- **Newsletter sender has a re-entrancy guard.** If a `runSendingTick`
  cron run is still in flight when the next tick fires (large
  campaigns, slow SMTP), the second tick now skips with a log line
  instead of double-sending to the same recipients. Same wire surface;
  observable only if you have alerts on duplicate sends — there
  shouldn't be any.
- **Variant generation now gated server-side** at 2 concurrent jobs
  per process (`p-limit`). Sequential `/media/confirm` calls work
  exactly as before; bursty parallel uploads will see individual
  `confirm` calls take longer (queued internally) but never OOM the
  dyno. No new error codes.
- **YouTube playlist sync wrapped in `$transaction`.** Internal —
  closes a window where a sync crash between `deleteMany` and
  `createMany` left a playlist temporarily empty.
- **YouTube bootstrap sync now skipped if `last_synced_at < 6h ago`.**
  Restart loops no longer burn YouTube Data API quota. The 6-hour cron
  is unchanged.
- **`PostSummaryDto.post_attachments?` now declared in OpenAPI.** The
  field was already being shipped by `GET /posts/admin` list payloads
  (the first attachment, capped at one item, for thumbnail rendering).
  Generated clients can now type it correctly — was missing from the
  spec before this round.
- **`PATCH /users/:id` mass-assignment closed.** The service now
  builds an explicit `Prisma.usersUpdateInput` instead of spreading
  `dto`. Same wire request today (only `username` is in `UpdateUserDto`);
  guards against future DTO fields silently becoming writable.

### 14.15 New env var (optional)

```text
CONTEST_ATTEMPT_SECRET     # optional — falls back to JWT_SECRET
```

Used to sign the contest `attempt_token`. Set a distinct value only if
you want to rotate the contest signing key without invalidating JWTs.
Refuses to boot if **neither** `CONTEST_ATTEMPT_SECRET` nor `JWT_SECRET`
is set — same fail-loud policy as the newsletter unsubscribe secret in
round 9.

### 14.16 Explicitly skipped — for transparency

Two items in the pre-release audit were considered and intentionally
not shipped:

- **CAPTCHA on public forms** (`/forms/contact`, `/forms/proxy-visit`).
  Current per-IP throttler at 300/hr/IP is enough at present spam
  volume; revisit if the contact form starts seeing bot floods.
  Recommended provider when needed: Cloudflare Turnstile (lower
  friction than hCaptcha for genuine users).
- **Contest timing enforcement.** The Qutuf Sajjadiya contest is
  intentionally **not** time-bounded. The `started_at` /
  `submitted_at` columns are stored for analytics ("how long did each
  contestant take?"), not for enforcement. No "time limit exceeded"
  rejection will ever fire.

---

## 15. Performance pass + multi-instance readiness

A broad performance + design-correctness audit, applied in one push. The
goal: cheap wins on the request path, plus the design changes needed to
scale beyond a single dyno without surprises. Wire-level breaking
changes are minimal and called out in 15.2 and 15.4. The rest is
transparent to the CMS.

### 15.1 New migration to apply

```text
prisma/migrations/20260528120000_perf_partial_indexes/migration.sql
```

Adds partial indexes that the planner now uses for the hottest queries:

- `idx_posts_live_published_at` — `WHERE deleted_at IS NULL` on posts
  sorted by `published_at DESC, created_at DESC`. Replaces a sequence
  scan with an index-only scan on the public post feed.
- `idx_books_live_created_at`, `idx_academic_papers_live_created_at`,
  `idx_gallery_images_live_created_at` — same idea on the other
  soft-deletable content tables.
- `idx_contact_submissions_submitted_at`,
  `idx_proxy_visit_requests_submitted_at` — for forms list ordering
  and dashboard time-window queries.
- `idx_contact_submissions_notif_failed`,
  `idx_proxy_visit_requests_notif_failed` — sparse partial indexes
  serving the `unsent_notifications` dashboard count in effectively O(1).

Apply with:

```bash
npx prisma migrate deploy
```

Idempotent (`CREATE INDEX IF NOT EXISTS`). The migration runs in a
single transaction, so the brief lock is acceptable on every env we
target.

### 15.2 List endpoints — slimmer response payloads (BREAKING)

The four heaviest list endpoints — `GET /posts`, `GET /books`,
`GET /academic-papers`, `GET /gallery` — and their `/trash` variants now
return **slimmer translation objects**. The detail endpoints
(`GET /posts/:id`, `GET /posts/by-slug/:slug`, `GET /books/:id`, …)
still return the full shape; only list payloads changed.

| Endpoint | Field dropped from each translation in `items[]` |
| --- | --- |
| `GET /posts`, `GET /posts/trash`, `GET /posts/admin` | `body` |
| `GET /books`, `GET /books/trash` | `description` |
| `GET /academic-papers`, `GET /academic-papers/trash` | `abstract` |
| `GET /gallery`, `GET /gallery/trash` | `description` |

A typical list page shrinks **80–95%** in bytes. The dropped fields are
free-text rich-text / multi-paragraph fields that were 5–50 KB each per
translation per row, multiplied by page size — most of the response.

Two side effects to handle:

- **`reading_time_minutes`** on post-list translations is now always
  `0`. The value is derived from the `body` text length, which the list
  endpoint no longer fetches. Call the detail endpoint when you need
  the real reading time.
- **Category includes** are still present, but `media` (cover image)
  carries only the public-facing fields: `id`, `url`, `filename`,
  `alt_text`, `mime_type`, `width`, `height`. The `created_at`,
  `uploaded_by`, `file_size` columns were never useful in a list view
  and are no longer shipped.

CMS action: detail-on-hover, expand-to-read, or any UI that wanted
`body` from the list response needs to call the detail endpoint
instead. The `id` and `slug` on the list payload are sufficient to do
so cheaply (both are indexed).

### 15.3 Search — same wire, uses Postgres trigram indexes now

`GET /search` returns the same response shape, but the implementation
switched from Prisma's `contains` filter (compiles to `ILIKE '%q%'`,
which the GIN indexes from round 6 cannot serve because of the leading
wildcard) to a two-stage query using the `%` similarity operator.
Stage 1 hits the GIN index and ranks by `pg_trgm` similarity score;
stage 2 hydrates the top N rows with Prisma's typed models.

Net effect: same response, **sub-10 ms** even on the largest corpus,
and results are now ranked by relevance (best match first) instead of
the previous `published_at DESC` fallback.

No CMS or front-end change required.

### 15.4 `POST /media/confirm` — variants are now generated in background (BREAKING)

Variant generation previously ran synchronously inside the confirm
request — the response held the freshly written `variants[]` array. A
20 MB image meant 2–5 seconds of `sharp` work blocking the request.

The confirm now returns **immediately** with an **empty `variants: []`
array**. Generation runs on the next event-loop tick, gated by the same
`p-limit(2)` from round 14.

CMS action:

- If the CMS shows the variants in the upload UI, **poll `GET /media/:id`**
  (every ~500 ms is fine) until `variants.length === 4` — typically
  1–3 seconds after confirm.
- If the CMS just stages the original and lets the public site render
  it, no change — the original `url` is fully usable; variants
  populate transparently.
- The `variants_generated` field in the `MEDIA_CREATED` audit row is
  now the literal string `"pending"` instead of a count. If you read
  this in an audit-log viewer, treat the field as informational.

Failures still surface the same way: empty `variants[]` after the
poll-window means call `POST /media/:id/regenerate-variants`.

### 15.5 Audit-log writes are fire-and-forget

`AuditService.write()` now schedules the DB insert via `setImmediate`
and returns immediately. The request handler no longer pays the audit
round-trip. Failure policy is unchanged (log + swallow); compliance
callers that need synchronous persistence can use the new
`AuditService.writeSync()`.

Net effect on the CMS: every mutation endpoint (`POST /posts`,
`PATCH /books/:id`, every bulk operation, …) is **~50–100 ms faster**
end-to-end. The audit row appears in `GET /audit-logs` within
milliseconds of the response, not before it.

No code change required. A new batched helper
`AuditService.writeMany()` is used internally by bulk endpoints so a
200-row publish batch issues one `INSERT` instead of 200.

### 15.6 Pagination limit is clamped server-side

`?limit=999999` previously could scan a whole table when the request
bypassed the DTO (custom controllers, internal calls). `limit` is now
clamped to `[1, 100]` inside `resolvePagination` itself, on top of the
existing `class-validator` constraint on the DTO. No behaviour change
for compliant clients; defence-in-depth against future endpoints that
forget the DTO.

### 15.7 New cron — `audit_logs` retention (one year)

A daily sweep at **03:30 server time** drops `audit_logs` rows older
than **365 days**. Without it, the table grows unbounded and the
planner cost on `idx_audit_logs_created_at` slowly degrades.

Retention constant: `AUDIT_LOG_RETENTION_DAYS = 365` in
`src/common/audit/audit.service.ts`. Lengthen it if a future compliance
requirement (longer legal-hold periods, data-residency) demands it —
the cleanup query honours whatever the constant says.

CMS implication: the audit-log viewer should not assume entries are
available forever. Older queries return empty result sets, not errors.

### 15.8 New cron — `refresh_tokens` cleanup

A daily sweep at **03:15 server time** drops:

- Tokens past their `expires_at` (already useless).
- Tokens with `revoked_at` older than 30 days (past the reuse-detection
  grace window).

The 30-day grace keeps the reuse-detection path from round 1 working;
beyond that, the row is dead weight. No CMS-visible behaviour change.

### 15.9 Response compression upgraded — brotli when the client accepts it

The `compression` middleware was replaced with a small custom
middleware ([src/common/middleware/compression.middleware.ts](../src/common/middleware/compression.middleware.ts))
that picks **brotli** when the client's `Accept-Encoding` includes
`br`, falls back to **gzip** otherwise. Quality level 4 — the sweet
spot for JSON. Skips bodies under 1 KB. Honours
`Cache-Control: no-transform`.

Net effect: **~15% smaller** payloads to any modern browser,
transparent to the client. No CMS or front-end action.

### 15.10 Optional Redis — multi-instance readiness

Two design issues that didn't matter at one instance but would silently
break at N instances are now both addressed via an **optional** Redis
dependency. Setting `REDIS_URL` opts in; leaving it unset keeps current
behaviour.

**Throttler (`@nestjs/throttler`):** counters lived in an in-memory map
per process. With N processes that meant N independent buckets — the
1000/15min global ceiling effectively became 1000×N. Now backed by
`@nest-lab/throttler-storage-redis` when `REDIS_URL` is set; one
shared counter per IP across the fleet.

**JWT user cache (round 14 perf):** invalidations
(`invalidateJwtUserCache`) cleared only the local process's cache.
Logout / password change / soft-delete on instance A left instance B
serving the stale row for up to 30 seconds (the cache TTL). The
strategy now subscribes to a Redis pub/sub channel
(`jwt-cache:invalidate`) and propagates invalidations cluster-wide in
single-digit milliseconds.

**Failure mode:** if `REDIS_URL` is set but the Redis instance is
unreachable, the API still boots — ioredis retries with exponential
backoff, throttler degrades to in-memory counters until reconnection,
JWT pub/sub starts working again on reconnect. No request path blocks
on Redis being up.

No CMS code change required. Set `REDIS_URL` only when you scale to
>1 instance.

### 15.11 Pre-warmed caches at boot

`SettingsService`, `LanguagesService`, and `ContestService` now hit
their respective tables once on `OnApplicationBootstrap` to populate
in-process caches before the dyno accepts traffic. Eliminates the
cold-cache cost on the first request after every deploy. Best-effort —
a failed pre-warm logs a warning but doesn't block boot.

No CMS-visible change. The dashboard cold-start render is just
noticeably snappier post-deploy.

### 15.12 New optional env var: `REDIS_URL`

```text
REDIS_URL              # optional; format: redis://… or rediss://…
                       # Enables 15.10 (shared throttler + JWT pub/sub).
                       # When unset, both fall back to in-process state —
                       # fine for single-instance deployments.
```

Add it to deployment env when scaling to >1 instance; leave it unset
for dev and single-instance prod. The validator accepts any string;
ioredis itself rejects malformed URLs at boot.

### 15.13 No-action items also shipped this round

These are either runtime-compatible or invisible to the CMS:

- **Newsletter sender concurrency.** SMTP sends within a batch now run
  with `p-limit(5)` instead of fully sequential. A 50-recipient tick
  finishes in single-digit seconds instead of nearly a minute. Same
  wire surface; visible only as a faster `delivered_count` progression
  on the campaign detail view.
- **Newsletter recipient population** uses `INSERT ... SELECT` instead
  of fetching the subscriber list into Node memory. Matters at scale
  (50k+ subscribers); transparent otherwise.
- **Bulk post operations** (`POST /posts/bulk/publish`,
  `POST /posts/bulk/delete`) now issue at most 2 `updateMany` calls
  plus one batched audit insert, instead of N sequential `update` +
  audit pairs. A 200-row batch goes from ~200 round-trips to ~3. Same
  request and response.
- **Scheduled-publish cron** is now one `updateMany` + one batched
  audit insert per tick. Same observable behaviour.
- **Posts soft-delete** is now a single raw `UPDATE` on
  `post_translations` to suffix every slug, then one update on
  `posts`. Was previously a loop of N updates inside the transaction.
- **`ResponseInterceptor` mutates in place** instead of allocating a
  new envelope object per response. Sub-millisecond per request, but
  every authenticated request pays it.
- **JWT validation cache.** Added in round 14 (see 14 perf notes);
  this round's pub/sub-driven invalidation (15.10) is what makes it
  safe across instances.

---

## 16. Round 11 (this push) — static pages, stores, slugs + SEO, restore parity

### Schema migration to apply first

```bash
psql "$DIRECT_URL" -f prisma/migrations/20260528150000_static_pages_and_stores/migration.sql
psql "$DIRECT_URL" -f prisma/migrations/20260607120000_book_paper_slugs_and_seo_meta/migration.sql
npm run prisma:pull && npm run prisma:generate
npm run prisma:seed     # adds static-pages:* and stores:* permissions + role grants
```

Both migrations are additive + idempotent. **Until they're applied, writes to
the affected resources will fail** (the client expects the new columns); reads
of existing data are unaffected.

### Static pages (`/static-pages`) — now live

A previously-built-but-unwired module is now registered. Canonical
rarely-changing pages (biography, about, …) with one row per page and one
translation per language (`title`, `slug`, `body` + SEO fields). Full CRUD +
trash/restore + publish toggle. Public `GET /static-pages`,
`/static-pages/by-slug/:slug`, `/static-pages/:id` (published only); admin
`GET /static-pages/admin` + `/static-pages/admin/:id` reach drafts. New
permissions: `static-pages:{read,create,update,delete}`.

> **Security note:** `GET /static-pages/:id` is published-only — an unpublished
> draft is **not** readable by UUID. Use the admin route for drafts.

### Stores (`/stores`) — new module

"Where to buy / visit us". A `store` is a city (translated `city_name`); each
city has one or more nested **sale-points** (`store_locations`) with phone +
GPS (`gps_embed_url`, `gps_link`) and translated `name` + `address`. Public
`GET /stores`, `/stores/:id`; admin CRUD under `stores:{create,update,delete}`
(public reads need no permission — there is no `stores:read`). Manage
sale-points via the nested routes: `POST /stores/:id/locations`,
`PATCH /stores/:storeId/locations/:locationId`, `DELETE …`.

### Books & academic papers — optional slugs + `by-slug`

Both now accept an **optional** per-translation `slug` (lowercase latin, unique
per language), exposed at `GET /books/by-slug/:slug` and
`GET /academic-papers/by-slug/:slug`. Existing rows have no slug until an editor
sets one (nullable; `by-slug` 404s until then). The homepage `publications`
payload now returns the real slug when present, falling back to the UUID.

### SEO meta on detail payloads

Static pages, books, and academic papers gained per-translation `meta_title`,
`meta_description`, and `og_image_id` (matching posts). **Detail** endpoints
resolve `og_image_id` into a usable `og_image` object; posts' `og_image` is now
resolved too (it previously returned a bare UUID).

### `media.variants[]` on content payloads

Posts, books, and gallery list **and** detail payloads now include
`media.variants[]` (`{ id, width, url, format }`). Responsive `<img srcset>`
works straight off any content endpoint — previously the variants were only on
`GET /media/:id`.

### Machine-readable error `code`

Every error envelope now carries a stable `code` (e.g. `VALIDATION_FAILED`,
`NOT_FOUND`, `RATE_LIMITED`, and specific auth codes like `AUTH_TOKEN_REUSED`).
Branch on `code` instead of string-matching `error`. See the catalogue in
[integration.md](integration.md#error-code-catalogue).

### Restore parity

`users`, `newsletter` subscribers, and `forms` (contacts + proxy-visits) now
expose `GET /<resource>/trash` + `POST /<resource>/:id/restore`, gated by the
existing `:delete` permission. User restore reverses the username suffix (409
if reclaimed).

### Sitemap coverage

`sitemap.xml` now includes static pages and any books/papers that have a slug,
each with hreflang alternates.

### Multi-instance correctness — YouTube sync

The 6-hour YouTube mirror cron is now gated by a Postgres advisory lock + a
recency check, so a fleet of N instances performs exactly one sync per window
instead of N (which could exhaust the YouTube Data API quota).

---

## 17. Round 12 (this push) — audios library (i18n + speakers)

### Schema migration to apply first

```bash
psql "$DIRECT_URL" -f prisma/migrations/20260608120000_audios/migration.sql
npm run prisma:pull && npm run prisma:generate
npm run prisma:seed              # adds audios:* permissions + role grants
npm run prisma:seed-content      # seeds audios + ar translations + deduped speakers
npm run prisma:reconcile-audios  # (optional) draft-import any CDN file not in the JSON
```

Additive + idempotent. The migration creates four tables: `speakers`,
`speaker_translations`, `audios`, `audio_translations`. Until applied, audio
writes fail (the client expects the new tables); existing data is unaffected.

### Data model

- **`audios`** — language-agnostic core: `audio_url` (MP3 on R2, **unique** —
  the reseed/reconcile key), optional `pdf_url`, a single canonical `slug`,
  `speaker_id` (FK → speakers, nullable), `duration_seconds`, `size_mb`, `peaks`
  (≤300-point waveform, jsonb), `is_published`. No view counter, no `legacy_id`.
- **`audio_translations`** — `title` per language, `is_default`.
- **`speakers` / `speaker_translations`** — a first-class lecturer entity:
  `name` per language (no slug/bio). Browse-by-speaker is the primary navigation
  (there is no category dimension).

Every response resolves the request-language `translation` (via
`Accept-Language`, falling back to the default) and embeds the resolved
`speaker`. **Dropped from the old flat design:** `categories`, `duration`/`size`
strings, `bitrate`, `sample_rate`, `codec`, `is_vbr`, `search_text` — search now
trigram-matches `audio_translations.title` + `speaker_translations.name`.

### Endpoints

- **Audios — public:** `GET /audios` (`?speaker_id=` + `?search=`, newest-first,
  drops `peaks`), `GET /audios/by-slug/:slug`, `GET /audios/:id` (includes
  `peaks`).
- **Audios — admin** (`audios:read|create|update|delete`): `GET /audios/admin`
  + `/admin/:id` (drafts), `POST /audios`, `PATCH /audios/:id`,
  `PATCH /audios/:id/publish`, `GET /audios/trash`, `POST /audios/:id/restore`,
  `DELETE /audios/:id`. Create/update take a `translations[]` array (exactly one
  `is_default`), an optional `speaker_id`, and an optional canonical `slug`.
- **Speakers — public:** `GET /speakers` (with live-published `audio_count`),
  `GET /speakers/:id`.
- **Speakers — admin** (reuses `audios:*` permissions): `POST /speakers`,
  `PATCH /speakers/:id`, `GET /speakers/trash`, `POST /speakers/:id/restore`,
  `DELETE /speakers/:id` (409 if live audios still reference it).
- **Uploads:** `POST /audios/upload-url` returns a pre-signed R2 PUT for an
  mp3/m4a (≤ 300 MB) or pdf (≤ 50 MB) under the `audio/` prefix. Send the same
  `Content-Type` on the PUT as you declared, then save the returned `publicUrl`
  onto the record (no confirm step). `maxBytes` is advisory.

Audios are wired into `GET /search`, the dashboard stats
(`audios: { total, published, drafts }`), and `sitemap.xml` (published + slugged
translations, with hreflang alternates like books). Soft-delete suffixes each
translation slug (restore reverses it, 409 on conflict).

### CMS upload — extracting duration / size / peaks in the browser

The metadata in the JSON (`durationSeconds`, `sizeMB`, `peaks[300]`) is produced
**client-side at upload time** and POSTed with the create request. Do **not**
re-derive it on the server — the browser already holds the file. The recommended
"smart" extractor decodes real PCM (the old byte-method read raw compressed MP3
bytes, which is noise, not loudness) and downsamples at 8 kHz mono so even a
99-minute lecture decodes fast:

```ts
const PEAK_COUNT = 300;

export async function extractAudioMeta(file: File): Promise<{
  durationSeconds: number; sizeMB: number; peaks: number[];
}> {
  const sizeMB = +(file.size / 1048576).toFixed(2);
  const raw = await file.arrayBuffer();

  // Decode once at a low sample rate — plenty for a 300-point envelope, and
  // an order of magnitude less work than full-resolution decode.
  const probe = new AudioContext();
  const meta = await probe.decodeAudioData(raw.slice(0));
  await probe.close();
  const durationSeconds = Math.round(meta.duration);

  const offline = new OfflineAudioContext(1, Math.ceil(meta.duration * 8000), 8000);
  const buf = await offline.decodeAudioData(raw);
  const data = buf.getChannelData(0);
  const block = Math.floor(data.length / PEAK_COUNT) || 1;

  const peaks: number[] = [];
  for (let i = 0; i < PEAK_COUNT; i++) {
    let max = 0;
    for (let j = i * block; j < Math.min((i + 1) * block, data.length); j++) {
      const v = Math.abs(data[j]);
      if (v > max) max = v;
    }
    peaks.push(max);
  }
  // Normalise the envelope to its 95th percentile so quiet lectures still fill
  // the waveform; clamp to [0,1] and round to keep the payload small.
  const sorted = [...peaks].sort((a, b) => a - b);
  const p95 = sorted[Math.floor(sorted.length * 0.95)] || 1;
  return {
    durationSeconds,
    sizeMB,
    peaks: peaks.map((p) => +Math.min(1, p / p95).toFixed(4)),
  };
}
```

POST the three values on `CreateAudioDto`. The API validates `peaks` (≤300
floats in 0–1) and stores them verbatim; it never decodes audio itself. Fields
are all optional — omit them for an API-only upload and backfill later.

> **Consistency note:** the seeded records use the older byte-method peaks
> (rough), while new CMS uploads use real PCM (accurate). Both render fine; if
> you want a uniform look, re-analyse the legacy set with the PCM method later.

### Reconcile — every CDN file gets a row

`npm run prisma:reconcile-audios` lists the R2 `audio/` prefix and creates a
**draft** (`is_published=false`) for any object with no `audios` row, parsing
`title`/`speaker` from the `"<title> - <speaker>.mp3"` filename and deduping
speakers by Arabic name. `peaks`/`duration`/`size` are left null for an editor
to fill in. Idempotent (matches by R2 key); `-- --dry` reports without writing.

---

## 18. Open follow-ups (still not in this push)

- Self-service password reset flow (would need an `email` column on
  `users` plus the `password_reset_tokens` table described in the
  migration header).
- Tags many-to-many (deferred — structural decision).
- 2FA on admin accounts (skipped — high-trust in-house deployment).
- Personal access tokens (skipped — no automation needs today).
- Versioning / revision history on content edits.
- Sitemap-index / chunked sub-sitemaps once published-post count
  approaches the 50k-URL cap (likely years away).
- PDF uploads through `/media/*` (cap infrastructure is in place at
  `MAX_BYTES_BY_MIME`, but `application/pdf` is not on the MIME
  allowlist yet — academic-paper `pdf_url` is still externally hosted).
