# Hono on Cloudflare Workers — migration plan

Draft, 2026-09-30. Nest stays in production until Phase 6; any phase can be the last one.

**Precondition:** merge `fix/tier-0-audit-2026-09` first. Nest is the reference implementation, so it has to be the final Nest.

## 1. Goal and ground rules

**Goal:** move `api.imamzain.org` from NestJS (Node container) to Hono on Cloudflare Workers, and cut the source from ~27.5k lines to ~10–12k, without changing anything the CMS or website sees.

1. **Same contract.** URLs, envelopes, status codes and error `code`s stay identical. Parity is what lets scripts, not people, verify the port. Contract changes wait until after cutover.
2. **Strangler, not big bang.** A Worker sits in front of the current API. Ported route groups are served by Hono and everything else falls through to Nest. Any group can be rolled back in seconds.
3. **Trim infrastructure, port rules faithfully.**
   - **Delete** the multi-server machinery: Redis, advisory locks, in-process caches, compression.
   - **Do not "simplify"** auth, permissions, contest scoring, publish and visibility rules, slugs, translation fallback, Baghdad-day logic, hadith scheduling or HTML sanitization.
4. **No new features during the migration.** Schema changes must be additive only, through the existing Prisma migrations.
5. **Scripts verify, the model ports.** A group ships only when its contract tests and the diff harness are green.
6. **Known Nest bugs,** including the ~29 open medium/low findings from the September audit, are fixed in the Worker during their group's port:
   - Record each one as an intentional diff.
   - Add a test tagged `worker-only`.
   - Never port a bug on purpose.

## 2. Target architecture

```
client ──► Worker (Hono) on api.imamzain.org/*
             ├─ ported group ──► handler ──► Prisma (client engine) ──► Hyperdrive ──► Supabase
             │                          ├──► R2 binding · Images binding
             │                          └──► email · Twilio (fetch)
             └─ not ported yet ──► fetch(origin) ──► current Nest deployment
Cron Triggers (Phase 5) ──► worker/src/jobs/*
```

| Concern | Today (Nest) | Worker |
|---|---|---|
| HTTP | Express + Nest decorators | Hono |
| Validation + docs | class-validator + @nestjs/swagger (~7k lines of DTOs) | Zod via `@hono/zod-openapi`; Scalar at `/docs` (the CMS handbook links it) |
| Database | Prisma 6 with the Rust engine and a long-lived client | Prisma ≥ 6.16 with `engineType = "client"` + `@prisma/adapter-pg`, one client per request, through Hyperdrive with **caching off** |
| Auth | Passport JWT + 30 s user cache + Redis pub/sub | `hono/jwt` (HS256, same secret, so tokens work on both sides) + one user lookup per request |
| Rate limits | Redis or in-memory throttler; 15-min and 1-h windows | Rate Limiting binding (60 s windows) + the existing DB-backed login and confirm limits |
| Storage | AWS SDK against R2 | R2 binding; `aws4fetch` for presigned PUT URLs |
| Image variants | sharp | Images binding (`env.IMAGES`) inside `waitUntil`; the regenerate endpoint stays as the retry path |
| Email | nodemailer → Hostinger SMTP | Cloudflare Email Service (D1) |
| WhatsApp | Twilio SDK | `fetch` to the Twilio REST API |
| Background work | `setImmediate`, `p-limit` | `c.executionCtx.waitUntil` |
| Crons | `@nestjs/schedule`: 8 jobs, 4 of them behind advisory locks | 3 Cron Triggers with no locks (they fire once); existing row leases kept |
| Caching / compression / ETag | in-process caches, compression middleware, `envelopeEtag` | edge compression; ETag kept because the CMS notes rely on conditional GETs; no in-process caches |
| Logs / errors | pino + Sentry | Workers Logs; `@sentry/cloudflare` only if D13 = keep |

**Repo layout:** `worker/` sits next to `src/` in this repo. It shares `prisma/schema.prisma` through a second generator. `src/` is deleted in Phase 6.

```
worker/
  wrangler.jsonc
  CONVENTIONS.md            ← written in Phase 3; every later session follows it
  src/
    index.ts                ← fetch + scheduled handlers
    app.ts                  ← middleware, ported-group table, fallthrough to origin
    lib/                    ← db, auth, envelope, errors, i18n, pagination, rate-limit, audit, r2, images, email
    features/<group>/       ← routes.ts · service.ts · schemas.ts
    jobs/                   ← cron jobs
  test/
    contract/<group>.test.ts  ← black-box HTTP tests, run against Nest AND the Worker
    diff/                     ← replay harness + reports
```

## 3. What gets trimmed

| Removed | ~Lines today | Replaced by |
|---|---|---|
| DTO/Swagger duplication and controller decorators | ~7,000 + most of ~4,000 | one Zod schema per shape |
| Redis module, Redis throttler storage, JWT-cache pub/sub | ~300 | the rate-limit binding, or nothing |
| Advisory-lock util and its 4 call sites | ~150 | nothing: Cron Triggers fire once |
| In-process caches (`ttl-cache`, `public-cache`, site-midnight cache, JWT user cache) | ~250 | nothing at first (see D8) |
| Compression middleware | 135 | Cloudflare edge |
| View-dedup service | ~150 | the rate-limit binding keyed on `ip:resource`, 1 per minute (D7) |
| SMTP-specific campaign machinery | part of 2,300 | D1 / D2 |
| Mock-heavy Nest unit tests | most of ~20k test lines | contract tests + diff harness |
| One-off legacy scripts in `prisma/` | ~3,100 | archived, but only after the legacy content migration is signed off |

These features could be **dropped entirely**, but only on the strength of Phase 0 usage data:
- newsletter campaigns
- YouTube sync
- stores
- view counting
- dashboard stats

## 4. Phase 0 facts and decisions

### Facts recorded 2026-10-01

| Item | Value |
|---|---|
| Origin host | Render, single instance, service URL `api-imamzain-org-0fiv.onrender.com` |
| Proxying | `api.imamzain.org` is a proxied CNAME to the Render URL. Cache Rule: bypass for every `api.imamzain.org/*` URL |
| Health check | `GET /api/v1/health`; an external cron-job.org ping hits it (≈ 4.7k of the 24.6k requests) |
| `TRUST_PROXY_HOPS` | unset (= 1) while traffic is client → Cloudflare → Render. Throttle buckets and `audit_logs.ip_address` are therefore Cloudflare edge IPs today; CMS notes say `=2` is still open |
| Redis | `REDIS_URL` never set in prod; in-process fallbacks are what runs |
| `DISABLE_CRON` | unset. Crons fire: YouTube sync last ran 2026-10-01 00:00:57 |
| API traffic, 30 days | 24.6k requests (≈ 0.01 req/s), 5% cache hit, 98 MB. Origin 5xx 151 (≈ 0.6%, mostly 503 = 109), 4xx 15k (mostly 404 from bot scans of `/signin`, `/register`, `/login`) |
| Top API routes | `/api/v1/health` 4.75k, `/api/v1/books` 814, `/api/v1/book-categories` 764, `/api/v1/daily-hadiths/today` 477 |
| Whole zone `imamzain.org` | 975k requests, 327k to origin (website included, not API) |
| p95 latency baseline | **API: not captured yet.** Website only (Cloudflare Web Analytics, 30 d, bots excluded): LCP p50 531 ms / p75 1,204 ms / p90 2,296 ms / p99 11,852 ms; INP 95% good; CLS 94% good. Take the API baseline with a TTFB script in Phase 1 |
| Source / test lines | `src/` 27,537 (non-spec) · specs 19,930 · `prisma/` scripts 3,323 |

Production DB counts:
- **Content:** audios 309, books 147, posts 79, speakers 63, stores 2 (4 locations), YouTube 314 videos / 25 playlists, users 1.
- **Newsletter:** 1 subscriber (confirmed). 0 campaigns and 0 recipients ever.
- **Forms:** contact 22 (4 in last 30 d), proxy visits 296 (295 PENDING, latest 2026-10-01).
- **Contest:** 286 attempts, last 2026-09-03.
- **Media:** 910 rows, but `file_size` holds a 1-byte placeholder (media was never hydrated), so image size is unknown.

Surprises:
- **Admin notification mail is mostly failing:** `notification_failed_at` is set on 309 of 318 form rows.
- **Scheduled publishing has never been used:** 0 `POST_PUBLISHED` rows with `scheduled: true`.
- **Views are not being counted:** `posts.views` sums to 0.

### Decisions

**Confirmed** = you agreed. **Pending** = changed or explained, waiting on you.

| # | Decision | Value | Status |
|---|---|---|---|
| D1 | Email transport | ~~`worker-mailer` over Hostinger 465~~: Workers can't reach Hostinger SMTP (it sits on Cloudflare IPs, Phase 1 check 5). **Cloudflare Email Service, deferred** to group 4g, once everything else works on the Worker. Until then, email-sending routes stay on Nest | Confirmed |
| D2 | Newsletter campaigns | **Drop** the campaigns module and its CMS screens. Keep subscribe / confirm / unsubscribe | Confirmed |
| D3 | YouTube sync | Keep | Confirmed |
| D4 | OpenAPI + `/docs` | `@hono/zod-openapi` so Scalar at `/docs` is generated from the same Zod schemas that validate requests. The schemas are the only documentation code: request schemas required, response schemas only where cheap, no hand-written descriptions. `defineRoute()` wraps `createRoute`. Dropped if the generated docs turn out to need more than that | Confirmed |
| D5 | Validation error text | Envelope keys **and the `error` message text stay identical**, because the CMS shows them to users when a transaction fails. The Zod hook maps to the Nest messages | Confirmed |
| D6 | Rate limits | Binding with 60 s windows, DB limits unchanged, no Turnstile | Confirmed |
| D7 | View dedup | Binding keyed on `ip:resource`; the website does call the view routes | Confirmed |
| D8 | Caching public reads | None at first; add a cached Hyperdrive binding for public GETs only if API p95 misses the target in Phase 1 | Confirmed |
| D9 | Worker placement | ~~Smart Placement on~~. Phase 1 check 6: Smart Placement never places at our traffic. **`placement.region = "aws:eu-north-1"`** (DB time for 3 queries 182 → 28 ms) | Confirmed |
| D10 | Prisma version | 6.x (≥ 6.16) until Nest is gone | Confirmed |
| D11 | Origin during the migration | Render, via the `onrender.com` URL; nothing moves until the Hono app fully works | Confirmed |
| D12 | Images above the binding's input cap | No image above 20 MB exists (the 29 large files are audio and PDF books), so nothing to do. If one is ever uploaded, keep the original and skip variants | Confirmed |
| D13 | Sentry | **Drop**, rely on Workers Logs | Confirmed |

Answers received:
- Admin form-notification mail is failing in prod: 309 of 318 rows are flagged. Render's free plan blocks outbound SMTP ports; this is the likely cause and still to be verified.
- No newsletter campaign is planned.
- The CMS displays the API's `error` text to users when a transaction fails.
- The website currently uses only the forms endpoints; once the API is fully ported it will use most endpoints and the CMS all of them.
- Supabase is in ~~Frankfurt~~ **`eu-north-1` (Stockholm)**: Supabase project `imamzain-api-db`, pooler `aws-1-eu-north-1`.
- Render is on the free plan, so the 503s are probably cold starts.
- R2 files over 20 MB: 29. Over 25 MB: 21. Over 50 MB: 13. Over 100 MB: 1.

Not yet in hand: p95 latency baseline (Cloudflare → Analytics → Performance) and the full path list for the remaining route groups.

## 5. Phases

Session counts are for planning, not promises.

### Phase 0 — Facts and decisions (1 session)
- Record the current origin: host, URL, whether `api.imamzain.org` is proxied through Cloudflare, and the current `TRUST_PROXY_HOPS`.
- Check that crons actually fire today: recent `POST_PUBLISHED` audit rows with `scheduled: true`, and the form-outbox lag. **If they don't fire, move Phase 5 right after Phase 3.**
- Pull 30 days of requests per route group from the current host's request logs or Cloudflare analytics.
- Pull DB counts: subscribers, campaigns, recipients by status, stores, speakers, YouTube rows, largest media and the number above 20 MB, proxy visits, contest attempts.
- Fill in section 4 and record baselines for p95 latency, error rate, source lines and test lines.

**Exit:** every D row has a value.

### Phase 1 — Platform spike (1–2 sessions): go / no-go
A throwaway Worker in `worker/spike/`, never attached to the API route.
1. **Hyperdrive → Supabase.** Try the direct connection first (IPv6-only without the add-on). If that fails, use Supavisor session mode on 5432, or buy the IPv4 add-on. Turn caching off.
2. **Prisma client engine + adapter-pg in workerd.** Test:
   - a `findMany` with translations;
   - `$queryRaw` with pg_trgm `similarity()`;
   - BigInt columns;
   - an interactive `$transaction`;
   - an interactive transaction that hits a DB error, followed by more queries, to check for prisma/orm#30374.
3. **bcryptjs at cost 12:** CPU milliseconds per compare.
4. **Images binding:** 4 WebP widths from a 20 MB JPEG, plus `.info()` dimensions.
5. **Email:** one message through the D1 choice to a test inbox; check that SPF, DKIM and DMARC pass.
6. **Latency:** p50/p95 of a 3-query endpoint with and without Smart Placement, measured from the region users are in.

**Exit:** all six pass, or each failure has a documented workaround. **If 1 or 2 fails with no workaround, stop here.** The fallback is the current Docker image on Cloudflare Containers, or staying where you are.

#### Phase 1 result (2026-10-03): **Go**

Details and raw numbers: `worker/spike/README.md`. The spike ran on Workers Free against prod Supabase (`eu-north-1`).

| # | Check | Result | Verdict | Workaround / condition |
|---|---|---|---|---|
| 1 | Hyperdrive → Supabase | Reaches prod (Postgres 17.6) through the Supavisor **session** pooler (5432), which allows 15 clients. With Hyperdrive's limit at 10, about 50% of requests failed with `EMAXCONNSESSION` once the Worker moved to ARN. Hyperdrive can open a second pool while the first still holds sessions (10 + 10 > 15). **With the limit at 5:** `/three` passed 50/50 sequential and 50/50 at 10-way concurrency | **Go** | Keep Hyperdrive's origin connection limit at **5** while Supavisor's session pool is 15. Prod Nest is unaffected (it uses the transaction pooler, 6543) |
| 2 | Prisma client engine + adapter-pg | All five sub-checks pass on prod data; prisma/orm#30374 does not reproduce on 6.19.3. About 10–12 ms CPU per request is Prisma setup | **Go** | Needs Workers Paid: 9 of 845 `/three` requests were killed by Free's 10 ms CPU limit |
| 3 | bcryptjs cost 12 | One compare takes 306 / **343** / 480 / 588 ms CPU (min / median / p90 / max, n=25). A double compare was killed once on Free | **Go on Paid only** | Workers Paid (30 s default CPU). Keep cost 12 so existing hashes stay valid |
| 4 | Images binding, 4 WebP widths + `.info()` | A 19.9 MB 7000×4850 JPEG gives correct `.info()` and 320/768/1280/1920 WebP (8–231 KB). 6.5 s wall, 1.3 s CPU. A 29 MB input fails fast with a catchable error | **Go** | Run in `waitUntil` (as planned). Over 20 MB: skip variants (D12) |
| 5 | Email via the D1 choice | **Fails.** `smtp.hostinger.com` (and Hostinger's MX) are Cloudflare Spectrum IPs, and Worker sockets can't connect to Cloudflare IPs. SPF/DKIM/DMARC untested. `_dmarc.imamzain.org` has two TXT records, so DMARC is void | **No-go for D1; deferred** | Cloudflare Email Service, set up in group 4g (D1). Then onboard `imamzain.org` in Email Sending, re-run check 5 and verify SPF/DKIM/DMARC. Delete one DMARC record whenever convenient |
| 6 | Latency, 3-query route, placement on/off | Smart Placement never placed the Worker (`INSUFFICIENT_INVOCATIONS` after 30 min at 0.5 req/s, 50× prod traffic). `placement.region = "aws:eu-north-1"` takes effect at once. From a Baghdad probe: TTFB p50 **289 → 203 ms**, DB time p50 **182 → 28 ms**. From the US: TTFB p50 538 → 306 ms | **Go, with the region hint** | Use `placement.region` instead of Smart Placement (D9). Re-run with Hyperdrive at 5: Baghdad TTFB p50 211 ms, DB time p50 31 ms, 0 errors |

**Before Phase 2:** move to Workers Paid, which login (bcrypt) and Prisma CPU need. It is already budgeted in section 8. Email (check 5) is deferred to group 4g.

### Phase 2 — Skeleton and safety net (2–3 sessions)
1. **Project setup.**
   - Create `worker/` with its own `package.json`.
   - Wrangler config for Hyperdrive, R2, Images, rate limits, vars, and secrets (`wrangler secret put`).
   - Vitest, typecheck, and a CI job.
   - Bump Prisma to ≥ 6.16 in its own small PR, with the full Nest suite green.
   - Add the second generator, and make the Nest build generate only its own client (for example `prisma generate --generator client`).
2. **`lib/`.**
   - Per-request db.
   - Envelope: success `{success, timestamp, message, data}`, errors `{success:false, code, error, timestamp, path}`.
   - Error mapping, mirroring `prisma-error.util.ts`.
   - Zod validation hook: 400 in the same envelope; `.strict()` objects replace `forbidNonWhitelisted`.
   - i18n: Accept-Language plus fallback.
   - Pagination.
   - Auth middleware: JWT, user lookup, `token_version`, soft-delete check, `must_change_password` exemptions, `requirePermission('posts:update')`.
   - Rate-limit helper.
   - Audit writer via `waitUntil`.
   - CORS from `ALLOWED_ORIGINS`, secure headers, and an ETag that hashes the body without `timestamp` (like `envelopeEtag`).
   - BigInt → number.
   - A `defineRoute()` helper so each route is about 5 lines of declaration.
3. **Fallthrough.** Any path not in the ported-group table is fetched from the origin, with `X-Forwarded-For` set from `CF-Connecting-IP`.
4. **Diff harness** (`worker/test/diff/`):
   - **Database:** Postgres 16 in Docker. Restore a prod dump and run `scrub.sql`, which fakes names, phones, emails and password hashes in the users, forms, contest and newsletter tables. Save the result as a template DB.
   - **Corpus:** generated from the route table. Every GET route × sampled ids/slugs (published, draft, soft-deleted) × `lang` (ar, en, missing) × anonymous/admin token. Plus scripted write scenarios per group: create → update → publish → delete → restore.
   - **Replay:** run the corpus against Nest (DB copy A) and against `wrangler dev` (DB copy B, via Hyperdrive's local connection string).
   - **Comparison:** status, `content-type`, `etag`, and the body, ignoring `timestamp` and normalizing generated ids and dates.
   - **Output:** full reports go to `reports/<group>.md`; the console gets one line per group.
5. **Contract tests.** One black-box suite driven by `BASE_URL`, run against both targets. CI already has a Postgres 16 service in `ci.yml`: start both apps there and run the suite twice.
6. **Pass-through deploy.** Put the Worker on `api.imamzain.org/*` with **zero** ported groups, then check:
   - `audit_logs.ip_address` holds real client IPs;
   - throttles key on clients, not on Cloudflare IPs;
   - CORS and headers are unchanged;
   - the added latency is small.

**Exit:** production traffic flows through the Worker with no behavior change, and the harness and contract CI are green on `/health`.

### Phase 3 — Pilot group and conventions (1–2 sessions)
Port `post-categories` (7 routes: public list/get, admin CRUD, soft delete, restore, translations).
- Build the translatable-category factory that the other category modules will reuse.
- Write the contract tests and get them passing on Nest first, then on the Worker.
- Run the diff and ship the group.

Then write `worker/CONVENTIONS.md` (≤ 150 lines). It covers:
- file layout and `defineRoute`;
- schema naming;
- service style: plain functions, no classes or DI;
- error and transaction rules;
- the test template;
- comment policy: why-comments only, no audit history in code;
- the per-group checklist below.

**Exit:** the pilot has been live ≥ 48 h, no diffs are unexplained, and the conventions are written.

### Phase 4 — Port by group (one group per session)
**Per-group checklist:**
1. Port the group.
2. Get its contract tests green on Nest, then on the Worker.
3. Clear the diff report: every remaining diff is explained.
4. Add the group to the ported-group table and deploy.
5. Watch Workers Logs for 48 h.

| Step | Groups | Routes | Watch out for |
|---|---|---|---|
| 4a | book-, gallery-, academic-paper-categories; languages; speakers; stores; settings | 48 | built from the factory |
| 4b | static-pages, gallery, audios, academic-papers, books, posts | 74 | posts: slugs, scheduling fields, views (D7). books: series and parts |
| 4c | daily-hadiths, feeds, search, youtube (reads + the sync function), dashboard, audit-logs, health | 20 | hadith scheduling and Baghdad day; sitemap/RSS XML; pg_trgm raw SQL |
| 4d | auth, users, roles | 23 | refresh rotation, family revocation, reuse grace, `token_version`: port these line by line |
| 4e | forms, contest (+ WhatsApp) | 16 | live users; switch the contest over while it's closed |
| 4f | media | 8 | presign (`aws4fetch`); confirm (HEAD + content sniff); variants; the delete race guard |
| 4g | newsletter, campaigns (+ email) | 17 | per D1 / D2 |

Total with the pilot: 213 routes.

### Phase 5 — Background jobs (1–2 sessions)

| Job | Today | Worker Cron Trigger |
|---|---|---|
| Scheduled post publish | every minute | `* * * * *` |
| Form notification outbox | every minute | `* * * * *` |
| Campaign sender (if D2 keeps it) | every minute | `* * * * *` |
| Orphan-upload cleanup | hourly | `0 * * * *` |
| YouTube sync | every 6 h | `0 * * * *`, runs when `hour % 6 == 0` |
| Refresh-token, login-throttle and audit-retention cleanup | daily at 03:15 / 03:20 / 03:30 | `15 3 * * *`, one handler |

**Cutover order:**
1. Deploy Nest with `DISABLE_CRON=true`.
2. Confirm Nest's ticks have stopped.
3. Deploy the Worker crons.

Jobs that can run longer than a minute keep their row leases. Add a lease only where a job has none.

### Phase 6 — Cutover and cleanup (1–2 sessions)
- **Confirm the origin is idle:** Workers Logs show zero fallthroughs for 7 days.
- **Remove Nest:**
  - Remove the fallthrough and decommission the Nest deployment.
  - Delete `src/`, the Nest dependencies, Jest config and unused env vars.
  - Optionally move `worker/` to the repo root.
- **Docs:** update `docs/integration.md` and the README deploy steps, and add a "what changed" section to the CMS notes.
- **Measure against the Phase 0 baselines:** source lines, test lines, p95, error rate.
- **Optional afterwards:** Prisma 7, Turnstile on public forms, the cached Hyperdrive binding for public GETs.

## 6. Testing

- **Diff harness: the wide net.** It covers every route on prod-like data and catches behavior nobody wrote down.
- **Contract tests: the precise net, kept after the migration.** For each group:
  - the happy path, 401/403, 400 and 404;
  - scenarios for the rules that matter:
    - permissions, including the `restore()` privilege check;
    - contest scoring, dedup, closed state and phone normalisation;
    - scheduled publish, visibility, soft delete and restore;
    - slugs and translation fallback;
    - daily-hadith scheduling, the random fallback and the Baghdad day;
    - form validation and notifications;
    - the media confirm/delete race;
    - refresh-token rotation and reuse detection.
- **Target: ~300–400 tests.** They run against both targets until Nest is deleted.
- **Nest's Jest unit tests are not ported.**

## 7. Risks

| Risk | Mitigation |
|---|---|
| Hyperdrive can't reach Supabase's direct endpoint (IPv6) | Phase 1; Supavisor session mode or the IPv4 add-on |
| adapter-pg interactive-transaction bug (prisma/orm#30374) | reproduce in Phase 1; pin a fixed version; use single statements or batch `$transaction([...])` where no callback is needed |
| Hyperdrive serves stale reads to the CMS | caching off on the main binding |
| Client IP lost behind the Worker, so every visitor shares one throttle bucket | Phase 2 check, before any group moves |
| Email deliverability changes with the new sender | SPF/DKIM/DMARC on Cloudflare DNS; start with transactional mail; watch bounces |
| Silent drift in rarely used paths | diff harness on prod-like data; Nest stays as the fallback until Phase 6 |
| Crons run twice during cutover | disable Nest's crons first |
| "While we're here…" scope creep | rule 4; improvements go on a post-cutover list |

## 8. Cloudflare cost

| Item | Cost |
|---|---|
| Workers Paid | $5/month; required for the CPU limits, Hyperdrive, Images and Email Service |
| Images | 5,000 unique transformations/month included (≈ 1,250 uploads at 4 variants each) |
| Email Service | beta; 3,000 emails/month included, then $0.35 per 1,000 |
| Rate Limiting binding | price not verified yet; check before Phase 2 |
| Current origin host | runs until Phase 6, then goes away |

## 9. Running this with Claude cost-efficiently

### Prices per million tokens (input / output), September 2026

| Model | Price | Use it for |
|---|---|---|
| Fable 5.1 | $10 / $50 | Not needed for this project. |
| Opus 5.5 | $4 / $20 | Unknowns, patterns others will copy, security- and user-sensitive groups |
| Sonnet | $2 / $10 | Pattern-following ports once `CONVENTIONS.md` exists |
| Haiku 4.5 | $1 / $5 | Search subagents, mechanical cleanup, running queries (it has no effort setting) |

On a subscription, all models draw from the same 5-hour and weekly limits. Per token, Opus uses about twice what Sonnet does. Higher effort means more thinking tokens, which are billed as output. Opus 5.5 defaults to `medium` effort, so set the level explicitly.

### Model and effort per phase

| Phase | Model | Effort | Why |
|---|---|---|---|
| 0 Facts & decisions | Sonnet | low | queries and tables |
| 1 Spike | Opus 5.5 | high | unknown platform behavior; a wrong conclusion here costs weeks |
| 2 Skeleton + harness | Opus 5.5 | high | every later route copies these patterns |
| 3 Pilot + conventions | Opus 5.5 | high | writes the template Sonnet will follow |
| 4a Taxonomies | Sonnet | low–medium | factory-driven |
| 4b Content | Sonnet | medium (high for posts and books) | pattern plus some rules |
| 4c Hadiths / feeds / search / … | Sonnet | medium | |
| 4d Auth / users / roles | Opus 5.5 | high | security semantics |
| 4e Forms / contest | Opus 5.5 | high | live users, business rules |
| 4f Media | Opus 5.5 | high | race conditions, new bindings |
| 4g Newsletter / campaigns | Sonnet medium if simplified; Opus 5.5 high if the sender is kept | | |
| 5 Jobs | Opus 5.5 | medium | small but concurrency-sensitive |
| 6 Cleanup & docs | Sonnet | low | mechanical |
| Diff triage (any phase) | Sonnet medium; Opus high only for diffs Sonnet can't explain | | |

That's roughly 30 sessions: ~12 on Opus, ~15 on Sonnet, ~3 at low effort. Assuming similar token counts per session, putting the pattern-following half on Sonnet cuts the total by about a third compared with all-Opus. **If a Sonnet session fails a group twice, redo that group on Opus** instead of retrying a third time.

### Habits that save the most
1. **One group per session.** Start each one fresh from this plan; don't carry a 150k-token context into the next group.
2. **Conventions live in files, not chat.** A short `CLAUDE.md` points at this plan and `worker/CONVENTIONS.md`, so each session starts with a file read, not rediscovery.
3. **The first prompt names the exact files** (templates below).
4. **Terse scripts.** `npm run check:<group>` prints one line per check and writes full output to files. Long test logs are one of the biggest token sinks.
5. **Cheap subagents.** Set `CLAUDE_CODE_SUBAGENT_MODEL=haiku` (or `model: haiku` in the agent's frontmatter) so search and exploration don't run on Opus.
6. **Pick model and effort before the first message.** Changing either mid-session rebuilds the prompt cache.
7. **The subscription prompt cache lasts 1 hour.** After a longer break, start a new session from the plan instead of resuming a long one.
8. **Skip the premium options:**
   - fast mode (2× price) and Fable;
   - multi-agent workflows for routine groups: each agent carries its own full context, so a 10-agent run costs roughly 10 sessions.

   One independent parity review before Phase 6 is the only workflow worth considering; keep it under ~1.5M subagent tokens, since this account's limit window is ~2M.
9. **Check `/usage` after the first few sessions** and adjust the model split with real numbers.
10. **`opusplan`** (Opus in plan mode, Sonnet executing) suits the 4b groups that have their own rules. Plan once, then execute: every switch between the two rebuilds the cache.

### Session prompt templates

Routine group (Sonnet, medium):
```
Port <group>: src/<group>/ → worker/src/features/<group>/, following worker/CONVENTIONS.md
and docs/HONO-MIGRATION-PLAN.md (Phase 4). Use worker/src/features/post-categories/ as the
only reference; don't read other features. Write worker/test/contract/<group>.test.ts,
run it against Nest first (must pass), then the Worker. Run `npm run check:<group>` until
green; every remaining diff gets an explanation in worker/test/diff/reports/<group>.md.
Don't deploy. If a rule in the Nest code is unclear, stop and ask instead of guessing.
```

Sensitive group (Opus 5.5, high): the same prompt, plus:
```
Before porting, list every business rule in src/<group>/ and write a scenario test for
each one against Nest. Port those rules line by line; simplify only the infrastructure.
```

Diff triage (Sonnet, medium):
```
Read worker/test/diff/reports/<group>.md. For each unexplained diff, find the cause by
comparing src/<group>/ with worker/src/features/<group>/, fix the Worker (Nest is the
reference unless the diff is a known Nest bug), and rerun `npm run check:<group>`.
```

## 10. Done means
- All 213 routes are served by the Worker, the origin has had zero traffic for 7 days, and Nest is deleted.
- Source is ≤ ~12k lines, with ~300–400 contract tests, all green.
- p95 latency and error rate are no worse than the Phase 0 baseline.
- The CMS and website needed no changes.
