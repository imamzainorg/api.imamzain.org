# Integration Guide

The reference companion to the OpenAPI spec at [`/docs`](https://api.imamzain.org/docs).
Scalar tells you what each endpoint does; this document covers the
cross-cutting concepts a CMS / front-end developer needs once, then
reuses everywhere.

- [Response envelope](#response-envelope)
- [Error envelope + error codes](#error-envelope--error-codes)
- [Pagination](#pagination)
- [List filters and request validation](#list-filters-and-request-validation)
- [Books — multi-part series and the Publications flag](#books--multi-part-series-and-the-publications-flag)
- [Authentication flow](#authentication-flow)
- [Authorisation (permissions)](#authorisation-permissions)
- [Language resolution](#language-resolution)
- [Soft delete and restore](#soft-delete-and-restore)
- [Media upload (two-step flow)](#media-upload-two-step-flow)
- [Rich-text body sanitisation](#rich-text-body-sanitisation)
- [Newsletter double opt-in](#newsletter-double-opt-in)
- [Newsletter unsubscribe scheme](#newsletter-unsubscribe-scheme)
- [Newsletter campaign delivery](#newsletter-campaign-delivery)
- [Form submissions (admin workflow)](#form-submissions-admin-workflow)
- [Rate limiting](#rate-limiting)
- [Public URL conventions](#public-url-conventions)
- [Cron schedules](#cron-schedules)
- [Required environment variables](#required-environment-variables)

---

## Response envelope

Every JSON response from the API (success and error alike) wraps its
payload in a fixed envelope. Front-end clients can rely on these
top-level keys being present.

### Success

```jsonc
{
  "success": true,
  "timestamp": "2026-05-11T12:00:00.000Z",
  "message": "Posts fetched",
  "data": { /* endpoint-specific shape */ }
}
```

- `success` — always `true` for 2xx responses.
- `timestamp` — ISO 8601 UTC, the server's response time.
- `message` — short human-readable hint; suitable for toast notifications
  on the CMS side, **not** for end-user copy on the public site.
- `data` — endpoint-specific. For list endpoints, contains
  `{ items: [...], pagination: { … } }`.

### Error

```jsonc
{
  "success": false,
  "code": "VALIDATION_FAILED",
  "error": "Validation failed: title must not be empty",
  "timestamp": "2026-05-11T12:00:00.000Z",
  "path": "/api/v1/posts",
  "requestId": "req-abc123",
  "errors": ["title must not be empty"]   // present on 400 only
}
```

- `code` — **stable, machine-readable error code.** Branch on this for
  error i18n and retry logic instead of string-matching `error`. Always
  present. Defaults to a status-derived value; some endpoints return a
  more specific code (see the catalogue below).
- `error` — short human description. Safe to log; **not** safe to render
  verbatim on the public site (`requestId` and `path` are debug info).
- `requestId` — propagates to server logs; quote it when reporting
  issues.
- `errors` — present on 400 validation failures; each item is one
  failed field rule.

### Error code catalogue

Every error carries a `code`. The status-derived defaults:

| `code` | HTTP | Meaning |
| --- | --- | --- |
| `BAD_REQUEST` | 400 | Generic bad request |
| `VALIDATION_FAILED` | 400 | DTO validation failed — see `errors[]` |
| `UNAUTHORIZED` | 401 | Missing / invalid credentials |
| `FORBIDDEN` | 403 | Authenticated but lacks the permission |
| `NOT_FOUND` | 404 | Resource doesn't exist or was soft-deleted |
| `CONFLICT` | 409 | Uniqueness / state conflict |
| `FK_CONSTRAINT_VIOLATION` | 400 | Referenced record doesn't exist |
| `INVALID_IDENTIFIER` | 400 | Malformed UUID in an id path/query param (used to surface as 500 on some routes, or as `BAD_REQUEST` "Validation failed (uuid is expected)" on others — every resource route, including audit-logs, newsletter subscribers/campaigns and media, now answers this one shape) |
| `PAYLOAD_TOO_LARGE` | 413 | Upload / body over the size cap |
| `RATE_LIMITED` | 429 | Throttle limit hit |
| `INTERNAL_ERROR` | 500 | Unhandled server error |

Endpoint-specific overrides (more precise than the status default):

| `code` | HTTP | Where |
| --- | --- | --- |
| `AUTH_REFRESH_INVALID` | 401 | `POST /auth/refresh` — token unknown or expired |
| `AUTH_TOKEN_REUSED` | 401 | `POST /auth/refresh` — an already-rotated token was replayed **outside** the reuse-grace window (`REFRESH_REUSE_GRACE_SECONDS`, default 10 s); only **that token's session (its token family)** is revoked — other devices are untouched. Treat any 401 from `/auth/refresh` as "session over → login form" |
| `AUTH_REFRESH_ALREADY_ROTATED` | 401 | `POST /auth/refresh` — lost the rotation race; retry once with the newest token |
| `AUTH_ACCOUNT_DISABLED` | 401 | The account was soft-deleted; re-auth won't help |
| `AUTH_LOGIN_LOCKED` | 429 | `POST /auth/login` — too many failed attempts for that username; `Retry-After` (seconds) says how long. Even the right password is refused meanwhile |
| `PASSWORD_MUST_DIFFER` | 400 | `PATCH /auth/me/password` — the account is flagged `must_change_password` and `newPassword` equals `currentPassword` |
| `PASSWORD_CHANGE_REQUIRED` | 403 | Any authenticated route (except `/auth/me`, `/auth/me/password`, `/auth/logout`, `/auth/refresh`) when the account is flagged `must_change_password` and `ENFORCE_PASSWORD_CHANGE_AFTER_RESET=true` |
| `SLUG_LOCKED_WHILE_PUBLISHED` | 409 | `PATCH` of a published post, static page or book with a different `slug` — unpublish it first (or send `is_published: false` in the same request). Renaming a live slug would break its public URL |
| `CHECK_CONSTRAINT_VIOLATION` | 400 | A value broke a database rule that no DTO caught (e.g. a book `part_number` beyond `parts`); the message names the constraint |
| `DUPLICATE_TRANSLATION_LANG` | 400 / 409 | The same `lang` appears twice in a `translations[]` array on create/update — `400` on daily hadiths, `409` on the four `*-categories` resources and `POST /gallery` |
| `SLUG_ALREADY_USED` | 409 | `POST/PATCH` on the four `*-categories` resources — a `(lang, slug)` already used by another category |
| `GALLERY_IMAGE_EXISTS` | 409 | `POST /gallery` — that `media_id` is already a gallery entry (a gallery entry's primary key *is* its media id) |
| `GALLERY_IMAGE_IN_TRASH` | 409 | `POST /gallery` — that `media_id` already has a gallery entry sitting in the trash; restore it (`POST /gallery/:id/restore`) instead |
| `AUDIO_SPEAKER_DELETED` | 409 | `POST /audios/:id/restore` — the audio's speaker is in the trash; restore the speaker first, then retry |
| `MEDIA_IN_USE` | 409 | `DELETE /media/:id` — still referenced by a post/book/static-page/gallery item; see `GET /media/:id/references` |
| `SMTP_NOT_CONFIGURED` | 503 | `POST /newsletter/campaigns/:id/send` and `/retry` — the server has no SMTP settings, so nothing can be sent; the campaign is left untouched |

Every error response — of any status, on any route — also carries
`Cache-Control: no-store`, so a 404/400/429 is never held at a CDN edge
even when the route is otherwise cacheable.

New codes may be added over time; treat an unrecognised `code` as its
HTTP-status default.

---

## Error envelope + error codes

The API uses standard HTTP status codes. Map them in the front-end as
follows:

| Status | Meaning | What the CMS should do |
| --- | --- | --- |
| 400 Bad Request | Validation failed | Surface `errors[]` next to the corresponding form fields |
| 401 Unauthorized | JWT missing / expired / invalid, or password mismatch | Redirect to login; on refresh failure, clear local tokens |
| 403 Forbidden | Authenticated, but lacks the required permission | Show a "you don't have permission" notice; hide the action button on next render |
| 404 Not Found | Resource doesn't exist (or was soft-deleted) | Show a "not found" view; remove from any client cache |
| 409 Conflict | State / uniqueness conflict (e.g. duplicate slug, can't delete a non-empty category) | Surface the `error` text — it explains the conflict in human terms |
| 429 Too Many Requests | Rate limit exceeded | Show a "please slow down" toast; reads return cached data if available |
| 500 Internal Server Error | Server bug or unhandled crash | Show generic error; quote `requestId` in any bug report |

The 401 / 403 distinction matters: 401 means the credentials problem can
be fixed by re-authenticating; 403 means re-authentication won't help —
the user simply doesn't have the permission.

---

## Pagination

Every list endpoint accepts `?page=<n>&limit=<n>` and returns:

```jsonc
{
  "data": {
    "items": [/* up to `limit` rows */],
    "pagination": { "page": 1, "limit": 20, "total": 142, "pages": 8 }
  }
}
```

- `page` is 1-indexed.
- `limit` defaults to 20 and must be in **[1, 100]**. `?limit=999999`
  does **not** get silently clamped to 100 — the request-body DTO
  validates `limit` with `@Max(100)`, so anything over 100 (or under 1,
  or non-integer) is rejected outright with a `400`. There is a second,
  internal clamp in the pagination utility, but it only protects a
  caller that builds pagination without going through the DTO (none do
  today over HTTP) — no request an API client can actually send gets a
  "successful response with 100 rows" for an out-of-range `limit`.
- `pages` is `Math.ceil(total / limit)`, included for convenience.

### List vs. detail payloads — heavy fields are list-only

The four content list endpoints — `GET /posts`, `GET /books`,
`GET /academic-papers`, `GET /gallery` (and the corresponding
`/trash` views) — return **slimmer translation objects** to keep list
responses small. The fields dropped from each translation entry in
`items[]`:

| Endpoint | Dropped translation field(s) |
| --- | --- |
| `GET /posts*` | `body` |
| `GET /books*` | `description` |
| `GET /academic-papers*` | `abstract` |
| `GET /gallery*` | `description` |

Detail endpoints (`GET /<resource>/:id`, `GET /posts/by-slug/:slug`)
return the **full** translation, including the dropped fields. Call
the detail endpoint when a list view needs to expand a row in place
(e.g. inline preview on hover, edit-without-navigating drawer).

For post-list translations specifically, `reading_time_minutes` is
always `0` — the value is derived from `body`, which isn't fetched.
Read the real value from the detail endpoint.

The `media` (cover image) include on every list payload carries the
public-facing fields: `id`, `url`, `filename`, `alt_text`, `mime_type`,
`width`, `height`, plus **`media_variants[]`** (each `{ id, width, url,
format }`) so the public site can render `<img srcset>` straight from a
list response.

**Public detail endpoints are equally slim — internal fields are
admin-only, not detail-only.** `GET /posts/:id`, `GET
/posts/by-slug/:slug`, the public book / academic-paper / gallery detail
routes, and public audio reads all drop staff identifiers (`created_by`
on posts, `added_by` on books and gallery, `uploaded_by` on academic
papers) and the embedded media row's internal columns (`file_size`,
`uploaded_by`, `created_at`). Embedded media on a public detail is
exactly `id, url, filename, alt_text, mime_type, width, height,
media_variants[]` — the same shape the list endpoint already used for
its cover image, so one image-component type covers list and detail.
These fields are still present on the **admin** routes (`GET
/posts/admin/:id`, `GET /books/admin/:id`, …) and on every create /
update / publish response body, which are hydrated with the admin
shape.

### SEO fields on detail payloads

Posts, books, and static pages carry per-translation `meta_title`,
`meta_description`, and `og_image_id`. The **detail** endpoints additionally
resolve `og_image_id` into an `og_image` object (`{ id, url, filename,
alt_text, mime_type, width, height }`) so the front-end gets a usable image
URL, not a bare UUID. List payloads keep only the scalar `og_image_id`.
Academic papers do not carry SEO fields — see the note under `by-slug`
below. Sending an `og_image_id` that doesn't match a real media row
answers `404 One or more og_image_id values do not match any media
record` — the same status and message on posts, books, static pages and
gallery alike, checked before any write so nothing is half-saved.

### Static pages — the public list has no body

`GET /static-pages` (public) is a directory, not a reading surface: each
item carries only its metadata and the request-resolved `translation`,
**without `body`**:

```jsonc
{
  "id": "…", "slug": "imam-zain-biography", "display_order": 0,
  "is_published": true, "created_at": "…", "updated_at": "…", "deleted_at": null,
  "translation": { "lang": "ar", "title": "…", "is_default": true,
                   "meta_title": null, "meta_description": null, "og_image_id": null }
}
```

`translation` is still `null` for a page with no translations. For the
body, or another language, call `GET /static-pages/by-slug/:slug` or
`GET /static-pages/:id` — unchanged: every translation, full bodies, and
`og_image` resolved with the slim public media shape. `GET
/static-pages/admin` (CMS) is unchanged and still returns every
translation with its body.

---

### Human-readable URLs (`by-slug`)

**Slugs are a single, top-level, language-agnostic column on the record —
never a per-translation field.** They used to be per-language; the
content-slug consolidation (rounds 15–16) moved every content type onto one
canonical slug. Send it as a sibling of `category_id`, *not* inside the
translation object:

```jsonc
// ✅ correct
{ "slug": "al-sahifa-al-sajjadiyya", "translations": [{ "lang": "ar", "title": "…" }] }

// ❌ 400 — validation runs forbidNonWhitelisted, so an unknown key in the
//    translation object is rejected outright rather than ignored
{ "translations": [{ "lang": "ar", "title": "…", "slug": "…" }] }
```

Support is deliberately uneven — check this table before building routing:

| Resource | Slug | `by-slug` route | Notes |
| --- | --- | --- | --- |
| Posts | **required** | `GET /posts/by-slug/:slug` | Always set. |
| Static pages | **required** | resolved by slug | Always set. |
| Books | *optional* | `GET /books/by-slug/:slug` | **Every production row is currently `null`** — see below. |
| Audios | *optional* | `GET /audios/by-slug/:slug` | **Every production row is currently `null`** — see below. |
| Academic papers | none | — | No column at all; UUID only. |
| Speakers, categories, media | none | — | UUID only. |

> ⚠️ **Books and audios have no slugs in production today.** The columns,
> the routes and the collision handling all work, but nothing has ever set a
> value — so `GET /books/by-slug/…` and `GET /audios/by-slug/…` currently
> **404 for every input**. Address books and audios by UUID until an editor
> starts assigning slugs. The CMS should treat the slug field as an optional
> editor input, and the public site must not assume a book has a pretty URL.

Academic papers have **no** slug or `by-slug` route by design — the public
site has no dedicated detail page for papers (they open in a modal on
`/research/scientific-platform`), so a canonical per-paper URL would have
nothing to link to. An earlier round added slug + SEO fields to academic
papers mirroring books; they were removed after confirming no production row
ever set them and no route ever served them. All 1,260 papers are
UUID-addressed.

Slugs are validated as `^[a-z0-9]+(?:-[a-z0-9]+)*$` (lowercase latin,
digits, single hyphens) and are unique among live rows; a collision returns
409. Soft-delete suffixes the slug so it can be reused — see
[Soft delete and restore](#soft-delete-and-restore).

### Audios + speakers (i18n)

`audios` follows the same translation pattern as books for its `title`
(in `audio_translations`, resolved per request via `Accept-Language` into a
`translation` field, with the full `audio_translations[]` array also
returned). The language-agnostic core (`audio_url`, `pdf_url`, the single
`slug`, `duration_seconds`, `size_mb`, `peaks`, `is_published`) lives on
the row. List payloads drop the heavy `peaks` waveform; the detail endpoint
includes it.

**Speaker** is a first-class entity (`speakers` + `speaker_translations`),
not a free-text field — each audio carries a nullable `speaker_id` and the
resolved `speaker` is embedded in audio responses. Browse a lecturer's
catalogue with `GET /audios?speaker_id=…`, or list lecturers via
`GET /speakers` (each with a live-published `audio_count`). There is **no**
category dimension on audios. Speaker management reuses the `audios:*`
permissions.

On **public** reads (`GET /audios`, `/audios/:id`, `/audios/by-slug/:slug`),
`speaker` is `null` when the audio's speaker is in the trash —
`speaker_id` still holds the id, but render the lecture without a
lecturer line rather than treating it as an error. The admin routes
(`/audios/admin*`, `/audios/trash`) still resolve the speaker whether
trashed or not, so an editor can see what they're dealing with.
`POST /audios/:id/restore` refuses with `409 AUDIO_SPEAKER_DELETED` when
the audio's speaker is in the trash — restore the speaker first
(`GET /speakers/trash`, `POST /speakers/:id/restore`), then retry.

Audio + companion-PDF files are uploaded to R2 via
`POST /audios/upload-url` (pre-signed PUT; send the same `Content-Type` on
the PUT as you declared) and the returned `publicUrl` is saved onto the
record's `audio_url` / `pdf_url`. `durationSeconds` / `sizeMB` / `peaks`
are computed client-side at upload time and POSTed with create — see
`docs/CMS-INTEGRATION-NOTES.md` §17 for the browser extractor.

Books and academic papers upload their PDF the same way: `POST
/books/upload-url` / `POST /academic-papers/upload-url` (PDF only, 150 MB
cap, no `content_type` to declare since it's always `application/pdf`),
PUT the file, save the returned `publicUrl` onto `pdf_url`. Same
no-confirm trade-off as the audios upload above — see
`docs/CMS-INTEGRATION-NOTES.md` §21.

---

## List filters and request validation

Cross-cutting validation rules on query strings and a few date-typed
fields, enforced the same way across every resource that has them.

### Search terms — 2 characters minimum

`?search=` on `GET /posts`, `/posts/admin`, `/books`, `/books/admin`,
`/audios`, `/audios/admin`, `/academic-papers`, `/academic-papers/admin`,
`/speakers`, `/media` and `/newsletter/subscribers`, and `?q=` on
`GET /search`, must be 2–200 characters **after trimming**. A
1-character `contains` term can't use the trigram indexes and forces a
full scan of every body/abstract, so it's rejected with `400`. Leading
and trailing spaces are trimmed before the length check and before the
query runs. A blank or whitespace-only `?search=` means "no search" (the
full list comes back); `?q=` is required, so a blank or 1-character
value is still a 400. Debounce input client-side rather than sending a
single character.

### Boolean query parameters — exact `true` / `false` only

`?featured=` (`GET /posts`, `/posts/admin`), `?is_published=`
(`GET /audios/admin`, `GET /static-pages/admin`), `?is_publication=`
(`GET /books`, `/books/admin`), `?is_active=`
(`GET /newsletter/subscribers`) and `?submitted=`
(`GET /forms/qutuf-sajjadiya-contest/attempts`) accept only the literal
strings `true` or `false`, matched case-sensitively (`TRUE`, `1`, `yes`,
an empty value are all rejected with `400` instead of silently becoming
`false`). Omit the parameter to mean "no filter" — don't send it empty.

### Id arrays must be unique

`attachment_ids` (posts) and `ids` (`POST /posts/bulk/publish`,
`POST /posts/bulk/delete`) reject a duplicate entry up front with `400`
(compared case-insensitively, since Postgres treats mixed-case UUID text
as equal). Send each id once.

### Scheduled timestamps need an explicit UTC offset

`published_at` on `POST/PATCH /posts` and `scheduled_at` on newsletter
campaigns share one validator: the value must be an ISO 8601 instant
ending in `Z` or `±hh:mm` — exactly what `new Date(...).toISOString()`
produces. A date-only value, an offset-less timestamp, lower-case `z`,
`+0300`, an impossible date, or an out-of-range time is a `400`. Before
this, an offset-less timestamp was read in the server's zone (UTC), so a
post an editor scheduled for "09:00" Baghdad time went live three hours
early. `null` still clears a post's schedule; re-sending an already
stored (possibly now-overdue) value back unchanged is always accepted.
Timestamps that are **not** schedules — `responded_at` / `processed_at`
on forms, the audit-log date filters, gallery `taken_at` — are
unaffected and still accept an offset-less ISO string.

### Field length limits

Every free-text field and array on every create/update body has an
upper bound, counted in UTF-16 code units (the same unit an HTML
`maxlength` attribute uses, so a CMS input can mirror the number
exactly). An over-limit value is always a `400` naming the field and the
limit, never a `500`. The full per-resource, per-field table lives in
[CMS-INTEGRATION-NOTES.md](CMS-INTEGRATION-NOTES.md) (Tier-2 hardening
round); the canonical numbers live in
`src/common/validators/dto-limits.ts`.

---

## Books — multi-part series and the Publications flag

Two things specific to `books` that don't fit the general list/detail
pattern above.

### Multi-part series

Some books are published as a numbered set (e.g. a 12-volume biography).
Each volume is its own PDF, but **a multi-part series is always one row
on every list endpoint** (`GET /books`, `GET /books/admin`), never one
row per volume. Every book object — list or detail — carries:

```jsonc
"parts_count": 0   // 0 on an ordinary book. > 0 means this row is a series.
```

`parts_count` always matches the parts you can actually open on that
same audience's detail endpoint — it never counts a part you'd then
fail to see. On the **public** `GET /books` list it counts only
published, non-trashed parts (equal to `parts.length` on `GET
/books/:id`); on `GET /books/admin` and `GET /books/trash` it counts
every live part, drafts included (equal to `parts.length` on `GET
/books/admin/:id`). A trashed part never counts anywhere.

To get the individual volumes, call the detail endpoint on that row —
`GET /books/{id}` or `GET /books/by-slug/{slug}` — which adds a `parts`
array when `parts_count > 0`:

```jsonc
// GET /books/{id} — a series' parent/cover entry
{
  "id": "…",
  "parts_count": 12,
  "translation": { "title": "سيرة المعصومين (عليهم السلام)", "…": "…" },
  "parts": [
    {
      "id": "…",
      "slug": null,
      "part_number": 1,
      "pages": 306,
      "pdf_url": "https://cdn.imamzain.org/books/….pdf",
      "media": { "…": "cover image for this volume" },
      "translation": { "title": "سيرة المعصومين (عليهم السلام)", "…": "…" }
    },
    { "id": "…", "part_number": 2, "…": "…" }
    // … one entry per volume, already sorted by part_number
  ]
}
```

Every part shares the series' title — `part_number` (not the title
string) is the only reliable way to tell volumes apart and order them; do
not try to parse a part number out of the title. A part's own `pdf_url`
is what you link to for that specific volume; the parent row itself has
no `pdf_url`.

If you fetch a *part* directly by its own id/slug, the response carries
`parent` instead (`{ id, slug, translation }`) so you can link back to
the series it belongs to:

```jsonc
// GET /books/{part-id} — one volume, fetched directly
{
  "id": "…",
  "part_number": 3,
  "parts_count": 0,
  "pdf_url": "https://cdn.imamzain.org/books/….pdf",
  "parent": { "id": "…", "slug": null, "translation": { "title": "سيرة المعصومين (عليهم السلام)" } }
}
```

`parts_count` is always `0` on a part fetched this way — only the
parent carries a nonzero count. A part never itself has `parts`.

### `is_publication` — the institution's flagship-release flag

`is_publication` (boolean, on every book) marks whether a title belongs
to the institution's own "الإصدارات" (Publications) release list. It is
**independent of `category_id`** — a book can be filed under a topic
(e.g. a Sahifa Sajjadiya commentary) and *also* be one of the
institution's Publications; the two aren't mutually exclusive, and one
does not imply the other.

Filter to just the Publications list with:

```
GET /books?is_publication=true
```

Combine it with `category_id` if you need both dimensions at once
(e.g. "our Publications that are about the Sahifa Sajjadiya"):

```
GET /books?category_id={sahifa-category-uuid}&is_publication=true
```

Don't infer "is this a Publication" from `category_id` alone — a book
whose primary topic is something else entirely can still be
`is_publication: true`.

---

## Authentication flow

The API uses short-lived JWT access tokens plus long-lived refresh
tokens with rotation + reuse detection. The flow:

```text
┌─────────────┐  POST /auth/login            ┌────────────┐
│   Client    │ ─────────────────────────▶  │    API     │
│             │                             │            │
│             │  ◀── { accessToken,         │            │
│             │       refresh_token,        │            │
│             │       user: {…} }           │            │
└─────────────┘                             └────────────┘
       │
       │  Use accessToken in `Authorization: Bearer …` for 24h
       │
       ▼  When the access token expires (401):
┌─────────────┐  POST /auth/refresh         ┌────────────┐
│   Client    │ ─────────────────────────▶  │    API     │
│             │                             │            │
│             │  ◀── new accessToken +      │            │
│             │       new refresh_token     │            │
└─────────────┘  (old refresh_token now revoked)
```

### Login request body

Accounts are identified by **`username`, not email** — the `users` table
has no email column at all, so there is no "forgot password by email"
flow. Password resets are admin-driven via
`POST /users/:id/reset-password`.

```jsonc
// POST /api/v1/auth/login
{ "username": "superadmin", "password": "…" }
```

Sending `{ "email": … }` fails with a 400 and
`"property email should not exist"` — global validation runs with
`forbidNonWhitelisted: true`, so unknown keys are rejected outright
rather than ignored. That strictness applies to every write endpoint:
send only the documented fields.

### Forced password change (`must_change_password`)

`POST /auth/login` returns `data.user.must_change_password` and `GET
/auth/me` returns `data.must_change_password` (boolean). It becomes
`true` when an admin resets the account's password
(`POST /users/:id/reset-password`) and goes back to `false` only when
the user changes it themselves (`PATCH /auth/me/password`) — that
change is rejected with `400 PASSWORD_MUST_DIFFER` while flagged if
`newPassword` equals `currentPassword`. A flagged user should be sent
straight to a change-password screen after login.

Server-side enforcement is a separate, off-by-default switch: with
`ENFORCE_PASSWORD_CHANGE_AFTER_RESET` unset, the flag is informational
only. Once it's the literal string `true`, a flagged account gets `403
PASSWORD_CHANGE_REQUIRED` on every authenticated route except
`GET /auth/me`, `PATCH /auth/me/password`, `POST /auth/logout` and
`POST /auth/refresh`. See
[permissions.md](permissions.md#forced-password-change-must_change_password)
for the full rollout note.

### Token lifetimes

- **Access token (JWT):** 24h. Always sent in `Authorization: Bearer
  <token>`. The payload carries `sub` (user id), `username`,
  `permissions[]`, and `token_version`. The CMS can decode the payload
  locally to know what menu items to show, but **must not** trust
  permissions for security decisions — the server enforces.
- **Refresh token:** 7 days. Plain random string; the server stores a
  SHA-256 hash. Treat it like a password — keep it in `httpOnly` cookies
  or a secure storage primitive.

### Rotation + reuse detection

Every successful `/auth/refresh` revokes the supplied refresh token and
issues a new one, linked to it as part of the same **session (token
family)**. Presenting a token again after it was rotated is either a
benign race or theft, and the two are told apart:

- **Within `REFRESH_REUSE_GRACE_SECONDS` (default 10 s) of the
  rotation** — two tabs, or a retried request — both callers succeed;
  the second one gets its own fresh token in the same session. The
  grace never revives a session that a logout already ended.
- **Outside the grace window** — treated as theft: only **that
  session's token family** is revoked (`401 AUTH_TOKEN_REUSED`); other
  devices are untouched. An audit row (`REFRESH_TOKEN_REUSE_DETECTED`)
  is written either way, with `revoked_tokens: 0` meaning the session
  was already over (a stale device), not necessarily an attack.
- **A token already ended** by logout, logout-all or a password change
  — plain `401 AUTH_REFRESH_INVALID`; nothing else is touched.

Treat **any** 401 from `/auth/refresh` as "session over → login form".
Single-flight the refresh call (one in-flight request shared by every
caller) and keep the refresh token in one shared place (cookie /
localStorage), not per-tab memory — the grace window covers races and
retries, not a tab that sat idle for minutes holding an old token.

### Invalidating tokens globally

Both `PATCH /auth/me/password` and `POST /users/:id/reset-password` bump
`token_version` and revoke every active refresh token. The user's
existing access tokens fail their next request (the `token_version` no
longer matches), and they're forced to re-login.
`POST /users/:id/reset-password` also flags the account
`must_change_password: true` — see [above](#forced-password-change-must_change_password).

### Logout

`POST /auth/logout` with `{ refresh_token: "…" }` ends the whole session
that token belongs to (every token in its family), not just that one
row. Omit the body to log out everywhere — every refresh token, and
every session, of the current user.

### No self-service password reset

The `users` table has no `email` column, so there's no "forgot
password" flow. An admin uses `POST /users/:id/reset-password` to set a
new password and hands it to the user out-of-band.

---

## Authorisation (permissions)

The API uses RBAC with per-action permission strings of the form
`<resource>:<action>`. Every protected endpoint declares the
permission it requires (visible in the Scalar description).

For the complete catalogue — every permission, which roles get them by
default, and how to assign new combinations — see
[permissions.md](permissions.md).

Quick rules:

- The `permissions[]` array on the JWT payload is the canonical
  source of truth for what the current user can do. Server enforces;
  client renders.
- Role changes (`POST /users/:id/roles`) take effect on the user's
  **next** authenticated request — the server reads `user_roles` live.
- Permission changes within a role (`POST /roles/:id/permissions`)
  also take effect on next request.

---

## Language resolution

Multi-language responses are driven by an `Accept-Language` header.

### How the API reads it

Only the **primary** language tag is used; quality factors are
ignored. The middleware lower-cases it and strips region:

```text
Accept-Language: ar-IQ,en;q=0.8         →  lang = "ar"
Accept-Language: en-US                   →  lang = "en"
Accept-Language: fr                      →  lang = "fr"   (then falls back if no translation)
(no header)                              →  lang = null  (use default translation)
```

### How responses resolve

List and detail endpoints return **all** stored translations in
`translations[]` and a pre-resolved `translation` field:

```jsonc
{
  "translations": [
    { "lang": "ar", "title": "…", "is_default": true },
    { "lang": "en", "title": "…", "is_default": false }
  ],
  "translation": { "lang": "ar", "title": "…", "is_default": true }
}
```

Resolution rule for the `translation` field:

1. If `Accept-Language` matched a stored translation *in a live, active
   language* → use it.
2. Otherwise → the translation flagged `is_default: true` (on the
   modules that have one).
3. Otherwise → the Arabic (`ar`) translation.
4. Otherwise → the translation in the lowest language code,
   alphabetically.
5. If none of the row's translations are in a live, active language →
   `null`.

**A deactivated or soft-deleted language is never a candidate**, at
any step — not as the `Accept-Language` match, not as a fallback — even
though the raw `translations[]` array still lists that row (so CMS edit
forms keep working; only the resolved `translation` field, search hits,
and the homepage obey the rule). Reactivating the language makes it
eligible again on that instance immediately, and everywhere else within
60 seconds.

The front-end can read `translation` directly without reproducing this
logic. The full `translations[]` array stays available for language
switchers.

### Cross-resource search caveat

`GET /search` is the one exception: it returns the translation that
**actually matched** the query, not the language-resolved one. An
Arabic search that hits an English summary will return the English row
— this is intentional, so search results faithfully reflect what was
indexed.

### `document_languages` — the language of the *file*, not the metadata

Books and academic papers carry a second, unrelated language field, and
conflating the two is the most common mistake here:

| Field | Describes | Drives |
| --- | --- | --- |
| `translations[].lang` | the **catalogue metadata** — title, author, abstract | `Accept-Language` resolution, the `translation` field |
| `document_languages` | the **PDF itself** | nothing automatic; display only |

A thesis can be catalogued in Arabic while the document is Persian, and a
book catalogued in both Arabic and English can have an Arabic-only PDF.
`document_languages` is **never** used for language resolution — it exists
so the UI can show a "متوفر بالفارسية" style badge and so readers know what
they're downloading.

- Type: `string[]` of ISO 639-1 codes, e.g. `["ar"]`, `["ar", "fa"]`.
- Returned on both list and detail for books and academic papers.
- Accepted on create and update. **Omit it and you get `[]`** — the column
  is `NOT NULL`, so never send `null`.
- On update it **replaces the whole array**; there is no add/remove
  semantic. Send the full desired set every time.

Current production data: every book has it populated; 1,193 of 1,260 papers
do (the remaining 67 had no language label in the source corpus and are
`[]`). Treat `[]` as "unknown", not as "no languages".

---

## Soft delete and restore

Every soft-deletable resource (posts, books, papers, gallery images,
all four category types, **static pages**, **stores** + their
sale-points, **audios**, **daily hadiths**, users, newsletter
subscribers, and form submissions — contacts + proxy visits) follows
the same lifecycle:

```text
┌───────┐  DELETE /<resource>/:id          ┌─────────┐
│ Live  │ ──────────────────────────────▶  │ Trashed │
└───────┘                                  └─────────┘
   ▲                                              │
   │  POST /<resource>/:id/restore                │
   └──────────────────────────────────────────────┘
```

`deleted_at` is set on delete; reset to `null` on restore. Trashed rows
never appear in normal list / detail queries.

### Suffix scheme for unique columns

For resources with unique columns scoped to live rows, the API suffixes the
value on delete to free it up. Those columns are:

- the top-level `slug` on posts, static pages, books and audios (one per
  row — see [Human-readable URLs](#human-readable-urls-by-slug));
- the per-language `slug` on **category** translations, which are the one
  place a slug is still scoped to a translation;
- `books.isbn` and `users.username`.

Academic papers have no slug, so nothing is suffixed for them.

```text
slug:  "hayat-al-imam-zain"  →  "hayat-al-imam-zain__del_1715472000"
isbn:  "978-3-16-148410-0"   →  "978-3-16-148410-0__del_1715472000"
```

`GET /<resource>/trash` strips the suffix before returning the rows, so
the CMS shows the original value. Restore reverses the suffix back to
the original.

### Restore conflict (409)

If, while a row was in trash, another live row claimed the original
slug / ISBN, restore returns 409. The CMS must rename one side first
and retry.

**Daily hadiths are the one exception.** `display_date` isn't suffixed
like a slug — if another hadith has since claimed that date,
`POST /daily-hadiths/:id/restore` succeeds instead of 409ing: the hadith
comes back **unscheduled** (`display_date` cleared, back in the random
pool), with `message: "Hadith restored without its schedule: … is now
taken by another hadith"` and `meta: { unscheduled: true,
previous_display_date }`. A normal restore returns the same shape with
`meta.unscheduled: false`. `data` is `null` either way, so existing
clients keep working; refetch the hadith after a restore to see its
current `display_date`.

### Hard delete

Soft delete is the default for content. The exceptions:

- **Newsletter campaigns** in `draft`, `cancelled` or `failed` state
  (i.e. ones that never reached anyone) can be hard-deleted via
  `DELETE /newsletter/campaigns/:id`.
- **Settings**, **roles**, **permissions assignments**, **media files**
  (`DELETE /media/:id` removes the R2 object too) are always hard.

---

## Media upload (two-step flow)

Media uploads use a pre-signed URL pattern to keep large files off the
API server.

```text
┌────────────┐  1. POST /media/upload-url          ┌─────────┐
│            │ ──────────────────────────────────▶ │         │
│    CMS     │     { filename, mime_type }         │   API   │
│            │  ◀── { uploadUrl, key,              │         │
│            │        mediaId, maxBytes }          │         │
└────────────┘                                     └─────────┘
       │
       │  2. PUT <uploadUrl>                       ┌─────────┐
       │     body: <file bytes ≤ maxBytes>         │   R2    │
       │     Content-Type: <same as request>       │ bucket  │
       │ ──────────────────────────────────────▶   │         │
       │  ◀── 200 OK                               └─────────┘
       │
       │  3. POST /media/confirm                   ┌─────────┐
       │     { key, alt_text? }                    │   API   │
       │ ──────────────────────────────────────▶   │         │
       │  ◀── full media record (id == mediaId)    └─────────┘
       │       with variants[] (320/768/1280/1920 webp)
       │       — 413 + R2 purge if file > maxBytes
```

### Allowed MIME types and size caps

| MIME                                                 | Max bytes |
| ---------------------------------------------------- | --------- |
| `image/jpeg`, `image/png`, `image/gif`, `image/webp` | **25 MB** |

The cap is exposed as `maxBytes` in the `/media/upload-url` response so the
CMS can reject oversized files **before** starting the PUT. The server
re-checks at confirm time using R2's authoritative `Content-Length`; any
file that slipped past client-side validation is rejected with 413 and the
R2 object is purged in the same call.

### R2 storage layout

```text
media/
  originals/
    <mediaId>/
      <slug>.<ext>            ← the file the CMS uploaded
  variants/
    <mediaId>/
      w320.webp
      w768.webp
      w1280.webp
      w1920.webp
```

The `<mediaId>` segment is the same in both folders — it's the row's
primary key, pre-generated by `/media/upload-url` and returned in the
response so the CMS can stage references (e.g. wire it into a draft post
body) while the PUT is still in flight. Originals are kept so future
re-processing (AVIF, larger variants, ML features) remains possible.

### Authorisation

The pre-signed URL is bound to the **requesting user**. Only that user
can call `/media/confirm` for the resulting key — defends against an
admin handing the upload URL to a less-trusted helper.

### Server-side variant generation (background)

On `/media/confirm`, the API runs `sharp` to produce WebP variants at up
to **320, 768, 1280, and 1920 px** widths (skipping any width that would
upscale — a 1200 px original legitimately gets only two variants, an
animated GIF gets none). EXIF orientation is applied and stripped on
each variant, so sideways phone photos come out the right way up.
`sharp` is capped at 50 megapixels of input so a malicious 30000×30000
PNG fails fast instead of OOM-ing the dyno. The **original** is also
rewritten in place, seconds after confirm, to strip EXIF/XMP/IPTC (GPS
position, camera/device serials) when it carries any — same URL, same
format, orientation baked into the pixels; `file_size` can change once
shortly after confirm, so don't cache a hash of the original.

**Variant generation runs in the background**, off the request path.
`/media/confirm` returns immediately with `variants: []` so the editor
isn't blocked by a 2–5 s `sharp` decode. Poll the media row for
completion using `variants_status` — **never** the length of
`variants`:

```text
1. POST /media/confirm  → { ..., variants: [], planned_widths: [320,768,…], variants_status: "processing" }
2. (background, ~1–3 s)     sharp writes each planned width's variant row, then sanitises the original
3. GET  /media/:id       → { ..., variants: [...], variants_status: "ready" }
```

- **`planned_widths`** — the variant widths this original should get
  (320 / 768 / 1280 / 1920, each only if strictly narrower than the
  original); `[]` when none apply.
- **`variants_status`** — `ready` (every planned width has a variant —
  render `variants` in a `srcset`), `processing` (still within 2 minutes
  of upload — keep polling), `partial` (still missing after 2 minutes —
  generation failed, or the original isn't in storage; offer
  "Regenerate"), `unavailable` (no variants can ever be produced — use
  the original `url`; see `variants_status_reason`), or `not_applicable`
  (animated GIF or non-raster — use the original `url`).
- **`variants_status_reason`** (present when it needs explaining):
  `TOO_SMALL`, `ORIGINAL_MISSING`, `UNREADABLE`, `ANIMATED`,
  `NON_RASTER`, `GENERATION_INCOMPLETE`.

**The rule: poll until `variants_status !== "processing"`.** Comparing
`variants.length` to a fixed count is wrong — a legitimately short
original has fewer than four, and an animated GIF has zero — and
stopping at the first non-empty `variants` array can hand back a
half-built set. Once the status settles, use `variants` when it's
`ready` or `partial`, and the original `url` otherwise; surface
"Regenerate variants" only for `partial` (regenerating cannot help
`unavailable` or `not_applicable`). If the CMS just stages the original
and lets the public site render it, no polling is needed at all.

### Public site usage

```tsx
<img
  src={media.url}                                              // original fallback
  srcSet={media.variants.map(v => `${v.url} ${v.width}w`).join(', ')}
  sizes="100vw"
  alt={media.alt_text ?? ''}
  loading="lazy"
  decoding="async"
/>
```

No `?w=…` query parameters, no client-side resizing, no Cloudflare
Image Resizing transforms. The variants are pre-baked.

The same pattern extends to `GET /homepage` and `GET /search`: every
embedded image keeps its existing original-URL field and gains a sibling
`<field>_variants` array in this same shape (`image` → `image_variants`,
`path` → `path_variants`, `cover_image_url` → `cover_image_variants`),
ordered by width ascending and possibly empty — build the `srcset` from
the variants when present, fall back to the original URL otherwise, and
never assume a fixed count. See
[CMS-INTEGRATION-NOTES.md](CMS-INTEGRATION-NOTES.md) for the exact field
list per endpoint.

### Delete safety

`DELETE /media/:id` removes the stored files (variants, then the
original — an object that's already gone counts as deleted) before the
database row. If the media is still referenced by a post, book,
static page or gallery item, it returns `409 MEDIA_IN_USE` naming what
holds it, including references held by trashed records (which keep the
reference until the image is changed on the record itself — a gallery
item's primary key *is* its media id, so a `gallery_image` reference to
the media's own id means the file *is* that gallery item: delete the
gallery item first). Call `GET /media/:id/references` (permission
`media:read`) for the full list:

```jsonc
{ "media_id": "…", "total": 2, "shown": 2, "truncated": false,
  "items": [ { "type": "post", "id": "…", "field": "cover_image", "trashed": false },
             { "type": "book", "id": "…", "field": "og_image", "lang": "ar", "trashed": true } ] }
```

(at most 20 `items`; `total` is the real count). The database row is the
authoritative record: a final check runs inside the same transaction as
the row delete, so a reference added at the last moment always wins and
the row survives (`409 MEDIA_IN_USE`) rather than the file being deleted
first. The R2 file is removed only after that row deletion commits, on a
best-effort basis — a storage failure at that point is logged server-side
for follow-up, not returned to the caller, since the record itself is
already gone.

A malformed `:id` on any media route (`GET|PATCH|DELETE /media/:id`,
`GET /media/:id/references`, `POST /media/:id/regenerate-variants`)
answers `400 INVALID_IDENTIFIER`, the same shape every other resource
route uses for a bad UUID.

---

## Rich-text body sanitisation

Two fields accept rich-text HTML from the CMS:

- `post_translations.body`
- `newsletter_campaigns.body_html`

Both go through `sanitize-html` against the same allowlist before
storage. The allowlist mirrors the Tiptap StarterKit schema. Anything
outside it is silently stripped.

### Allowed tags

```text
p, br, hr,
h1, h2, h3, h4, h5, h6,
ul, ol, li,
blockquote,
pre, code,
strong, b, em, i, u, s, sub, sup, mark,
a, img,
table, thead, tbody, tfoot, tr, th, td,
span, div
```

### Allowed attributes

| Tag | Attributes |
| --- | --- |
| `a` | `href`, `target`, `rel`, `title` |
| `img` | `src`, `alt`, `title`, `width`, `height`, `loading` |
| `th` | `colspan`, `rowspan`, `scope` |
| `td` | `colspan`, `rowspan` |
| any allowed tag | `class`, `id` |

`style` attributes are **stripped** (CSS expression injection vector).
Inline event handlers (`onclick`, etc.) are **stripped**.

### Allowed URL schemes

- `href`: `http`, `https`, `mailto`, `tel`
- `<img src>`: `http`, `https`, `data` — but `data:` URLs are restricted
  to image MIME types only: `image/png`, `image/jpeg`, `image/gif`,
  `image/webp`, `image/svg+xml`. Any other `data:` MIME (notably
  `data:text/html`) causes the entire `<img>` element to be dropped.

Protocol-relative URLs (`//example.com/x.png`) are allowed.

### Automatic rewrites

Applied at **write** time (create/update), so a body already stored
keeps its old markup until it's re-saved.

- `<a target="_blank">` (any case/padding — `_BLANK`, ` _blank `) keeps
  `target="_blank"` and gets `rel="noopener noreferrer"` — an authored
  `rel` is overwritten (`rel="opener"`, `nofollow`, … do not survive on
  a `_blank` link). Any other `target` (`_top`, `_self`, `_parent`,
  `popup`, empty, anything else) is **dropped** entirely, so the link
  opens in the same tab.
- A heading/element `id` is rewritten to `user-content-<original>`
  (GitHub-style), and a same-page `href="#original"` anchor is rewritten
  to `href="#user-content-original"` in the same pass, so authored
  in-page links keep working. An `id` that doesn't match
  `^[A-Za-z][A-Za-z0-9_-]{0,63}$` (starts with a digit/underscore, has a
  space/dot/colon, is longer than 64 characters, or is non-ASCII) is
  dropped instead of rewritten. The pass is idempotent — re-saving a
  body fetched back from the API does not stack `user-content-`
  prefixes. If the site scrolls to headings or builds a table of
  contents from body HTML, target `[id^="user-content-"]`.

### Size cap

The body field is capped at **200 KB UTF-8** (matches the CMS-side
`MAX_BODY_BYTES`). Requests over the cap return 400.

### Defence-in-depth, not replacement

The CMS should still run its own client-side `sanitizeEditorHtml`
before submit. The server pass is a backstop, not the primary defence
— editor feedback while typing is still client-driven.

---

## Newsletter double opt-in

Joining the list is a two-step flow, so nobody can subscribe — or
re-subscribe — an address they don't own.

1. **`POST /newsletter/subscribe { email }`** records the request and
   e-mails the address a confirmation link. It does **not** subscribe
   anyone. The reply is *always*

   ```jsonc
   {
     "success": true,
     "message": "Please check your inbox to confirm your subscription",
     "data": null
   }
   ```

   for a new address, one still pending, one already subscribed, one that
   unsubscribed and one an admin deleted alike: no row, no token, no 409.
   That is deliberate — the old endpoint answered 409 only for active
   addresses (so it revealed who was on the list) and handed the subscriber
   row plus its unsubscribe token to anyone who asked. Show the visitor
   "check your inbox" whatever happens. Two limits silently send **no**
   e-mail while still answering 200: a second request for the same address
   within 15 minutes, and more than `NEWSLETTER_CONFIRM_MAX_PER_HOUR`
   (default 30) confirmation e-mails in a rolling hour across all
   addresses. The e-mail is sent after the reply is on its way, so response
   time doesn't leak the address's state either.
2. **The link in that e-mail** points at the website page
   `${NEWSLETTER_CONFIRM_URL_BASE}?email=<email>&token=<token>` (default
   `https://imamzain.org/newsletter/confirm`). That page must
   `POST /newsletter/confirm { email, token }` — ideally when the visitor
   presses a button rather than on page load, so mail scanners that
   pre-fetch links don't confirm by accident. `200` means subscribed (also
   `200` if they already were: a double-click is harmless); `401` means the
   link is invalid or expired.

The token is bound to the **newest** confirmation e-mail sent to that
address (asking again invalidates older links), is valid for 72 hours, and
stops working if the person unsubscribed after it was sent — an old e-mail
can't quietly undo an unsubscribe. Every way a link can be bad (unknown
address, wrong, superseded, expired, opted out since) is the same `401`, so
the endpoint can't be used to probe the list. It is signed with
`NEWSLETTER_UNSUBSCRIBE_SECRET` like the unsubscribe token, so rotating the
secret also kills outstanding confirmation links.

**What the CMS sees.** Subscribers gain `confirmed_at` — when the
*current* consent was given, re-stamped on every confirmation and on an
admin resubscribe — and `confirmation_sent_at`. A row with
`is_active: false`, `confirmed_at: null` and `unsubscribed_at: null` is a
sign-up still waiting for its click: show it as **pending**, not
unsubscribed. Only `is_active` subscribers receive campaigns.
Subscribers who joined before this change were grandfathered
(`confirmed_at = subscribed_at`) and stay active.
`GET /dashboard/stats` → `newsletter` gains `pending_subscribers`;
`inactive_subscribers` now means opted-out only and `recent_subscribers`
counts new *confirmations* in the window.

**Trash and admin actions.**

- *Restore* from the trash brings back someone who was subscribed when
  they were deleted — undoing a mistaken delete — but an explicit opt-out
  survives the round trip (they come back inactive, `unsubscribed_at`
  intact) and a never-confirmed sign-up stays pending. It used to force
  everyone active, putting people who had unsubscribed back on the list.
- *Admin resubscribe* skips the e-mail (the admin vouches for the consent)
  and stamps `confirmed_at`.
- Someone who signs up again after unsubscribing, or after being deleted,
  goes through the confirmation e-mail like anyone else; the click brings
  the same row back. Merely asking never undoes an opt-out.

---

## Newsletter unsubscribe scheme

### How tokens are issued

Every campaign e-mail carries a per-recipient unsubscribe link (see
below). `POST /newsletter/subscribe` no longer returns a token — it used
to hand one to anyone who asked, for any address.

The token is **`HMAC-SHA256(subscriber id, secret)`** with a server-side
secret (`NEWSLETTER_UNSUBSCRIBE_SECRET`, falls back to `JWT_SECRET`). It is
**not** stored in the database. This means:

- The token is stable across server restarts as long as the secret
  doesn't change.
- Rotating the secret invalidates every outstanding unsubscribe link —
  set `NEWSLETTER_UNSUBSCRIBE_SECRET` explicitly so you can rotate it
  independently of `JWT_SECRET`.

### How the front-end unsubscribes

`POST /newsletter/unsubscribe` with `{ email, token }`. Idempotent —
calling twice is a no-op.

### Where the URL gets built

Inside outbound campaign emails, the body's `{{unsubscribe_url}}`
placeholder is replaced per-recipient with:

```text
${NEWSLETTER_UNSUBSCRIBE_URL_BASE}?email=<email>&token=<token>
```

Default base: `https://imamzain.org/newsletter/unsubscribe`. The
front-end hosts that page and submits the params to
`POST /newsletter/unsubscribe`.

If the campaign body **doesn't** contain `{{unsubscribe_url}}`, a
default footer with the link is appended automatically — every email
the API sends has a working unsubscribe.

### Admin-driven unsubscribe

For CMS workflows where an admin handles a complaint or a bounce:

```text
POST /newsletter/subscribers/:id/unsubscribe      (admin, no token)
POST /newsletter/subscribers/:id/resubscribe      (admin, no token, no e-mail; stamps confirmed_at)
```

Both are idempotent. Permission: `newsletter:update`.

---

## Newsletter campaign delivery

`POST /newsletter/campaigns/:id/send` queues a campaign; a cron sender
(every minute) does the sending. What the CMS needs to know:

**Pacing — a big list takes hours, by design.** Delivery is paced to a
rolling-hour budget shared by all campaigns: `NEWSLETTER_SEND_PER_HOUR`,
default **300**. Hostinger's own published limit for the shared mailbox is
500 messages/hour per mailbox and domain
([source](https://www.hostinger.com/support/6550582-parameters-and-limits-of-hostinger-cpanel-email/)) —
the default stays under that so the admin digests and sign-up confirmations
that share the same mailbox always have room, and because Hostinger's docs
separately warn that an aggressive burst can trip anti-abuse throttling even
under the numeric cap. A campaign to 1,300 subscribers therefore takes a bit
over **4 hours**. Show an ETA rather than a spinner:
`delivered_count / recipient_count` advances as the cron works. (The old
sender attempted 50 a minute — 3,000 an hour — so with ~1,300 subscribers
most recipients would have failed for good.) A dedicated campaign mailbox
(`CAMPAIGN_SMTP_*`) lets an operator raise the budget further; sharing the
transactional mailbox, 300/h already leaves 200/h of headroom under
Hostinger's cap for that mailbox's other traffic.

**Statuses.**

| Status | Meaning |
| --- | --- |
| `draft` | Editable. |
| `scheduled` | Editable; the cron starts it at `scheduled_at`. |
| `sending` | In progress (possibly paused — see below). Can be cancelled. |
| `sent` | Finished; at least one recipient was reached. `failed_count` may be non-zero (refused addresses, unsubscribed before their turn). |
| `failed` | Finished and **nothing was delivered** — or nobody was on the list at the scheduled time. `last_error` may say why. Retry or delete it. |
| `cancelled` | Stopped; delivered messages stay delivered. |

**Every recipient is settled one at a time.** A message is marked sent the
moment the mail server accepts it, so a restart can never re-send more than
the handful of messages that were in flight. A temporary problem (timeout,
greylisting, a 4xx) is retried with back-off — 5, 10, 20, 40 minutes, five
attempts in all — and only then counts as failed; a refused address
(5xx) fails at once. `delivered_count` and `failed_count` are recomputed
from the recipient rows, so they are always exact.

**Pause instead of fail.** If the problem is on *our* side — the SMTP
server is unreachable, our login is refused, the hourly quota is reported
exhausted — the sender stops, does not charge the recipients an attempt,
and pauses the campaign for 15 minutes: `paused_until` (a future time) and
`last_error` are set. Show "paused — will resume" while `paused_until` is
in the future; both clear themselves as soon as mail flows again. If it
never recovers (say the SMTP password is wrong), the campaign stays
`sending` and paused — cancel it and fix the configuration.

**Retry a failed campaign.** `POST /newsletter/campaigns/:id/retry`
(`newsletter:update`; only for `failed`, else 409) puts the failed
recipients who are still on the list back in the queue with their attempts
reset and moves the campaign to `sending`. `data.recipient_count` is how
many were re-queued. Subscribers who joined after the original send are not
added; if every failed recipient has since left, it answers 409 and the
campaign stays `failed`. A `failed` campaign can also be deleted now.

**Refusals that leave the campaign untouched.** `send` and `retry` answer
**503** with `code: SMTP_NOT_CONFIGURED` when no SMTP is set up on the
server, and `send` answers 400 when there is nobody to send to — in both
cases the campaign keeps its previous status (it used to be flipped to
`sent` and consumed).

**`scheduled_at`** must be an ISO-8601 instant **with an explicit UTC
offset** (`2026-06-01T09:00:00Z` or `…T12:00:00+03:00`) and lie in the
future; otherwise 400. Before, a time in the past sent the campaign within
a minute and an offset-less time was read in the server's zone. Re-sending
the value already stored is always accepted, so saving an overdue scheduled
campaign unchanged doesn't fail.

**Each message** carries the recipient's own unsubscribe link, a
`List-Unsubscribe` header, and a plain-text part that includes the link
(the old text part dropped every URL). It is sent through the *campaign
lane*: `CAMPAIGN_SMTP_*` if set, otherwise the shared `SMTP_*` mailbox.

---

## Form submissions (admin workflow)

The public site writes to `POST /forms/contact` and
`POST /forms/proxy-visit` (both unauthenticated + rate-limited). Everything
else is the CMS inbox and needs `forms:read` / `forms:update` /
`forms:delete`.

| Route | Permission |
| --- | --- |
| `GET /forms/contacts`, `GET /forms/proxy-visits` | `forms:read` |
| `PATCH /forms/contacts/:id`, `PATCH /forms/proxy-visits/:id` | `forms:update` |
| `DELETE …/:id`, `GET …/trash`, `POST …/:id/restore` | `forms:delete` |

> ⚠️ **Setting a proxy visit to `COMPLETED` sends a real WhatsApp message
> to the visitor's phone number.** It fires only on an actual transition
> *into* `COMPLETED` (re-PATCHing `COMPLETED` does not re-send), and it is
> fire-and-forget — a failed send is logged but never fails your request, so
> a `200` does **not** mean the message was delivered. Do not use this
> endpoint to "test" status changes against real submissions.

**Statuses and their side-effects**

| Resource | Statuses | On transition |
| --- | --- | --- |
| Contact | `NEW` → `RESPONDED` \| `SPAM` | Entering `RESPONDED` stamps `responded_by` (the acting admin) + `responded_at`. |
| Proxy visit | `PENDING` → `APPROVED` \| `COMPLETED` \| `REJECTED` | Entering any of the three stamps `processed_by` + `processed_at`. Entering `COMPLETED` **also sends WhatsApp**. |

Stamping only happens when the status genuinely changes, so re-sending the
same status is idempotent and won't clobber the original actor or
timestamp. You may override the timestamp by passing `responded_at` /
`processed_at` (ISO 8601); omit it and the server uses now.

**Proxy-visit transitions are checked.** A status change outside this table
is a `400`; a valid change is applied with a compare-and-set, so if another
admin changed the row first you get a `409` — reload and retry.

| From | May go to |
| --- | --- |
| `PENDING` | `APPROVED`, `REJECTED`, `COMPLETED` |
| `APPROVED` | `COMPLETED`, `REJECTED`, `PENDING` |
| `REJECTED` | `PENDING`, `APPROVED` |
| `COMPLETED` | — (final: the visitor has been messaged) |

Moving back to `PENDING` clears `processed_by` / `processed_at`. The
WhatsApp message goes out only on a transition *into* `COMPLETED`, and
exactly once even if two admins click at the same moment. Contact
submissions use the same compare-and-set (`409` on a stale write), and
leaving `RESPONDED` clears `responded_by` / `responded_at`. The CMS
currently offers `PENDING → APPROVED | REJECTED` and
`APPROVED → COMPLETED`, which all remain valid.

**Admin notification e-mails are digests.** A new contact message or
proxy-visit request is stored first and announced by a cron (every minute)
as **one e-mail per burst** — never more often than
`FORM_NOTIFY_MIN_INTERVAL_SECONDS` (default 5 minutes). The recipient is
the `notifications_email_to` site setting, else `EMAIL_TO`, else
`info@imamzain.org`. A digest that can't be delivered leaves its rows
pending (`notified_at` stays `NULL`, `notification_failed_at` is set) and
they go out with the next one, so nothing is lost. `GET /dashboard/stats` →
`forms.unsent_notifications` counts rows stuck like that *right now* and
drops to 0 on its own once mail flows; historical failures from before the
digest existed are not counted. Submitting a form no longer sends any
e-mail inline, so a flood of submissions can't burn the SMTP quota.

**`notes` — internal admin annotation**

Both resources accept an optional `notes` string (max 2,000 chars) on
`PATCH`. It is independent of `status`:

```jsonc
// Save a note without touching status — fires no side-effects at all
PATCH /forms/proxy-visits/:id
{ "notes": "Visit completed 2026-02-03; photos sent to the family." }
```

Pass `""` to clear it; omit the key to leave it untouched. `notes` is
returned on the authenticated list/detail views and is **never** exposed
publicly — it is always `null` on the public submit response.

Both resources soft-delete: `DELETE` sets `deleted_at`, `GET …/trash` lists
deleted rows, and `POST …/:id/restore` brings one back. See
[Soft delete and restore](#soft-delete-and-restore).

---

## Rate limiting

Two layers of throttling (`@nestjs/throttler`), both keyed on the client
IP as resolved through `TRUST_PROXY_HOPS`:

- **Per route:** 1000 requests per 15 minutes per IP *per route handler*.
  This is the library's native keying — each handler has its own bucket —
  and is what the stricter per-endpoint overrides below replace.
- **API-wide:** **3000 requests per 15 minutes per IP across all routes**
  (`THROTTLE_GLOBAL_LIMIT`; 0 disables). This is the real ceiling for a
  client walking the whole API. Its counters are reported in the
  `X-RateLimit-*-global` headers; the per-route bucket keeps the unsuffixed
  `X-RateLimit-*` headers.

A handful of endpoints have stricter per-endpoint limits:

| Endpoint | Limit | Why |
| --- | --- | --- |
| `POST /auth/login` | 10 / 15 min / IP, **plus a per-username lockout** (below) | Anti-brute-force |
| `POST /auth/refresh` | 30 / 15 min / IP | Limits stolen-token replay |
| `PATCH /auth/me/password` | 5 / 15 min / IP | Anti-brute-force on current-password check |
| `POST /users/:id/reset-password` | 10 / 15 min / IP | Anti-abuse on admin-driven reset |
| `POST /newsletter/subscribe` | 5 / 15 min / IP | Anti-spam signups (each also costs a confirmation e-mail — see [double opt-in](#newsletter-double-opt-in)) |
| `POST /newsletter/confirm` | 10 / 15 min / IP | Confirmation link clicks |
| `POST /newsletter/unsubscribe` | 5 / 15 min / IP | Symmetric with subscribe |
| `POST /forms/contact` | 300 / hour / IP | Generous; flooding goes to admin inbox |
| `POST /forms/proxy-visit` | 300 / hour / IP | Same |
| `POST /posts/:id/view` | 30 / min / IP | View-counter abuse; also de-duplicated to one counted view per client IP per post per 30 minutes (a repeat inside the window still answers 200 "View tracked", it just doesn't increment). Other view-counter routes are rate-limited only — not yet de-duplicated |
| `POST /books/:id/view` | 30 / min / IP | Same |
| `POST /academic-papers/:id/view` | 30 / min / IP | Same |
| `POST /audios/:id/view` | 30 / min / IP | Same |
| `POST /gallery/:id/view` | 30 / min / IP | Same — `:id` is the **media** UUID |
| `GET /health` | 60 / min / IP | Generous; uptime probes only |
| `GET /homepage` | 120 / min / IP | Composite payload (several queries); CDN-cacheable, so far above any real need |
| `GET /sitemap.xml`, `GET /rss/posts.xml` | 20 / min / IP | Walk every published post; crawlers and feed readers fetch rarely |
| `POST /forms/qutuf-sajjadiya-contest/start`, `…/submit` | 60 / 15 min / IP each (`CONTEST_THROTTLE_PER_IP`) | Row-spam and answer probing; generous because classrooms share a NAT |

Hitting any limit returns **429 Too Many Requests** with the standard
error envelope. The response body's `error` field tells the user to
slow down; the front-end should not retry automatically.

**Login lockout (per username).** Independent of the per-IP limit above:
5 failed logins for the same username within 15 minutes lock that username
out. The wait starts at 60 seconds and doubles with each further failure,
up to 15 minutes. While locked, `POST /auth/login` answers **429** with
`code: AUTH_LOGIN_LOCKED` and a `Retry-After` header (seconds) — and even the
correct password is refused, so a guesser can't keep going. A successful
login clears the count. The counter is kept for unknown usernames too, so
the lockout can't be used to find out which accounts exist, and a failure
of the counter's own storage never blocks a login. Each failed attempt
writes a `USER_LOGIN_FAILED` audit row (reason `bad_password`,
`unknown_username` or `locked`; the attempted username is never stored,
because it is often a mistyped password). Passwords must now be **at least
10 characters** when created, reset by an admin or changed (login itself
still accepts the old 6-character minimum, so existing accounts can sign
in); `JWT_SECRET` must be at least 32 characters.

**Contest endpoints.** The Qutuf Sajjadiya contest concluded on 2026-09-03
(286 attempts, 120 submitted). Both `/start` and `/submit` now first check a
`contest_open` site setting (boolean; seeded `false`) and answer
**403 `CONTEST_CLOSED`** unless it reads the literal string `"true"` — a
missing row is treated as closed, not open. `GET /questions` and the admin
`GET /attempts` are unaffected. Reopen for a future contest with
`PUT /settings/contest_open { "value": "true" }` (permission
`settings:update` — the generic settings endpoint; there is no dedicated
contest open/close endpoint). The rest of this section describes behaviour
that only matters while it is open.

`POST /forms/qutuf-sajjadiya-contest/start` and
`/submit` are limited to **60 requests / 15 min per IP** each
(`CONTEST_THROTTLE_PER_IP`). The ceiling is generous on purpose: in a live
contest 200+ students share a school or university NAT, and the original
design (no per-endpoint limit at all) existed for exactly that reason. A
20-per-15-minutes limit added later contradicted it and would have locked
out a classroom; 60 keeps a room working while still stopping one client
from spraying attempts or probing answers. Abuse is also gated in the
database: a partial unique index on `qutuf_sajjadiya_contest_attempts.phone`
and `.email` allows one attempt per identity (`00964…` and `+964…` count as
the same phone), and each `attempt_id` can be submitted only once.
`/start` is **idempotent for an unsubmitted attempt**: calling it again
with the same contact returns the same `attempt_id` and `attempt_token`
(`resumed: true`) instead of a 409, so a lost response no longer locks the
participant out; only a *submitted* attempt answers 409. With
`CONTEST_REVEAL_SCORE=false`, `/submit` returns `final_score: null`
(`score_revealed: false`) and the committee announces results from
`GET /forms/qutuf-sajjadiya-contest/attempts` — use that for a contest with
a prize, since an instant score for an unverified identity lets someone work
out the answer key.


---

## Public URL conventions

The API doesn't render HTML, but it does emit canonical URLs in two
places: `sitemap.xml` and `rss/posts.xml`.

imamzain.org is served as a **single Arabic site**: `<html lang="ar"
dir="rtl">` is hardcoded and there is no `[lang]` route segment. None of
these URLs therefore carry a language prefix.

### Post URL

```text
${PUBLIC_SITE_URL}/news/{slug}
```

Default: `https://imamzain.org/news/{slug}`. Set `PUBLIC_SITE_URL` to
override.

### Other resource URLs (emitted in the sitemap)

```text
${PUBLIC_SITE_URL}/his-life/{slug}            ← static pages
${PUBLIC_SITE_URL}/library/books/{slug}       ← books with a slug
```

**Academic papers and audios are not in the sitemap.** The public site
has no detail route for either: `/research/scientific-platform` is one
page that opens papers in a modal, and `/media/audio` is one page with
`?id=` deep links. Add the builders back to
`src/feeds/feeds.service.ts` when those routes exist.

Books without a slug are intentionally omitted (no SEO-friendly URL to
advertise). Books are currently reachable at both `/library/books/{slug}`
and `/publications/{slug}`; the sitemap advertises the former.

> ⚠️ **In practice the sitemap currently contains posts and static pages
> only — 89 URLs.** Because no book or audio has ever been given a slug and
> academic papers have no slug column, all books (95 top-level entries —
> series parts are excluded from the sitemap query the same way they're
> excluded from every list endpoint, see [CMS-INTEGRATION-NOTES.md](CMS-INTEGRATION-NOTES.md)
> round 20), 310 audios and 1,260 papers are all absent from it. That is the
> direct SEO cost of the empty slug columns described in
> [Human-readable URLs](#human-readable-urls-by-slug); backfilling book and
> audio slugs is what would put them in.

### No hreflang alternates

Because there is no per-language URL, a row's translations all resolve
to one canonical URL. Emitting one `<url>` per translation would
advertise the same page several times, so the sitemap emits **one entry
per row**, using the row's single canonical `slug`.

The front-end **must** match these URL patterns for the sitemap to be
correct. Changing the front-end's URL structure means updating the
route table at the top of `src/feeds/feeds.service.ts`.

### Sitemap pickup

Reference the sitemap in `robots.txt`:

```text
Sitemap: https://api.imamzain.org/api/v1/sitemap.xml
```

### RSS pickup

Add a `<link rel="alternate">` to the public site's `<head>`:

```html
<link rel="alternate" type="application/rss+xml"
      title="ImamZain.org"
      href="https://api.imamzain.org/api/v1/rss/posts.xml" />
```

---

## Cron schedules

The API runs eight background jobs on cron schedules. Front-end
behaviour should account for the latency.

| Job | Schedule | What it does |
| --- | --- | --- |
| Scheduled post publishing | every minute | Flips `is_published=true` on posts whose `published_at <= now()` and were left as drafts. One `updateMany` per tick; audit-logs each transition with `{ scheduled: true, by: 'cron' }`. |
| Newsletter campaign sender | every minute | First promotes `scheduled` campaigns whose `scheduled_at <= now()` into `sending`. Then gives each `sending` campaign (oldest first, paused ones skipped) a batch of due recipients: at most `NEWSLETTER_BATCH_SIZE` (10), and at most what the rolling-hour budget `NEWSLETTER_SEND_PER_HOUR` (80) still allows. Per recipient: claim the row → send → mark `sent_at` immediately; a transient failure backs off and retries, a server-side failure pauses the campaign. Advisory-locked so one instance sends per tick. See [Newsletter campaign delivery](#newsletter-campaign-delivery). |
| Form notification digest | every minute | Sends ONE e-mail for the contact / proxy-visit submissions no admin has been told about yet — at most one per `FORM_NOTIFY_MIN_INTERVAL_SECONDS` (default 300 s). A failed send leaves the rows queued for the next digest. Advisory-locked. |
| YouTube channel mirror sync | every 6 hours (plus once 30 s after boot) | Pulls the configured channel's videos + playlists into the local DB so the homepage / `/youtube/*` endpoints never hit the YouTube Data API on the request path. Gated by a Postgres advisory lock + a recency check, so a multi-instance fleet performs exactly one sync per window (no N× quota burn). After a complete sync it also **prunes** videos and playlists that no longer exist on YouTube: each candidate is re-checked by id first, and a sync that would delete more than `max(10, 25 % of the mirror)` is treated as suspicious and skips pruning (logged). Silently skipped when `YOUTUBE_API_KEY` / `YOUTUBE_CHANNEL_ID` are unset. |
| Orphan upload cleanup | every hour | Deletes `pending_media_uploads` rows older than the pre-signed URL TTL that were never confirmed via `POST /media/confirm`. Also purges the abandoned R2 object so the bucket doesn't accumulate dead keys. |
| Login-attempt sweep | daily at 03:20 | Deletes `login_attempts` rows (the per-username lockout counters) idle for more than 24 h. |
| Refresh-token cleanup | daily at 03:15 | Drops `refresh_tokens` rows past `expires_at` and revoked rows older than 30 days (past the reuse-detection grace window). |
| Audit-log retention | daily at 03:30 | Drops `audit_logs` rows older than **365 days**. Window is configurable via `AUDIT_LOG_RETENTION_DAYS` in `src/common/audit/audit.service.ts`. The CMS audit-log viewer should not assume rows are available forever. |

So:

- A post scheduled for `09:00:00` may not flip live until `09:00:30` at
  earliest. The CMS UI should display "scheduled for…" with a hint that
  it may go live up to a minute late.
- A newsletter campaign is **paced**, not drained: with the default
  budget of 300 messages an hour, 200 subscribers take about 40 minutes and
  1,300 a bit over 4 hours. The CMS progress bar (`delivered_count /
  recipient_count`) updates as the cron progresses; show an ETA.
- Admin notification e-mails for new form submissions arrive as a digest
  up to 5 minutes (`FORM_NOTIFY_MIN_INTERVAL_SECONDS`) after the first
  submission of a burst, not instantly.

---

## Caching strategy + cost notes for consumer apps

The API runs on Supabase (Postgres) + a single Node process. Origin
work scales linearly with hit volume unless the CDN absorbs it. This
section is the **action list** for the CMS and front-end teams to keep
costs predictable as traffic grows.

### What the API ships with (already done)

| Endpoint(s) | `Cache-Control` | Why this TTL |
| --- | --- | --- |
| `GET /posts`, `/posts/by-slug/:slug`, `/posts/:id` | `public, max-age=60, s-maxage=300` | Posts can be edited / published throughout the day; 5 min CDN cache absorbs ~99% of repeat traffic without serving very stale content. |
| `GET /books`, `/books/:id`, `/academic-papers*`, `/gallery*` | `public, max-age=60, s-maxage=300` | Same shape as posts. |
| `GET /post-categories`, `/book-categories`, `/gallery-categories`, `/academic-paper-categories` | `public, max-age=300, s-maxage=1800` | Categories change rarely; 30 min CDN TTL is comfortable. |
| `GET /languages` | `public, max-age=3600, s-maxage=86400` | Essentially immutable; 24h CDN TTL. |
| `GET /settings/public` | `public, max-age=900, s-maxage=3600` | Site-config changes propagate within an hour. |
| `GET /search` | `public, max-age=30, s-maxage=60` | Popular queries get amortised; new content surfaces within 1 minute. |
| `GET /forms/qutuf-sajjadiya-contest/questions` | `public, max-age=300, s-maxage=3600` | Questions change rarely. |
| `GET /sitemap.xml`, `/rss/posts.xml` | `public, max-age=900, s-maxage=900` | Already set independently. |
| `GET /homepage` | `public, max-age=<n>, s-maxage=<m>` — clamped, see below | The single most-hit public route — up to 15 min browser cache, up to 1 h CDN cache. |
| `GET /daily-hadiths/today` | `public, max-age=<n>, s-maxage=<m>` — clamped, see below | Feeds the homepage. Stable for the whole site-timezone day either way — a scheduled hadith by editor choice, or a random pick locked in at the source the first time that day is resolved with nothing scheduled — so every visitor sees the same answer regardless of caching. |
| `GET /daily-hadiths` (lookup by date/range, or plain browse) | `public, max-age=300, s-maxage=1800` | Same cadence as categories — hadiths are scheduled rarely, and this is a plain lookup with no random fallback. |

Only `/daily-hadiths/today` and `/homepage` clamp their TTL to the site's
calendar day (see [Site time zone and the daily hadith day
boundary](#site-time-zone-and-the-daily-hadith-day-boundary) below) —
every other row above is a fixed header.

All cached endpoints set `Vary: Accept-Language` so Arabic and English
versions are cached separately at the edge.

Every JSON response — success **or error** — also carries a weak
`ETag`, hashed over the response body **without** the envelope's
`timestamp` field (so the timestamp changing on every call doesn't
defeat caching), and the ETag survives compression. A request with a
matching `If-None-Match` gets back `304 Not Modified` with **no body**
— the `timestamp` a client sees on a 304 is whatever it cached from the
earlier 200, so don't use the envelope `timestamp` as a freshness
signal. Browsers revalidate like this on their own once a cached copy
passes `max-age`; a 304 saves bandwidth, not server work — the handler
and its queries still run before the ETag is compared. Every **error**
response additionally carries `Cache-Control: no-store`, so a 404 / 400
/ 429 is never held at a CDN edge even on an otherwise cacheable route.

### Site time zone and the daily hadith day boundary

"Today" for the daily hadith (and the `hadith_of_day` picked into `GET
/homepage`) is the calendar day in `SITE_TIMEZONE` — an IANA zone name,
default `Asia/Baghdad` (UTC+3, no DST) — not UTC and not the visitor's
browser clock. `meta.date` on `GET /daily-hadiths/today` is that
site-timezone date; compute "today" client-side in the same zone or
you'll disagree with the API for a few hours a day.

The `Cache-Control` on `GET /daily-hadiths/today` and `GET /homepage` is
not a constant: `max-age = min(900, secondsUntilSiteMidnight)` and
`s-maxage = min(3600, secondsUntilSiteMidnight)`, never below 1. Mid-day
that's the usual `900` / `3600`; in the hour before site midnight the
values shrink to reach `0` right at the boundary, so no cache — CDN or
browser — can hold yesterday's hadith into the new day. **Read the TTL
from the response; don't hardcode it.** A server-side cache the
front-end layers on top (Next.js `fetch` revalidate, ISR) is independent
of these headers — keep its window at or below 900 s, revalidate at
site midnight, or read `s-maxage` off the response.

### What the CMS needs to do

The CMS makes authenticated requests, so **none of its endpoints are
CDN-cacheable** — Cloudflare correctly bypasses cache when an
`Authorization` header is present (or a `Cache-Control: no-store`
default kicks in for any non-cacheable response). That's by design.
The optimisations the CMS can make are around request shape:

1. **Use the new `?status=draft|scheduled|published` filter on `GET /posts/admin`.** Server-side filtering is cheaper than fetching all and filtering in JS, and the response is 60–80% smaller.
2. **Use `GET /media?search=<term>&mime_type=image/jpeg`.** The media picker should ALWAYS pass a search or mime filter once the library grows past ~50 items. Trigram indexes are in place; the query stays fast indefinitely.
3. **Debounce search input by ≥ 300ms before calling `GET /search`** or the post / media `?search=`. Trigram indexes keep individual queries fast (~5–10 ms each), but un-debounced search fires one DB query per keystroke per concurrent user. 300ms is the standard floor.
4. **Don't poll `GET /dashboard/stats` faster than every 30 seconds.** The response is cached server-side for 30 s (recent perf pass); polling more frequently doesn't change what comes back, just burns network. The server returns the same JSON until the cache expires.
5. **Read the JWT's `permissions[]` array locally to drive button-visibility.** Do not re-call `GET /auth/me` per route render. The JWT is good for 24h; decode it once on login.
6. **For the campaign composer, fetch the recipient count once via `GET /newsletter/subscribers?is_active=true&limit=1` and read `pagination.total`.** Don't repeat this on every keystroke.

### What the front-end needs to do

This is where the biggest cost savings live, because the public site is
the bulk of the traffic.

1. **Route ALL public reads through the CDN, not direct to the API origin.** Cloudflare should be the first hop. Confirm in your DNS: `api.imamzain.org` resolves to a Cloudflare-proxied record (orange cloud).
2. **In Cloudflare's cache rules, set "Respect origin Cache-Control" to ON.** The defaults usually do this, but verify. If a cache rule overrides our headers (e.g. "Browser cache TTL: 1 day"), the front-end will see stale content.
3. **Use `GET /homepage` instead of three separate `/posts` calls.** Already the case if you start fresh; if there's existing code calling `/posts?featured=true` + `/posts?sort=views` + `/posts?sort=newest`, swap it. Cuts origin load on the busiest route by 3×.
4. **Always render `<img srcset>` from `media.variants[]`, never the original URL.** Saves both bandwidth and visitor-side bytes. The variants are already pre-baked; using them costs nothing extra.
5. **Build-time fetch `/settings/public` and bundle the result into the static site.** Refresh on each rebuild (or every hour via ISR / on-demand revalidation). Don't re-fetch it per-page-render.
6. **Build-time fetch `/languages` too** — these change essentially never.
7. **Add the sitemap reference to `robots.txt`** so search engines pull from `${PUBLIC_SITE_URL}/robots.txt → Sitemap: …/sitemap.xml`. Don't fetch the sitemap at runtime.
8. **For the public search bar, debounce ≥ 300ms and abort in-flight requests on next keystroke.** Same reason as for the CMS.
9. **Don't call `POST /posts/:id/view` if the visitor is bouncing.** Trigger it after a 5 s dwell timer; the current rate-limit (30/min/IP) protects the API but you'd still rather not waste the call when you know the visitor isn't really reading.
10. **Use `<link rel="alternate" hreflang>` on every post page.** The translations array on the response carries the alternates — read it once and emit the tags. Avoids penalties from search engines treating Arabic/English versions as duplicate content.

### What to monitor

- **Cloudflare Analytics → Cache Status** — target ≥ 90% cache hit rate on `/api/v1/posts*`, `/api/v1/books*`, `/api/v1/gallery*`, `/api/v1/homepage`. If hit rate is low, check that Cloudflare isn't stripping `Vary: Accept-Language` or that the front-end isn't appending cache-busting query params.
- **Supabase Query Performance** — flag any query > 100ms p95 on `posts`, `book_translations`, `media`. The trigram + B-tree indexes added in round 6 should keep these well below the threshold.
- **`/dashboard/stats` p95** — should stay < 50 ms (response is now cached in-process for 30 s and the 4 post counts collapsed into a single `FILTER`-based query). If it climbs, profile the underlying counts.

### What's deliberately NOT cached

- All admin endpoints (anything requiring JWT)
- `POST /*` writes
- `/auth/me`, `/dashboard/stats`, `/audit-logs`
- `POST /posts/:id/view`, `/books/:id/view` (mutations)
- `/health` (live status check)
- `/forms/contact`, `/forms/proxy-visit`, `/newsletter/subscribe`

---

## Required environment variables

For the CMS / front-end deployment, the API's env config is the
authoritative spec. See [.env.example](../.env.example) for the
complete list. The ones the front-end may need to know about:

| Var | Default | Front-end implication |
| --- | --- | --- |
| `PUBLIC_SITE_URL` | `https://imamzain.org` | The canonical origin the sitemap + RSS link to. Must match the front-end's deployed origin. |
| `PUBLIC_SITE_NAME` | `Imam Zain Foundation` | The RSS feed's `<channel><title>`. |
| `SITE_TIMEZONE` | `Asia/Baghdad` | The calendar-day boundary for `GET /daily-hadiths/today` and the homepage's `hadith_of_day` (and the cache-TTL clamp on both). Compute "today" in this zone, not UTC or the browser's local zone. |
| `NEWSLETTER_UNSUBSCRIBE_URL_BASE` | `https://imamzain.org/newsletter/unsubscribe` | The page the front-end serves to handle unsubscribe links. Must accept `?email=&token=` and POST them to the API. |
| `NEWSLETTER_CONFIRM_URL_BASE` | `https://imamzain.org/newsletter/confirm` | The page the double-opt-in confirmation e-mail links to. Must accept `?email=&token=` and POST them to `/newsletter/confirm` (on a button press, ideally). |
| `NEWSLETTER_SEND_PER_HOUR` | `300` | Campaign delivery budget (messages / rolling hour, all campaigns). Drives how long a campaign takes — show an ETA in the CMS. |
| `CONTEST_REVEAL_SCORE` | reveal | With `false`, `/submit` returns `final_score: null` — the contest page must then show "your answers were received" instead of a score. |
| `ALLOWED_ORIGINS` | (required in prod) | The API's CORS allowlist. The front-end's origin must be on this list — otherwise browsers will block the calls. |
| `REDIS_URL` | unset (in-process) | Set in **multi-instance** deployments only. Enables a shared throttler counter across processes and pub/sub-driven JWT cache invalidation. Unset = in-process fallbacks (correct for single-instance prod and dev). |

### Multi-instance correctness

Two pieces of state matter only when the API runs as >1 process behind
a load balancer:

1. **Throttler counters.** In-memory by default — N instances means N
   independent buckets, so both the per-route 1000/15min and the
   API-wide 3000/15min limits effectively become N× larger. With
   `REDIS_URL` set, counters live in Redis
   (`@nest-lab/throttler-storage-redis`); one shared bucket per IP
   across the fleet.
2. **JWT user cache.** The validate path keeps a 30 s in-process cache
   per user so authenticated requests skip a `users.findUnique`. When
   a password change / admin reset / soft-delete invalidates the
   cache, instance A publishes the user id on the `jwt-cache:invalidate`
   Redis channel; every other instance drops its local copy within
   milliseconds. Without Redis, the invalidation is local only and
   peer instances serve the stale row for up to 30 s.

If `REDIS_URL` is set but Redis is briefly unreachable, the API still
boots and serves requests — ioredis retries with backoff, throttler
degrades to in-memory counters until reconnection, pub/sub starts
working again on reconnect. No request path blocks on Redis being up.

---

## See also

- [`/docs`](https://api.imamzain.org/docs) — interactive Scalar UI; per-endpoint reference.
- [permissions.md](permissions.md) — full permission catalogue, default role mappings, and audit-action vocabulary.
- [CMS-INTEGRATION-NOTES.md](CMS-INTEGRATION-NOTES.md) — chronological release notes per round of API changes.
