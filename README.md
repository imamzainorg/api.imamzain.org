# ImamZain API

REST API powering [imamzain.org](https://imamzain.org) — Islamic content management, digital library, gallery, and public forms.

## Table of Contents

- [Tech Stack](#tech-stack)
- [Features](#features)
- [Prerequisites](#prerequisites)
- [Local Development](#local-development)
- [Environment Variables](#environment-variables)
- [Scripts](#scripts)
- [Project Structure](#project-structure)
- [API Reference](#api-reference)
- [Deployment](#deployment)

---

## Tech Stack

| Layer | Technology |
| --- | --- |
| Framework | NestJS 11 (TypeScript 6) |
| Database | PostgreSQL via Supabase |
| ORM | Prisma 6 (SQL migrations via `prisma migrate deploy` + typed client) |
| Auth | JWT + Passport |
| Storage | Cloudflare R2 (pre-signed URLs) |
| Email | Nodemailer + Hostinger SMTP |
| WhatsApp | Twilio SDK |
| Rate limiting | @nestjs/throttler |
| Logging | Pino (structured JSON) |
| Error monitoring | Sentry (production only) |
| API docs | Scalar (OpenAPI 3.0 at `/docs`) |

---

## Features

- Multi-language content — send `Accept-Language: ar` (or any ISO 639-1 code) to get translated responses, with automatic fallback to the default translation when one isn't available
- Role-based access control (RBAC) with per-permission granularity
- JWT authentication with bcrypt password hashing, atomic refresh-token rotation, and reuse detection that revokes the whole token chain when an already-rotated token is replayed
- File uploads via Cloudflare R2 pre-signed URLs, with server-side MIME enforcement and ownership-bound confirmation (the user that requested the URL is the only one who can register the resulting media row)
- Pre-generated WebP variants (320 / 768 / 1280 / 1920 px) on upload via [`sharp`](https://sharp.pixelplumbing.com/) — generated **in the background** off the request path, so the confirm response returns in single-digit milliseconds and the public site can serve responsive images via `<img srcset>` once the variants land (~1–3s later)
- Server-side HTML sanitisation of rich-text body fields (Tiptap output) using a strict allowlist that mirrors the CMS editor's schema; defends against admin-session compromise and frontend rendering surfaces that use `dangerouslySetInnerHTML`
- HTML-escaped admin notification emails to defuse stored XSS via form fields
- Comprehensive audit logging on all write operations, filterable by user / action / resource type / resource id / date range
- Single-call CMS dashboard endpoint for home-screen counts (`GET /dashboard/stats`)
- Editable site settings without redeploy — anonymous-readable subset for the public site (`GET /settings/public`)
- Trash & restore on every soft-deletable resource — accidental deletions can be reversed up until a hard purge
- Scheduled publishing for posts: editors set a future `published_at`, an EVERY_MINUTE cron flips them to live when the time arrives
- Per-translation SEO fields on posts (`meta_title`, `meta_description`, `og_image_id`) with documented render-time fallbacks
- Newsletter campaigns with batched sending, per-recipient delivery tracking, scheduled-send via cron, and crash-safe resume
- Admin-driven password reset (`POST /users/:id/reset-password`) — bumps `token_version` and revokes every outstanding refresh token
- Cross-resource search (`GET /search`) over posts, books, academic papers, and gallery captions — public-visibility-aware and language-fidelity-preserving (returns the translation that actually matched the query); backed by Postgres GIN trigram indexes and the `pg_trgm` similarity operator so queries are both relevance-ranked and sub-10 ms regardless of corpus size
- Public sitemap (`GET /sitemap.xml`) with `xhtml:link` hreflang alternates per translation, and an RSS 2.0 feed (`GET /rss/posts.xml`) for the latest published posts
- Bulk operations on posts (`POST /posts/bulk/publish`, `POST /posts/bulk/delete`) capped at 200 ids per call, fully audit-logged with a `bulk: true` marker
- Composite `GET /homepage` aggregator returning exactly the hadith / news / publications / videos / gallery payload the public site renders — single round trip, slim shape, per-day stable cache key
- CDN-friendly `Cache-Control` + `Vary: Accept-Language` headers on every public read endpoint, so Cloudflare (or any CDN) absorbs the bulk of public traffic; Express's weak `ETag` lets the CDN serve 304s for unchanged content
- CMS-managed daily hadiths (`/daily-hadiths`) with one-hadith-per-UTC-day rotation, optional editor pins overriding any given date, and a public `/daily-hadiths/today` endpoint feeding the homepage
- Local YouTube channel mirror (`/youtube/videos`, `/youtube/playlists`) refreshed every 6 hours by a background cron — the request path never touches the YouTube Data API, keeping quota use predictable and the site resilient to YouTube outages
- Health endpoint for uptime monitoring and load-balancer probes (storage status cached for 60s to avoid amplifying load on the object store)
- Interactive API explorer at `/docs` (toggleable via `EXPOSE_DOCS`; off by default in production)
- Globally enforced rate limiting via `@nestjs/throttler` with stricter caps on auth and view-counter endpoints, Helmet security headers, strict CORS allowlist in production, and response compression that picks **brotli** when the client accepts it (falls back to gzip otherwise) — ~15% smaller payloads to any modern browser
- **Multi-instance ready**: setting `REDIS_URL` switches throttler counters and JWT-cache invalidation onto Redis so a fleet of N dynos shares one rate-limit bucket per IP and propagates token revocations in milliseconds. Without `REDIS_URL`, both fall back to in-process state — fine for single-instance deployments
- **Pre-warmed in-process caches** for settings, languages, and contest questions at boot so the first request after a deploy doesn't pay the cold-cache cost; settings + dashboard responses are TTL-cached (60s / 30s) to absorb the bursty fan-out the CMS home screen causes
- **Background retention crons** prune `audit_logs` (one-year retention) and stale `refresh_tokens` (expired or revoked > 30 days) every night so both tables stay bounded

---

## Prerequisites

- Node.js ≥ 20
- npm ≥ 10
- A PostgreSQL database (Supabase recommended)
- Cloudflare R2 bucket (for file storage)
- Hostinger SMTP credentials (for email)

---

## Local Development

```bash
# 1. Install dependencies
npm install

# 2. Copy and fill in environment variables
cp .env.example .env
# Edit .env with your actual credentials

# 3. Generate the Prisma client
npx prisma generate

# 4. Start the dev server (hot reload)
npm run dev
```

The server starts at `http://localhost:3000`.  
API docs are at `http://localhost:3000/docs`.

---

## Environment Variables

See [.env.example](.env.example) for the complete list with inline descriptions.

| Variable | Required | Description |
| --- | --- | --- |
| `DATABASE_URL` | Yes | Supabase pooled connection string |
| `DIRECT_URL` | Yes | Supabase direct connection (no pgBouncer) |
| `JWT_SECRET` | Yes | Secret used to sign JWTs |
| `NODE_ENV` | Optional | `development` (default), `production`, or `test` |
| `PORT` | Optional | HTTP port. Defaults to `3000` |
| `JWT_EXPIRES_IN` | Optional | Access-token lifetime. Defaults to `24h` |
| `BCRYPT_ROUNDS` | Optional | bcrypt cost factor (4–15). Hashing helper clamps at runtime; 12 recommended |
| `LOG_LEVEL` | Optional | Pino level (`info`, `debug`, `warn`, …). Defaults to `info` in prod, `debug` otherwise |
| `R2_ACCOUNT_ID` | Prod | Cloudflare account ID. **Required in production** |
| `R2_ACCESS_KEY_ID` | Prod | R2 API access key. **Required in production** |
| `R2_SECRET_ACCESS_KEY` | Prod | R2 API secret key. **Required in production** |
| `R2_BUCKET` | Prod | R2 bucket name. **Required in production** |
| `R2_PUBLIC_BASE_URL` | Prod | Public CDN base URL for served files. **Required in production** |
| `R2_UPLOAD_URL_TTL_SECONDS` | Optional | Pre-signed upload URL lifetime (60–86400). Defaults to service default when unset |
| `ALLOWED_ORIGINS` | Prod | Comma-separated CORS allowed origins. **Required in production** — the app refuses to boot without it rather than fall back to a permissive default |
| `EXPOSE_DOCS` | Optional | `true` to expose `/docs` and `/openapi.json`. Defaults to off in production |
| `SENTRY_DSN` | Optional | Sentry DSN for error tracking |
| `SMTP_HOST` | Optional | SMTP hostname. If any of the SMTP_* group is missing, outbound email is silently disabled |
| `SMTP_PORT` | Optional | SMTP port (465 for Hostinger) |
| `SMTP_USER` | Optional | SMTP username / sender address |
| `SMTP_PASS` | Optional | SMTP password |
| `SMTP_SECURE` | Optional | `true` to force TLS (use with port 465). Otherwise STARTTLS is auto-negotiated |
| `EMAIL_FROM` | Optional | `From:` header for outbound mail. Falls back to `SMTP_USER` |
| `EMAIL_TO` | Optional | Recipient for admin notification emails (e.g. new form submissions) |
| `NEWSLETTER_UNSUBSCRIBE_SECRET` | Optional | HMAC secret for unsubscribe tokens; falls back to `JWT_SECRET` |
| `NEWSLETTER_UNSUBSCRIBE_URL_BASE` | Optional | Front-end unsubscribe page used to build `{{unsubscribe_url}}` substitution. Defaults to `https://imamzain.org/newsletter/unsubscribe` |
| `PUBLIC_SITE_URL` | Optional | Base URL emitted in `sitemap.xml` and `rss/posts.xml` entries. Defaults to `https://imamzain.org` |
| `PUBLIC_SITE_NAME` | Optional | Title used in the RSS feed `<channel>`. Defaults to `Imam Zain Foundation` |
| `YOUTUBE_API_KEY` | Optional | YouTube Data API v3 key. When set together with `YOUTUBE_CHANNEL_ID`, a 6-hour cron mirrors the channel's videos + playlists into the local DB. Sync is silently skipped if either is missing |
| `YOUTUBE_CHANNEL_ID` | Optional | The `UCxxxx…` channel ID the YouTube sync targets |
| `TWILIO_ACCOUNT_SID` | Optional | Twilio account SID. WhatsApp notifications silently no-op when missing |
| `TWILIO_AUTH_TOKEN` | Optional | Twilio auth token |
| `TWILIO_WHATSAPP_FROM` | Optional | Twilio WhatsApp sender number |
| `TWILIO_TEMPLATE_SID` | Optional | Approved Twilio template SID used for outbound WhatsApp messages |
| `REDIS_URL` | Optional | `redis://…` or `rediss://…`. Set in multi-instance deployments — enables a shared throttler counter across processes and pub/sub-driven JWT cache invalidation. Unset = in-process fallbacks; correct for single-instance prod and dev |

> **Boot behaviour:** the app validates required env vars on startup. Missing
> `JWT_SECRET`, `DATABASE_URL`, `DIRECT_URL`, or — in production —
> `ALLOWED_ORIGINS` and the `R2_*` group, will cause the process to exit.
> There is intentionally no insecure fallback for the JWT secret.

---

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start dev server with hot reload |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Start the compiled server |
| `npm test` | Run unit tests |
| `npm run test:watch` | Unit tests in watch mode |
| `npm run test:cov` | Run tests with coverage report |
| `npm run test:integration` | Integration tests against `DATABASE_TEST_URL` (see `.env.test.example`) |
| `npm run test:all` | Unit + integration tests |
| `npm run type-check` | TypeScript check without emitting |
| `npm run prisma:deploy` | Apply pending SQL migrations (`prisma migrate deploy`) |
| `npm run prisma:pull` | Introspect the live database into `schema.prisma` (drift check) |
| `npm run prisma:generate` | Regenerate the Prisma client |
| `npm run prisma:studio` | Open Prisma Studio GUI |
| `npm run prisma:seed` | Seed permissions, roles, languages, bootstrap super-admin, and starter site settings |
| `npm run prisma:seed-content` | Seed legacy JSON content (books, posts, gallery, papers, hadiths, pages, stores, audios) from the sibling `imamzain.org` checkout |
| `npm run prisma:diagnose` | Read-only report of what `prisma:seed-content` would create/skip |
| `npm run prisma:hydrate-media` | Backfill real file size/dimensions on seeded media rows; report objects missing from R2 |
| `npm run prisma:upload-missing-r2` | Copy legacy media files from the local `public/` mirror into R2 |
| `npm run prisma:reconcile-audios` | Create draft audio rows for R2 audio objects missing from the DB |
| `npm run prisma:backfill-variants` | One-off: generate sharp WebP variants for media uploaded before the variant pipeline shipped |

> Dependency note: `package.json` pins an `overrides.fast-xml-builder` version
> floor (CVE hygiene for the transitive `fast-xml-parser` chain pulled in by
> the AWS SDK). The natural range already resolves to the same version, so the
> override is a guard, not a behaviour change.

---

## Schema Migrations

Schema changes are hand-written SQL migrations under
`prisma/migrations/<timestamp>_<name>/migration.sql`, applied and tracked by
Prisma Migrate (`_prisma_migrations` table). `prisma/schema.prisma` is the
source of truth for the typed client and must be edited to mirror every
migration.

To make a schema change:

```bash
# 1. Write the SQL under prisma/migrations/<timestamp>_<name>/migration.sql
#    and mirror the change in prisma/schema.prisma.

# 2. Apply pending migrations
npm run prisma:deploy

# 3. Regenerate the typed client
#    Stop any long-running node process first (dev server, jest --watch),
#    or Windows file locks will block the engine swap with EPERM.
npm run prisma:generate
```

`npm run prisma:pull` (introspection) remains useful as a drift check against
a live database, but deploys go through `prisma migrate deploy` — never apply
migration SQL by hand with psql, or the `_prisma_migrations` ledger will
disagree with reality.

---

## Project Structure

```bash
src/
├── main.ts                       # Bootstrap — Helmet, CORS, Swagger, Pino, brotli/gzip compression
├── app.module.ts                 # Root module — throttler picks Redis or in-memory storage based on REDIS_URL
├── common/                       # Shared decorators, guards, filters, interceptors
│   ├── audit/                    # Fire-and-forget audit writer + retention cron (365-day window)
│   ├── middleware/               # compression.middleware.ts (brotli + gzip)
│   ├── redis/                    # Optional Redis client + pub/sub helper (provided unconditionally; clients are null without REDIS_URL)
│   └── utils/                    # TtlCache for settings/dashboard/languages, pagination helpers, html sanitiser
├── config/                       # Environment validation (class-validator); includes REDIS_URL
├── prisma/                       # Global PrismaService wrapper
├── auth/                         # JWT strategy + 30s in-process user cache with cross-instance invalidation via Redis pub/sub
├── users/                        # User CRUD & profile management
├── roles/                        # Role & permission management (RBAC)
├── audit-logs/                   # Admin read API over the audit trail
├── dashboard/                    # CMS dashboard aggregates (cached counts + recent activity)
├── languages/                    # Language records for i18n
├── media/                        # File metadata (backed by Cloudflare R2) + WebP variants
├── posts/                        # Blog posts + categories
├── post-categories/
├── books/                        # Digital library + categories
├── book-categories/
├── gallery/                      # Image gallery + categories
├── gallery-categories/
├── academic-papers/              # Academic papers + categories
├── academic-paper-categories/
├── static-pages/                 # Canonical rarely-changing pages (biography, about) + SEO
├── stores/                       # Physical sale / contact locations grouped by city
├── audios/                       # Single-language audio library (MP3 + PDF on R2) + pre-signed upload
├── speakers/                     # Lecturers referenced by the audio library
├── daily-hadiths/                # Daily hadith rotation + date pins
├── youtube/                      # Local mirror of the YouTube channel (6-hourly sync)
├── search/                       # Cross-resource pg_trgm search
├── feeds/                        # sitemap.xml, RSS, homepage aggregator
├── settings/                     # Site settings key-value store (cached)
├── newsletter/                   # Newsletter subscriptions + campaigns
├── forms/                        # Contact forms & proxy-visit tracking
├── contest/                      # Qutuf Sajjadiya contest (start/submit lifecycle)
├── email/                        # Nodemailer SMTP service
├── storage/                      # Cloudflare R2 signed-URL service
├── whatsapp/                     # Twilio WhatsApp notifications
└── health/                       # GET /health probe
```

---

## API Reference

All endpoints are prefixed with `/api/v1`.  
Full interactive docs (request builder + response examples): `GET /docs`.  
Raw OpenAPI 3.0 spec: `GET /openapi.json`.

### Integration documentation

For cross-cutting concepts the OpenAPI spec doesn't cover, the
`docs/` folder is the authoritative reference:

| Doc | What's in it |
| --- | --- |
| [docs/integration.md](docs/integration.md) | Auth flow, response/error envelopes, pagination, language resolution, soft-delete + restore, two-step media upload, Tiptap sanitisation allowlist, newsletter unsubscribe scheme, rate limits, public URL conventions, cron schedules. The cross-cutting handbook. |
| [docs/permissions.md](docs/permissions.md) | Full permission catalogue (68 permissions), default role mappings, the role × permission matrix, and the complete audit-action vocabulary for activity feeds. |
| [docs/CMS-INTEGRATION-NOTES.md](docs/CMS-INTEGRATION-NOTES.md) | Chronological release notes — what changed in each round of API updates. Read alongside the integration docs above for context on recent additions. |

### Authentication

| Method | Endpoint | Auth | Rate limit | Description |
| --- | --- | --- | --- | --- |
| POST | `/auth/login` | Public | 10 / 15 min per IP | Returns a signed JWT plus a rotating refresh token |
| POST | `/auth/refresh` | Public | 30 / 15 min per IP | Atomically rotates the refresh token; presenting an already-revoked token revokes the entire chain for that user |
| POST | `/auth/logout` | JWT | — | Revokes the supplied refresh token, or all sessions if none supplied |
| GET | `/auth/me` | JWT | — | Current profile with roles and permissions |
| PATCH | `/auth/me/password` | JWT | — | Change password and invalidate all sessions (transactional) |

### Content Management (JWT required)

| Resource | Base path | Notes |
| --- | --- | --- |
| Dashboard | `/dashboard/stats` | Single-call aggregator for the CMS home screen; counts posts / library / users / newsletter / forms / contest. Response is cached in-process for 30 s — don't poll faster than that |
| Site Settings | `/settings` | Key/value store for editable site config (`site_name`, social links, default language, contact email, etc.). `GET /settings/public` is anonymous; everything else is admin-only |
| Users | `/users` | Admin only. `POST /users/:id/reset-password` lets an admin force-reset a forgotten password |
| Roles | `/roles` | Admin only |
| Languages | `/languages` | |
| Media | `/media` | R2 pre-signed upload URLs. `POST /media/confirm` returns immediately with `variants: []`; sharp runs in the background (~1–3 s) and the variants populate via `GET /media/:id`. `POST /media/:id/regenerate-variants` re-runs sharp if a generation step failed |
| Posts | `/posts` | i18n via translation tables (`meta_title` / `meta_description` / `og_image_id` SEO fields + derived `reading_time_minutes` per translation). `?featured=true` filters to flagged posts; `?sort=views` returns the popular sort. Admin-only `GET /posts/admin/:id` returns drafts. Posts whose `published_at` is in the past are auto-published by an EVERY_MINUTE cron. **List payloads drop the `body` field** to keep responses small — call the detail endpoint when you need full text |
| Post Categories | `/post-categories` | |
| Books | `/books` | Optional per-translation `slug` → public `GET /books/by-slug/:slug`. Per-translation SEO fields (`meta_title` / `meta_description` / `og_image`). `media.variants[]` included for responsive `<img srcset>`. |
| Book Categories | `/book-categories` | |
| Gallery Images | `/gallery` | |
| Gallery Categories | `/gallery-categories` | |
| Academic Papers | `/academic-papers` | Optional per-translation `slug` → public `GET /academic-papers/by-slug/:slug`. Per-translation SEO fields (`meta_title` / `meta_description` / `og_image`). |
| Academic Paper Categories | `/academic-paper-categories` | |
| Static Pages | `/static-pages` | Canonical rarely-changing pages (biography, about). Per-language `slug` + SEO fields. Public `GET /static-pages`, `/static-pages/by-slug/:slug`, `/static-pages/:id` (published only); admin `GET /static-pages/admin` + `/static-pages/admin/:id` reach drafts. |
| Stores | `/stores` | "Where to buy / visit us" — a `store` is a city (translated `city_name`) with one or more nested sale-points (`/stores/:id/locations`) carrying phone + GPS. Public `GET /stores`, `/stores/:id`; admin CRUD under `stores:*`. |
| Audios | `/audios` | **Single-language** audio library (MP3 + optional PDF on R2). Flat records with `categories[]`, optional `slug`, `is_published`, view counter, and waveform `peaks` (detail only). Public `GET /audios`, `/audios/categories`, `/audios/by-slug/:slug`, `/audios/:id`, `POST /audios/:id/view`; admin CRUD + `/admin` (drafts) + publish toggle + trash/restore. `POST /audios/upload-url` pre-signs an R2 PUT for the mp3/pdf. In `GET /search`, dashboard stats, and the sitemap. |
| Newsletter Subscribers | `/newsletter/subscribers` | List, soft-delete, plus admin `POST /:id/unsubscribe` and `POST /:id/resubscribe` for flipping `is_active` without going through the public token-based flow |
| Newsletter Campaigns | `/newsletter/campaigns` | Compose, schedule, send, and track per-recipient delivery. Cron-driven batched sender resumes cleanly after process restarts. |
| Audit logs | `/audit-logs` | List filterable by `user_id`, `action`, `resource_type`, `resource_id`, date range; `GET /audit-logs/:id` returns a single entry with the originating user inlined |

Every soft-deletable resource — posts / books / academic-papers / gallery and
their categories, static-pages, stores, audios, **users**, **newsletter
subscribers**, and **form submissions** (contacts + proxy-visits) — also exposes:

```text
GET  /<resource>/trash          — paginated list of soft-deleted records
POST /<resource>/:id/restore    — undo a soft delete (404 if id not in trash;
                                  409 if a unique slug / ISBN / username was
                                  taken since)
```

Both routes are gated by the existing `<resource>:delete` permission (forms /
newsletter use `forms:delete` / `newsletter:delete`).

### Public Endpoints

| Method | Endpoint | Rate limit | Description |
| --- | --- | --- | --- |
| POST | `/forms/contact` | 300 / hr per IP | Contact form submission |
| POST | `/forms/proxy-visit` | 300 / hr per IP | Proxy visit tracking |
| GET | `/forms/qutuf-sajjadiya-contest/questions` | global only | Contest question list |
| POST | `/forms/qutuf-sajjadiya-contest/start` | global only | Start contest attempt, returns `attempt_id`. Abuse is gated by a DB-level unique index on `phone` and `email`. |
| POST | `/forms/qutuf-sajjadiya-contest/submit` | global only | Submit answers, returns score. Each `attempt_id` can only be submitted once. |
| POST | `/newsletter/subscribe` | 5 / 15 min per IP | Newsletter opt-in; returns an `unsubscribe_token` |
| POST | `/newsletter/unsubscribe` | 5 / 15 min per IP | Newsletter opt-out; requires the token issued at subscribe time |
| POST | `/posts/:id/view` | 30 / min per IP | Increment the view counter on a published post |
| POST | `/books/:id/view` | 30 / min per IP | Increment the view counter on a book |
| GET | `/health` | 60 / min per IP | Liveness probe (storage check is cached for 60s) |

---

## Deployment

### Docker

```bash
docker build -t imamzain-api .
docker run -p 3000:3000 --env-file .env imamzain-api
```

### Railway (recommended — free 500 hr/month)

1. Push this repository to GitHub.
2. In [Railway](https://railway.app): **New Project → Deploy from GitHub repo**.
3. Add every variable from `.env.example` under **Variables**.
4. Railway detects the `Dockerfile` automatically and builds on each push to `main`.
5. Assign a custom domain under **Settings → Networking**.

### VPS / Manual

```bash
npm ci
npx prisma generate
npm run build
NODE_ENV=production node dist/src/main.js
```

With PM2:

```bash
npm install -g pm2
pm2 start dist/src/main.js --name imamzain-api
pm2 save && pm2 startup
```
