# Integration Guide

The reference companion to the OpenAPI spec at [`/docs`](https://api.imamzain.org/docs).
Scalar tells you what each endpoint does; this document covers the
cross-cutting concepts a CMS / front-end developer needs once, then
reuses everywhere.

- [Response envelope](#response-envelope)
- [Error envelope + error codes](#error-envelope--error-codes)
- [Pagination](#pagination)
- [Authentication flow](#authentication-flow)
- [Authorisation (permissions)](#authorisation-permissions)
- [Language resolution](#language-resolution)
- [Soft delete and restore](#soft-delete-and-restore)
- [Media upload (two-step flow)](#media-upload-two-step-flow)
- [Rich-text body sanitisation](#rich-text-body-sanitisation)
- [Newsletter unsubscribe scheme](#newsletter-unsubscribe-scheme)
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
| `INVALID_IDENTIFIER` | 400 | Malformed UUID in an id path/query param (used to surface as 500) |
| `PAYLOAD_TOO_LARGE` | 413 | Upload / body over the size cap |
| `RATE_LIMITED` | 429 | Throttle limit hit |
| `INTERNAL_ERROR` | 500 | Unhandled server error |

Endpoint-specific overrides (more precise than the status default):

| `code` | HTTP | Where |
| --- | --- | --- |
| `AUTH_REFRESH_INVALID` | 401 | `POST /auth/refresh` — token unknown or expired |
| `AUTH_TOKEN_REUSED` | 401 | `POST /auth/refresh` — a revoked token was replayed; **the whole session chain is now revoked**, force a fresh login |
| `AUTH_REFRESH_ALREADY_ROTATED` | 401 | `POST /auth/refresh` — lost the rotation race; retry once with the newest token |
| `AUTH_ACCOUNT_DISABLED` | 401 | The account was soft-deleted; re-auth won't help |

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
- `limit` defaults to 20 and is **clamped server-side to [1, 100]**.
  `?limit=999999` does not return the whole table — the server treats
  the request as `limit=100`. This is enforced both by the DTO and by
  the pagination utility itself (defence-in-depth).
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
list response. Internal fields (`created_at`, `uploaded_by`,
`file_size`) live on the detail endpoint only.

### SEO fields on detail payloads

Posts, books, academic papers, and static pages carry per-translation
`meta_title`, `meta_description`, and `og_image_id`. The **detail**
endpoints additionally resolve `og_image_id` into an `og_image` object
(`{ id, url, filename, alt_text, mime_type, width, height }`) so the
front-end gets a usable image URL, not a bare UUID. List payloads keep
only the scalar `og_image_id`.

### Human-readable URLs (`by-slug`)

Posts and static pages have always had per-language slugs. Books and
academic papers now accept an **optional** editor slug per translation
too, exposed at `GET /books/by-slug/:slug` and
`GET /academic-papers/by-slug/:slug`. Slugs are nullable — a book/paper
without one stays reachable only by UUID, and `by-slug` returns 404 for
it. Set a slug via the translation object on create / update.

**Audios** accept an **optional** canonical `slug` (a single,
language-agnostic column — the English slug is stable for SEO), exposed at
`GET /audios/by-slug/:slug` with the same nullable semantics. Speakers are
addressed by UUID only (no slug).

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

Audio + companion-PDF files are uploaded to R2 via
`POST /audios/upload-url` (pre-signed PUT; send the same `Content-Type` on
the PUT as you declared) and the returned `publicUrl` is saved onto the
record's `audio_url` / `pdf_url`. `durationSeconds` / `sizeMB` / `peaks`
are computed client-side at upload time and POSTed with create — see
`docs/CMS-INTEGRATION-NOTES.md` §17 for the browser extractor.

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
issues a new one. If a **revoked** refresh token is replayed, the server
revokes **every** refresh token for that user — all sessions log out
worldwide. This makes refresh-token theft self-defeating.

### Invalidating tokens globally

Both `PATCH /auth/me/password` and `POST /users/:id/reset-password` bump
`token_version` and revoke every active refresh token. The user's
existing access tokens fail their next request (the `token_version` no
longer matches), and they're forced to re-login.

### Logout

`POST /auth/logout` with `{ refresh_token: "…" }` revokes just that
refresh token. Omit the body to revoke **all** the current user's
refresh tokens.

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

1. If `Accept-Language` matched a stored translation → use it.
2. Otherwise → use the translation flagged `is_default: true`.
3. Otherwise → use the first translation.
4. If there are no translations → `null`.

The front-end can read `translation` directly without reproducing this
logic. The full `translations[]` array stays available for language
switchers.

### Cross-resource search caveat

`GET /search` is the one exception: it returns the translation that
**actually matched** the query, not the language-resolved one. An
Arabic search that hits an English summary will return the English row
— this is intentional, so search results faithfully reflect what was
indexed.

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

For resources with unique columns scoped to live rows (post / static-page
/ category translation slugs, the new optional book / academic-paper
translation slugs, `books.isbn`, and `users.username`), the API suffixes
the value on delete to free it up:

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

### Hard delete

Soft delete is the default for content. The exceptions:

- **Newsletter campaigns** in `draft` or `cancelled` state can be
  hard-deleted via `DELETE /newsletter/campaigns/:id`.
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

On `/media/confirm`, the API runs `sharp` to produce WebP variants at
**320, 768, 1280, and 1920 px** widths (skipping any that would
upscale). EXIF orientation is applied and stripped, so sideways phone
photos come out the right way up. `sharp` is capped at 50 megapixels of
input so a malicious 30000×30000 PNG fails fast instead of OOM-ing the
dyno.

**Variant generation runs in the background**, off the request path.
`/media/confirm` returns immediately with `variants: []` so the
editor isn't blocked by a 2–5 s `sharp` decode. The generated rows
appear in subsequent reads of the media row:

```text
1. POST /media/confirm        →   { ..., variants: [] }      // 200 OK, immediate
2. (background, ~1–3 s)            sharp encodes 4 widths,
                                   media_variants rows insert
3. GET  /media/:id            →   { ..., variants: [ ... 4 rows ... ] }
```

CMS recommendation: poll `GET /media/:id` every ~500 ms until
`variants.length === 4` if the upload UI displays the variants.
Otherwise (the public site is the consumer), no polling needed — the
original `url` is fully usable while variants are still being written.

If generation failed and `variants[]` stays empty past 5–10 s, call
`POST /media/:id/regenerate-variants`.

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

### Delete safety

`DELETE /media/:id` returns 409 if the media is still referenced by any
post, book, gallery image, or attachment. Detach the references first.

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

- `target="_blank"` links automatically get `rel="noopener noreferrer"`
  to defeat reverse tab-nabbing.

### Size cap

The body field is capped at **200 KB UTF-8** (matches the CMS-side
`MAX_BODY_BYTES`). Requests over the cap return 400.

### Defence-in-depth, not replacement

The CMS should still run its own client-side `sanitizeEditorHtml`
before submit. The server pass is a backstop, not the primary defence
— editor feedback while typing is still client-driven.

---

## Newsletter unsubscribe scheme

### How tokens are issued

`POST /newsletter/subscribe` returns:

```jsonc
{
  "data": {
    "id": "uuid…",
    "email": "reader@example.com",
    "unsubscribe_token": "a3f2…"   // HMAC-SHA256(email, secret)
  }
}
```

The token is **derived from the email + a server-side secret**
(`NEWSLETTER_UNSUBSCRIBE_SECRET`, falls back to `JWT_SECRET`). It is
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
POST /newsletter/subscribers/:id/resubscribe      (admin, no token)
```

Both are idempotent. Permission: `newsletter:update`.

---

## Rate limiting

A global throttler (`@nestjs/throttler`) sets a ceiling of **1000
requests per 15 minutes per IP**. A handful of endpoints have stricter
per-endpoint limits:

| Endpoint | Limit | Why |
| --- | --- | --- |
| `POST /auth/login` | 10 / 15 min / IP | Anti-brute-force |
| `POST /auth/refresh` | 30 / 15 min / IP | Limits stolen-token replay |
| `PATCH /auth/me/password` | 5 / 15 min / IP | Anti-brute-force on current-password check |
| `POST /users/:id/reset-password` | 10 / 15 min / IP | Anti-abuse on admin-driven reset |
| `POST /newsletter/subscribe` | 5 / 15 min / IP | Anti-spam signups |
| `POST /newsletter/unsubscribe` | 5 / 15 min / IP | Symmetric with subscribe |
| `POST /forms/contact` | 300 / hour / IP | Generous; flooding goes to admin inbox |
| `POST /forms/proxy-visit` | 300 / hour / IP | Same |
| `POST /posts/:id/view` | 30 / min / IP | View-counter abuse |
| `POST /books/:id/view` | 30 / min / IP | Same |
| `GET /health` | 60 / min / IP | Generous; uptime probes only |

Hitting any limit returns **429 Too Many Requests** with the standard
error envelope. The response body's `error` field tells the user to
slow down; the front-end should not retry automatically.

> **Note on contest endpoints.** `POST /forms/qutuf-sajjadiya-contest/start`
> and `POST /forms/qutuf-sajjadiya-contest/submit` have **no per-endpoint
> throttle** — only the global ceiling applies. This was intentional: in a
> live contest, 200+ students share a school/uni NAT and would all hit one
> bucket. Abuse is gated at the database level instead: a partial unique
> index on `qutuf_sajjadiya_contest_attempts.phone` and `.email` prevents
> repeat attempts from the same identity, and each `attempt_id` can only
> be submitted once.

---

## Public URL conventions

The API doesn't render HTML, but it does emit canonical URLs in two
places: `sitemap.xml` and `rss/posts.xml`. Both use the same pattern.

### Post URL

```text
${PUBLIC_SITE_URL}/{lang}/posts/{slug}
```

Default: `https://imamzain.org/{lang}/posts/{slug}`. Set
`PUBLIC_SITE_URL` to override.

### Other resource URLs (emitted in the sitemap)

```text
${PUBLIC_SITE_URL}/{lang}/{slug}                    ← static pages
${PUBLIC_SITE_URL}/{lang}/books/{slug}              ← books with a slug
${PUBLIC_SITE_URL}/{lang}/academic-papers/{slug}    ← papers with a slug
${PUBLIC_SITE_URL}/audios/{slug}                    ← audios with a slug (single, language-agnostic)
```

The front-end **must** match these URL patterns for the sitemap to be
correct. Changing the front-end's URL structure means updating the
sitemap helpers in `src/feeds/feeds.service.ts`. Books / papers without
a slug are intentionally omitted from the sitemap (no SEO-friendly URL
to advertise).

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

The API runs seven background jobs on cron schedules. Front-end
behaviour should account for the latency.

| Job | Schedule | What it does |
| --- | --- | --- |
| Scheduled post publishing | every minute | Flips `is_published=true` on posts whose `published_at <= now()` and were left as drafts. One `updateMany` per tick; audit-logs each transition with `{ scheduled: true, by: 'cron' }`. |
| Newsletter campaign sender | every minute | Processes 50 pending recipients per campaign per tick. Sends in parallel with a concurrency cap of 5 SMTP connections; the wall-clock per tick dropped from ~50 s to a few seconds. Crash-safe — resumes from `sent_at IS NULL AND failed_at IS NULL`. |
| Newsletter campaign promoter | every minute | Promotes campaigns with `status=scheduled` whose `scheduled_at <= now()` into `sending`. |
| YouTube channel mirror sync | every 6 hours (plus once 30 s after boot) | Pulls the configured channel's videos + playlists into the local DB so the homepage / `/youtube/*` endpoints never hit the YouTube Data API on the request path. Gated by a Postgres advisory lock + a recency check, so a multi-instance fleet performs exactly one sync per window (no N× quota burn). Silently skipped when `YOUTUBE_API_KEY` / `YOUTUBE_CHANNEL_ID` are unset. |
| Orphan upload cleanup | every hour | Deletes `pending_media_uploads` rows older than the pre-signed URL TTL that were never confirmed via `POST /media/confirm`. Also purges the abandoned R2 object so the bucket doesn't accumulate dead keys. |
| Refresh-token cleanup | daily at 03:15 | Drops `refresh_tokens` rows past `expires_at` and revoked rows older than 30 days (past the reuse-detection grace window). |
| Audit-log retention | daily at 03:30 | Drops `audit_logs` rows older than **365 days**. Window is configurable via `AUDIT_LOG_RETENTION_DAYS` in `src/common/audit/audit.service.ts`. The CMS audit-log viewer should not assume rows are available forever. |

So:

- A post scheduled for `09:00:00` may not flip live until `09:00:30` at
  earliest. The CMS UI should display "scheduled for…" with a hint that
  it may go live up to a minute late.
- A newsletter campaign sent to 200 subscribers takes about 4 ticks ≈
  4 minutes to fully drain. The CMS progress bar (`delivered_count /
  recipient_count`) updates as the cron progresses.

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
| `GET /homepage` | `public, max-age=900, s-maxage=3600` | The single most-hit public route — 15 min browser cache, 1 h CDN cache. |

All cached endpoints set `Vary: Accept-Language` so Arabic and English
versions are cached separately at the edge.

Every JSON response also carries an `ETag` (Express auto-emits a weak
ETag from the response body hash). The CDN converts `If-None-Match`
revalidations into 304s automatically — no extra work on the consumer
side.

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
| `NEWSLETTER_UNSUBSCRIBE_URL_BASE` | `https://imamzain.org/newsletter/unsubscribe` | The page the front-end serves to handle unsubscribe links. Must accept `?email=&token=` and POST them to the API. |
| `ALLOWED_ORIGINS` | (required in prod) | The API's CORS allowlist. The front-end's origin must be on this list — otherwise browsers will block the calls. |
| `REDIS_URL` | unset (in-process) | Set in **multi-instance** deployments only. Enables a shared throttler counter across processes and pub/sub-driven JWT cache invalidation. Unset = in-process fallbacks (correct for single-instance prod and dev). |

### Multi-instance correctness

Two pieces of state matter only when the API runs as >1 process behind
a load balancer:

1. **Throttler counters.** In-memory by default — N instances means N
   independent buckets and the 1000/15min global limit effectively
   becomes 1000 × N. With `REDIS_URL` set, counters live in Redis
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
