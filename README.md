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
| ORM | Prisma 6 (introspection-only, raw SQL) |
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
- Pre-generated WebP variants (320 / 768 / 1280 / 1920 px) on upload via [`sharp`](https://sharp.pixelplumbing.com/), so the public site can serve responsive images via `<img srcset>` without paying for any per-request transform
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
- Cross-resource search (`GET /search`) over posts, books, academic papers, and gallery captions — public-visibility-aware and language-fidelity-preserving (returns the translation that actually matched the query); backed by Postgres GIN trigram indexes so substring `ILIKE` queries stay sub-10 ms as the corpus grows
- Public sitemap (`GET /sitemap.xml`) with `xhtml:link` hreflang alternates per translation, and an RSS 2.0 feed (`GET /rss/posts.xml`) for the latest published posts
- Bulk operations on posts (`POST /posts/bulk/publish`, `POST /posts/bulk/delete`) capped at 200 ids per call, fully audit-logged with a `bulk: true` marker
- Composite `GET /homepage` aggregator that returns featured + popular + recent post cards in one round trip, replacing the public-site fan-out of three separate `/posts` calls
- CDN-friendly `Cache-Control` + `Vary: Accept-Language` headers on every public read endpoint, so Cloudflare (or any CDN) absorbs the bulk of public traffic; Express's weak `ETag` lets the CDN serve 304s for unchanged content
- Health endpoint for uptime monitoring and load-balancer probes (storage status cached for 60s to avoid amplifying load on the object store)
- Interactive API explorer at `/docs` (toggleable via `EXPOSE_DOCS`; off by default in production)
- Globally enforced rate limiting via `@nestjs/throttler` with stricter caps on auth and view-counter endpoints, Helmet security headers, strict CORS allowlist in production, and response compression

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
| `JWT_EXPIRES_IN` | Yes | Token lifetime, e.g. `24h` |
| `BCRYPT_ROUNDS` | Yes | bcrypt cost factor (12 recommended) |
| `SMTP_HOST` | Yes | SMTP hostname |
| `SMTP_PORT` | Yes | SMTP port (465 for Hostinger) |
| `SMTP_USER` | Yes | SMTP username / sender address |
| `SMTP_PASS` | Yes | SMTP password |
| `R2_ACCOUNT_ID` | Yes | Cloudflare account ID |
| `R2_ACCESS_KEY_ID` | Yes | R2 API access key |
| `R2_SECRET_ACCESS_KEY` | Yes | R2 API secret key |
| `R2_BUCKET` | Yes | R2 bucket name |
| `R2_PUBLIC_BASE_URL` | Yes | Public CDN base URL for served files |
| `ALLOWED_ORIGINS` | Prod | Comma-separated CORS allowed origins. **Required in production** — the app refuses to boot without it rather than fall back to a permissive default |
| `EXPOSE_DOCS` | Optional | `true` to expose `/docs` and `/openapi.json`. Defaults to off in production |
| `NEWSLETTER_UNSUBSCRIBE_SECRET` | Optional | HMAC secret for unsubscribe tokens; falls back to `JWT_SECRET` |
| `NEWSLETTER_UNSUBSCRIBE_URL_BASE` | Optional | Front-end unsubscribe page used to build `{{unsubscribe_url}}` substitution. Defaults to `https://imamzain.org/newsletter/unsubscribe` |
| `PUBLIC_SITE_URL` | Optional | Base URL emitted in `sitemap.xml` and `rss/posts.xml` entries. Defaults to `https://imamzain.org` |
| `PUBLIC_SITE_NAME` | Optional | Title used in the RSS feed `<channel>`. Defaults to `Imam Zain Foundation` |
| `SENTRY_DSN` | Optional | Sentry DSN for error tracking |
| `TWILIO_ACCOUNT_SID` | Optional | Twilio account SID |
| `TWILIO_AUTH_TOKEN` | Optional | Twilio auth token |
| `TWILIO_WHATSAPP_FROM` | Optional | Twilio WhatsApp sender number |

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
| `npm run test:cov` | Run tests with coverage report |
| `npm run type-check` | TypeScript check without emitting |
| `npm run prisma:pull` | Sync Prisma schema from the live database |
| `npm run prisma:generate` | Regenerate the Prisma client |
| `npm run prisma:studio` | Open Prisma Studio GUI |
| `npm run prisma:seed` | Seed permissions, roles, languages, bootstrap super-admin, and starter site settings |
| `npm run prisma:backfill-variants` | One-off: generate sharp WebP variants for media uploaded before the variant pipeline shipped |

---

## Schema Migrations

Prisma is run in introspection-only mode (`prisma db pull`). Schema changes
are managed as raw SQL files under `prisma/migrations/<timestamp>_<name>/migration.sql`.

To apply a new migration:

```bash
# 1. Apply the SQL to the database
psql "$DIRECT_URL" -f prisma/migrations/<folder>/migration.sql

# 2. Re-introspect so schema.prisma reflects the live database
npm run prisma:pull

# 3. Regenerate the typed client
#    Stop any long-running node process first (dev server, jest --watch),
#    or Windows file locks will block the engine swap with EPERM.
npm run prisma:generate
```

Migrations are idempotent (`CREATE TABLE IF NOT EXISTS`, `DO`-block guarded
`CREATE TYPE`), so re-running is a no-op.

---

## Project Structure

```bash
src/
├── main.ts                       # Bootstrap — Helmet, CORS, Swagger, Pino
├── app.module.ts                 # Root module
├── common/                       # Shared decorators, guards, filters, interceptors
├── config/                       # Environment validation (class-validator)
├── prisma/                       # Global PrismaService wrapper
├── auth/                         # JWT strategy, login, guards
├── users/                        # User CRUD & profile management
├── roles/                        # Role & permission management (RBAC)
├── languages/                    # Language records for i18n
├── media/                        # File metadata (backed by Cloudflare R2)
├── posts/                        # Blog posts + categories
├── post-categories/
├── books/                        # Digital library + categories
├── book-categories/
├── gallery/                      # Image gallery + categories
├── gallery-categories/
├── academic-papers/              # Academic papers + categories
├── academic-paper-categories/
├── newsletter/                   # Newsletter subscriptions
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
| [docs/permissions.md](docs/permissions.md) | Full permission catalogue (53 permissions), default role mappings, the role × permission matrix, and the complete audit-action vocabulary for activity feeds. |
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
| Dashboard | `/dashboard/stats` | Single-call aggregator for the CMS home screen; counts posts / library / users / newsletter / forms / contest |
| Site Settings | `/settings` | Key/value store for editable site config (`site_name`, social links, default language, contact email, etc.). `GET /settings/public` is anonymous; everything else is admin-only |
| Users | `/users` | Admin only. `POST /users/:id/reset-password` lets an admin force-reset a forgotten password |
| Roles | `/roles` | Admin only |
| Languages | `/languages` | |
| Media | `/media` | R2 pre-signed upload URLs; responses include a `variants[]` array with WebP sizes generated at upload time. `POST /media/:id/regenerate-variants` re-runs sharp if a generation step failed |
| Posts | `/posts` | i18n via translation tables (now with `meta_title` / `meta_description` / `og_image_id` SEO fields + derived `reading_time_minutes` per translation). `?featured=true` filters to flagged posts; `?sort=views` returns the popular sort. Admin-only `GET /posts/admin/:id` returns drafts. Posts whose `published_at` is in the past are auto-published by an EVERY_MINUTE cron |
| Post Categories | `/post-categories` | |
| Books | `/books` | |
| Book Categories | `/book-categories` | |
| Gallery Images | `/gallery` | |
| Gallery Categories | `/gallery-categories` | |
| Academic Papers | `/academic-papers` | |
| Academic Paper Categories | `/academic-paper-categories` | |
| Newsletter Subscribers | `/newsletter/subscribers` | List, soft-delete, plus admin `POST /:id/unsubscribe` and `POST /:id/resubscribe` for flipping `is_active` without going through the public token-based flow |
| Newsletter Campaigns | `/newsletter/campaigns` | Compose, schedule, send, and track per-recipient delivery. Cron-driven batched sender resumes cleanly after process restarts. |
| Audit logs | `/audit-logs` | List filterable by `user_id`, `action`, `resource_type`, `resource_id`, date range; `GET /audit-logs/:id` returns a single entry with the originating user inlined |

Every soft-deletable resource (posts / books / academic-papers / gallery and their categories) also exposes:

```text
GET  /<resource>/trash          — paginated list of soft-deleted records
POST /<resource>/:id/restore    — undo a soft delete (404 if id not in trash;
                                  409 if a unique slug/ISBN was taken since)
```

Both routes are gated by the existing `<resource>:delete` permission.

### Public Endpoints

| Method | Endpoint | Rate limit | Description |
| --- | --- | --- | --- |
| POST | `/forms/contact` | 300 / hr per IP | Contact form submission |
| POST | `/forms/proxy-visit` | 300 / hr per IP | Proxy visit tracking |
| GET | `/forms/qutuf-sajjadiya-contest/questions` | global only | Contest question list |
| POST | `/forms/qutuf-sajjadiya-contest/start` | 10 / hr per IP | Start contest attempt, returns `attempt_id` |
| POST | `/forms/qutuf-sajjadiya-contest/submit` | 30 / hr per IP | Submit answers, returns score |
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
