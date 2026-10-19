# ImamZain API

REST API powering [imamzain.org](https://imamzain.org) — Islamic content management, digital library, gallery, and public forms. It runs as a [Hono](https://hono.dev) app on Cloudflare Workers (`worker/`); it replaced a NestJS app in October 2026.

## Table of Contents

- [Tech Stack](#tech-stack)
- [Features](#features)
- [Prerequisites](#prerequisites)
- [Local Development](#local-development)
- [Configuration](#configuration)
- [Scripts](#scripts)
- [Schema Migrations](#schema-migrations)
- [Project Structure](#project-structure)
- [API Reference](#api-reference)
- [Deployment](#deployment)

---

## Tech Stack

| Layer | Technology |
| --- | --- |
| Runtime | Cloudflare Workers (`worker/`), TypeScript 6 |
| Framework | Hono + `@hono/zod-openapi` (one Zod schema per request/response shape) |
| Database | PostgreSQL via Supabase, reached through Cloudflare Hyperdrive |
| ORM | Prisma 6 (SQL migrations via `prisma migrate deploy`; the Worker uses the `engineType = "client"` generator with `@prisma/adapter-pg`) |
| Auth | JWT (`hono/jwt`) + bcryptjs |
| Storage | Cloudflare R2 (binding, plus pre-signed upload URLs) |
| Images | Cloudflare Images binding (WebP variants) |
| Email | Cloudflare Email Service (`send_email` binding) |
| WhatsApp | Twilio REST API |
| Rate limiting | Cloudflare Rate Limiting bindings |
| Background jobs | Cloudflare Cron Triggers |
| Tests | Vitest: unit tests, plus a black-box contract suite against `wrangler dev` |

---

## Features

- Multi-language content — send `Accept-Language: ar` (or any ISO 639-1 code) to get translated responses, with automatic fallback to the default translation when one isn't available
- Role-based access control (RBAC) with per-permission granularity
- JWT authentication with bcrypt password hashing, atomic refresh-token rotation, and reuse detection that revokes the whole token chain when an already-rotated token is replayed
- File uploads via Cloudflare R2 pre-signed URLs, with server-side MIME enforcement and ownership-bound confirmation (the user that requested the URL is the only one who can register the resulting media row)
- Pre-generated WebP variants (320 / 768 / 1280 / 1920 px) on upload via the Cloudflare Images binding — generated **in the background** off the request path, so the confirm response returns in single-digit milliseconds and the public site can serve responsive images via `<img srcset>` once the variants land (~1–3s later)
- Server-side HTML sanitisation of rich-text body fields (Tiptap output) using a strict allowlist that mirrors the CMS editor's schema; defends against admin-session compromise and frontend rendering surfaces that use `dangerouslySetInnerHTML`
- HTML-escaped admin notification emails to defuse stored XSS via form fields
- Comprehensive audit logging on all write operations, filterable by user / action / resource type / resource id / date range
- Single-call CMS dashboard endpoint for home-screen counts (`GET /dashboard/stats`)
- Editable site settings without redeploy — anonymous-readable subset for the public site (`GET /settings/public`)
- Trash & restore on every soft-deletable resource — accidental deletions can be reversed up until a hard purge
- Scheduled publishing for posts: editors set a future `published_at`, a cron that runs every minute flips them to live when the time arrives
- Per-translation SEO fields on posts (`meta_title`, `meta_description`, `og_image_id`) with documented render-time fallbacks
- Newsletter **double opt-in**: signing up only sends a confirmation e-mail; the subscription starts when its link is clicked. The public subscribe reply is identical for every address, so the list cannot be probed
- Admin form notifications (contact + proxy-visit) are **batched into digest e-mails** drained by a cron — a flood of submissions can no longer burn the mail quota, and a failed send is retried instead of lost
- Admin-driven password reset (`POST /users/:id/reset-password`) — bumps `token_version` and revokes every outstanding refresh token
- Cross-resource search (`GET /search`) over posts, books, academic papers, and gallery captions — public-visibility-aware and language-fidelity-preserving (returns the translation that actually matched the query); backed by Postgres GIN trigram indexes and the `pg_trgm` similarity operator so queries are both relevance-ranked and sub-10 ms regardless of corpus size
- Public sitemap (`GET /sitemap.xml`) covering posts, static pages and slugged books, and an RSS 2.0 feed (`GET /rss/posts.xml`) for the latest published posts
- Bulk operations on posts (`POST /posts/bulk/publish`, `POST /posts/bulk/delete`) capped at 200 ids per call, fully audit-logged with a `bulk: true` marker
- Composite `GET /homepage` aggregator returning exactly the hadith / news / publications / videos / gallery payload the public site renders — single round trip, slim shape, per-day stable cache key
- CDN-friendly `Cache-Control` + `Vary: Accept-Language` headers on every public read endpoint, so Cloudflare (or any CDN) absorbs the bulk of public traffic; every response (success and error alike) carries a weak `ETag` hashed over the body without the envelope `timestamp`, so a matching `If-None-Match` gets a bodyless `304` and the CDN/browser reuses its stored copy
- CMS-managed daily hadiths (`/daily-hadiths`): each hadith optionally carries an editor-set `display_date` for one tied to a specific occasion; `/daily-hadiths/today` (feeds the homepage) serves the hadith scheduled to today or, if none is, a hadith drawn at random from the unscheduled pool and locked in for the rest of the site-timezone day (`SITE_TIMEZONE`, default Asia/Baghdad) so every visitor sees the same one; `GET /daily-hadiths` is a pure lookup by exact date, by range, or a plain paginated browse
- Local YouTube channel mirror (`/youtube/videos`, `/youtube/playlists`) refreshed every 6 hours by a background cron — the request path never touches the YouTube Data API, keeping quota use predictable and the site resilient to YouTube outages
- Health endpoint for uptime monitoring (database and storage probes)
- Globally enforced rate limiting (Cloudflare Rate Limiting bindings, per-minute windows) with stricter caps on auth and view-counter endpoints, security headers, a strict CORS allowlist, and response compression done by the Cloudflare edge
- **A nightly retention job** prunes `audit_logs` (one-year retention), stale `refresh_tokens` (expired or revoked > 30 days) and idle `login_attempts` so those tables stay bounded

---

## Prerequisites

- Node.js 22 or newer
- PostgreSQL 16 (a local one for development; Supabase in production)
- A Cloudflare account with Wrangler (`npx wrangler login`) to deploy; not needed to run locally

---

## Local Development

```bash
# 1. Install dependencies (repo root: Prisma and the seed scripts; worker/: the API)
npm install
cd worker && npm install && cd ..

# 2. Point the root scripts at a local database
cp .env.example .env
# Edit .env: DATABASE_URL and DIRECT_URL (a local Postgres is fine)

# 3. Create the schema and the bootstrap data (languages, roles, permissions, super-admin)
npm run prisma:generate
npm run prisma:deploy
SEED_ADMIN_PASSWORD=choose-one npm run prisma:seed

# 4. Secrets for the Worker (never commit this file)
#    worker/.dev.vars:  JWT_SECRET=<32+ random characters>
#    optional: BCRYPT_ROUNDS, YOUTUBE_API_KEY, TWILIO_*, R2_* ... (full list: bottom of worker/wrangler.jsonc)

# 5. Run the Worker locally
cd worker
npm run dev    # wrangler dev; Hyperdrive uses localConnectionString from wrangler.jsonc
```

`wrangler dev` connects to `postgresql://postgres:postgres@localhost:5432/imamzain_test` by default
(`localConnectionString` in `worker/wrangler.jsonc`); change it there, or point your local database at that name.
The API is then on `http://localhost:8787/api/v1`. R2, Images and the e-mail binding are simulated locally;
mail is not actually sent.

---

## Configuration

The root `.env` only configures Prisma and the seed scripts (`DATABASE_URL`, `DIRECT_URL`, `SEED_*`,
`BCRYPT_ROUNDS`). The Worker's configuration is:

- **Variables and bindings:** `worker/wrangler.jsonc` (CORS origins, public URLs, R2, Hyperdrive, rate limits, crons).
- **Secrets:** `npx wrangler secret put <NAME>` in production, `worker/.dev.vars` locally. The comment at the bottom of
  `wrangler.jsonc` lists every name (`JWT_SECRET`, the Twilio and R2 credentials, `YOUTUBE_API_KEY`, the newsletter and
  contest secrets, ...) and the default used when it is unset. Never put secrets in `wrangler.jsonc`.

---

## Scripts

Repo root (Prisma and data scripts only):

| Script | What it does |
| --- | --- |
| `npm run prisma:deploy` | Apply pending migrations (`prisma migrate deploy`) |
| `npm run prisma:generate` | Generate the Prisma client the root scripts use |
| `npm run prisma:seed` | Languages, permissions, roles, site settings and the bootstrap super-admin (`SEED_ADMIN_PASSWORD`) |
| `npm run prisma:seed-content`, `prisma:link-book-parts`, `prisma:purge-content`, `prisma:hydrate-media`, `prisma:diagnose` | One-off content import and maintenance scripts |
| `npm run type-check` | Type-check the seed scripts |

`worker/`:

| Script | What it does |
| --- | --- |
| `npm run dev` | `wrangler dev` (generates the Prisma client and Worker types first) |
| `npm run typecheck` | Generate, then `tsc` |
| `npm test` | Vitest unit tests |
| `npm run contract [-- <group>]` | Black-box suite against `wrangler dev`; needs a migrated and seeded Postgres (see `worker/test/README.md`) |
| `npm run deploy` | `wrangler deploy` |

## Schema Migrations

Schema changes go through SQL migrations in `prisma/migrations/` and are mirrored in `prisma/schema.prisma`.
Keep additive and destructive changes in separate migrations, and check a new uniqueness constraint against
production data first.

```bash
# 1. Write the SQL under prisma/migrations/<timestamp>_<name>/migration.sql
#    and mirror the change in prisma/schema.prisma.

# 2. Apply pending migrations
npm run prisma:deploy

# 3. Regenerate both clients
npm run prisma:generate
cd worker && npm run gen
```

CI applies the migrations to an empty database and fails if `schema.prisma` drifts from them
(see `prisma/INTENTIONAL_DRIFT.md` for the known exceptions).

---

## Project Structure

```text
worker/
  wrangler.jsonc        bindings, routes, cron triggers, variables
  CONVENTIONS.md        how route groups are built
  src/
    index.ts            fetch and scheduled handlers
    app.ts              route table: path prefix → group router; unknown paths are 404
    features/<group>/   routes.ts · service.ts · schemas.ts
    lib/                db, auth, envelope, errors, i18n, pagination, rate limit, audit, r2, images, mail
    jobs/               cron jobs (scheduled publish, form digests, uploads cleanup, YouTube sync, retention)
    generated/          Prisma client for the Worker (gitignored)
  test/                 unit tests, contract suite (test/contract), harness
prisma/
  schema.prisma         shared schema, two generators
  migrations/           SQL migrations
  seed*.ts, ...         seed and one-off data scripts
docs/                   integration handbook, permissions, release notes, migration plan
```

---

## API Reference

All endpoints are prefixed with `/api/v1`.  
There is no interactive docs page: each group's routes are in `worker/src/features/<group>/routes.ts` and
its request/response shapes in `schemas.ts`.

### Integration documentation

For cross-cutting concepts, the `docs/` folder is the authoritative reference:

| Doc | What's in it |
| --- | --- |
| [docs/integration.md](docs/integration.md) | Auth flow, response/error envelopes, pagination, language resolution, soft-delete + restore, two-step media upload, Tiptap sanitisation allowlist, newsletter unsubscribe scheme, rate limits, public URL conventions, cron schedules. The cross-cutting handbook. |
| [docs/permissions.md](docs/permissions.md) | Full permission catalogue (68 permissions), default role mappings, the role × permission matrix, and the complete audit-action vocabulary for activity feeds. |
| [docs/CMS-INTEGRATION-NOTES.md](docs/CMS-INTEGRATION-NOTES.md) | Chronological release notes — what changed in each round of API updates. Read alongside the integration docs above for context on recent additions. |

### Authentication

| Method | Endpoint | Auth | Rate limit | Description |
| --- | --- | --- | --- | --- |
| POST | `/auth/login` | Public | 10 / min per IP | Returns a signed JWT plus a rotating refresh token |
| POST | `/auth/refresh` | Public | 30 / min per IP | Atomically rotates the refresh token; presenting an already-revoked token revokes the entire chain for that user |
| POST | `/auth/logout` | JWT | — | Revokes the supplied refresh token, or all sessions if none supplied |
| GET | `/auth/me` | JWT | — | Current profile with roles and permissions |
| PATCH | `/auth/me/password` | JWT | — | Change password and invalidate all sessions (transactional) |

### Content Management (JWT required)

| Resource | Base path | Notes |
| --- | --- | --- |
| Dashboard | `/dashboard/stats` | Single-call aggregator for the CMS home screen; counts posts / library / users / newsletter / forms / contest. Not cached; don't poll faster than that |
| Site Settings | `/settings` | Key/value store for editable site config (`site_name`, social links, default language, contact email, etc.). `GET /settings/public` is anonymous; everything else is admin-only |
| Users | `/users` | Admin only. `POST /users/:id/reset-password` lets an admin force-reset a forgotten password |
| Roles | `/roles` | Admin only |
| Languages | `/languages` | |
| Media | `/media` | R2 pre-signed upload URLs. `POST /media/confirm` returns immediately with `variants: []`; the variants are generated in the background (~1–3 s). Every media object also carries `planned_widths` (the widths this original should get) and `variants_status` (`ready` / `processing` / `partial` / `unavailable` / `not_applicable`) — poll until `variants_status !== "processing"`, never compare `variants.length` to a fixed count. `POST /media/:id/regenerate-variants` re-runs sharp and reports why generation can't proceed via `variants_status_reason`. `DELETE /media/:id` returns `409 MEDIA_IN_USE` (with `GET /media/:id/references` to see what holds it) or `502 STORAGE_DELETE_FAILED` if the R2 delete itself fails |
| Posts | `/posts` | i18n via translation tables (`meta_title` / `meta_description` / `og_image_id` SEO fields + derived `reading_time_minutes` per translation). `?featured=true` filters to flagged posts; `?sort=views` returns the popular sort. Admin-only `GET /posts/admin/:id` returns drafts. Posts whose `published_at` is in the past are auto-published by an EVERY_MINUTE cron. **List payloads drop the `body` field** to keep responses small — call the detail endpoint when you need full text |
| Post Categories | `/post-categories` | |
| Books | `/books` | Optional per-translation `slug` → public `GET /books/by-slug/:slug`. Per-translation SEO fields (`meta_title` / `meta_description` / `og_image`). `media.variants[]` included for responsive `<img srcset>`. Optional `pdf_url` — the downloadable book PDF, settable via create/update and returned on list + detail. |
| Book Categories | `/book-categories` | |
| Gallery Images | `/gallery` | |
| Gallery Categories | `/gallery-categories` | |
| Academic Papers | `/academic-papers` | No slug or SEO fields — the public site has no dedicated detail page for papers (they open in a modal), so there's no canonical URL for them to serve. |
| Academic Paper Categories | `/academic-paper-categories` | |
| Static Pages | `/static-pages` | Canonical rarely-changing pages (biography, about). Per-language `slug` + SEO fields. Public `GET /static-pages`, `/static-pages/by-slug/:slug`, `/static-pages/:id` (published only); admin `GET /static-pages/admin` + `/static-pages/admin/:id` reach drafts. |
| Stores | `/stores` | "Where to buy / visit us" — a `store` is a city (translated `city_name`) with one or more nested sale-points (`/stores/:id/locations`) carrying phone + GPS. Public `GET /stores`, `/stores/:id`; admin CRUD under `stores:*`. |
| Audios | `/audios` | **Single-language** audio library (MP3 + optional PDF on R2). Flat records with `categories[]`, optional `slug`, `is_published`, view counter, and waveform `peaks` (detail only). Public `GET /audios`, `/audios/categories`, `/audios/by-slug/:slug`, `/audios/:id`, `POST /audios/:id/view`; admin CRUD + `/admin` (drafts) + publish toggle + trash/restore. `POST /audios/upload-url` pre-signs an R2 PUT for the mp3/pdf. In `GET /search` and dashboard stats. Not in the sitemap: the public site has no `/audios/{slug}` route. |
| Newsletter Subscribers | `/newsletter/subscribers` | List, soft-delete, plus admin `POST /:id/unsubscribe` and `POST /:id/resubscribe` for flipping `is_active` without a confirmation e-mail (the admin vouches for the consent). Rows carry `confirmed_at` — when the current consent was given; inactive with `confirmed_at: null` and no `unsubscribed_at` is a sign-up still waiting for its confirmation click. Restoring from the trash keeps an explicit opt-out |
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
| POST | `/forms/contact` | 200 / min per IP (API-wide) | Contact form submission |
| POST | `/forms/proxy-visit` | 200 / min per IP (API-wide) | Proxy visit tracking |
| POST | `/auth/login` | 10 / min per IP, plus a per-username lockout | Sign in. 5 failed attempts within 15 min lock that username out with a growing back-off (60 s doubling to 15 min): `429 AUTH_LOGIN_LOCKED` + `Retry-After`. A success clears it |
| GET | `/forms/qutuf-sajjadiya-contest/questions` | global only | Contest question list. Stays readable while the contest is closed |
| POST | `/forms/qutuf-sajjadiya-contest/start` | 60 / min per IP | Start a contest attempt, returns `attempt_id` + `attempt_token`. **Closed by default** — 403 `CONTEST_CLOSED` unless the `contest_open` site setting is `"true"` (the Qutuf Sajjadiya contest concluded 2026-09-03; the setting is seeded `false`). When open: **idempotent** for an unsubmitted attempt (a lost response can be retried — same attempt comes back, `resumed: true`); only a submitted one answers 409. Abuse is gated by a DB-level unique index on `phone` and `email` (`00964…` and `+964…` are one identity). |
| POST | `/forms/qutuf-sajjadiya-contest/submit` | 60 / min per IP | Submit answers, returns the score (or `null` with `CONTEST_REVEAL_SCORE=false`). Same `contest_open` gate as `/start`, even for an attempt opened before it closed. Each `attempt_id` can only be submitted once. |
| POST | `/newsletter/subscribe` | 5 / min per IP | Newsletter **double opt-in** request: sends a confirmation e-mail. The reply is identical for every address and never contains a row or token |
| POST | `/newsletter/confirm` | 10 / min per IP | Confirms a subscription from the e-mail link (`email` + `token`); every bad link is the same 401 |
| POST | `/newsletter/unsubscribe` | 5 / min per IP | Newsletter opt-out; requires the token from the unsubscribe link in the confirmation e-mail |
| GET | `/homepage` | 120 / min per IP | Composite homepage payload (CDN-cacheable) |
| GET | `/sitemap.xml`, `/rss/posts.xml` | 20 / min per IP | XML sitemap and RSS feed (CDN-cacheable) |
| POST | `/posts/:id/view` | 30 / min per IP | Increment the view counter on a published post — also de-duplicated to one counted view per client IP per post per minute (other resources not yet de-duplicated) |
| POST | `/books/:id/view` | 30 / min per IP | Increment the view counter on a book |
| GET | `/health` | 60 / min per IP | Liveness probe (storage check is cached for 60s) |

---

## Deployment

The Worker is deployed with Wrangler from `worker/`. It is bound to the route `api.imamzain.org/*` in the
`imamzain.org` zone.

```bash
cd worker
npm ci
npx wrangler secret put JWT_SECRET      # once per secret, see Configuration
npx wrangler deploy
npx wrangler tail --status error        # watch the live errors for a few minutes
npx wrangler rollback                   # if something is wrong: back to the previous version
```

Run `npm run prisma:deploy` (repo root, with `DIRECT_URL` pointing at the production database) **before**
deploying code that needs a new migration. CI (`.github/workflows/ci.yml`) checks the migrations, runs the
Worker's type-check and unit tests, and runs the contract suite on every pull request.

Server-side callers in the same Cloudflare zone (the website Worker, a CMS Worker) must reach the API through a
Service Binding, not `fetch()` to the public URL (a same-zone `fetch()` skips the Worker's route):

```jsonc
"services": [{ "binding": "API", "service": "imamzain-api" }]
```
