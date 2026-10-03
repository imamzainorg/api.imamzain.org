# Phase 1 spike: checks 1–6

Throwaway Worker for `docs/HONO-MIGRATION-PLAN.md`, Phase 1:
- **Checks 1–2:** Prisma 6.19.3 with `engineType = "client"`, `@prisma/adapter-pg`, one client per request,
  through Hyperdrive `c81bd672682b4d7c8ee2661b0d0f7f08`.
- **Check 3:** bcryptjs.
- **Check 4:** Images binding.
- **Check 5:** worker-mailer.
- **Check 6:** latency with and without placement.

It is never attached to the API route. Delete it after Phase 1. The go/no-go table is in the plan under Phase 1.

`prisma/schema.prisma` is a copy of `../../prisma/schema.prisma` with only the generator swapped.

## Routes

Every route is read-only or rolls back. `/tx` writes `views + 0`, which is a no-op.

| Route | Check |
|---|---|
| `/ping` | 1: DB reachable; returns server version and address |
| `/find-many` | 2a: `posts.findMany` with `post_translations` and category translations |
| `/similarity` | 2b: `$queryRaw` with `similarity()`, same SQL shape as `src/search/search.service.ts` |
| `/bigint` | 2c: BigInt via the ORM (`posts.views`, `media.file_size`) and raw SQL, including 2^53+1 |
| `/tx` | 2d: interactive `$transaction` (read, update, raw query); checks one txid throughout |
| `/tx-error` | 2e: prisma/orm#30374 steps: warm-up, JS rollback, duplicate-key `INSERT` in a tx (P2002), then `findUnique`, `count` and another tx on the same client |
| `/pg-select1`, `/connect-only`, `/select1`, `/select1x5` | CPU breakdown: plain `pg` vs Prisma setup vs per-query cost |
| `/bcrypt` (`?miss` adds a failing compare) | 3: one `bcryptjs.compare` against a cost-12 hash |
| `POST /images` (JPEG body) | 4: `IMAGES.info()`, then WebP at 320/768/1280/1920 q82 (the Nest `VARIANT_WIDTHS`), each re-checked with `.info()` |
| `POST /email` | 5: one message via `worker-mailer`, SMTPS 465, only ever to `EMAIL_TO`. Needs the `SMTP_HOST/PORT/USER/PASS`, `EMAIL_FROM` and `EMAIL_TO` vars (removed after the test; add `"keep_vars": true` to wrangler.jsonc if you set them in the dashboard again) |
| `/three` | 6: three sequential queries shaped like `GET /books` (count, page of 20, categories) |

## Deploy and verify

```bash
cd worker/spike
npm ci
npx wrangler deploy      # runs on Workers Free; bundle is 876 KiB gzip (limit 3 MB)
./check.sh https://imamzain-spike.<your-subdomain>.workers.dev [a-jpeg-under-20MB.jpg]
curl -X POST https://imamzain-spike.<your-subdomain>.workers.dev/email
./latency.sh https://imamzain-spike.<your-subdomain>.workers.dev/three 40 label    # from where you are
./latency-iq.py label 40                                                          # from a Globalping probe in Iraq
```

`wrangler.jsonc` currently has `placement.region = "aws:eu-north-1"`. Remove `placement` to measure without it.

Expected output: every check route prints `"pass": true`. `/ping` has no pass field; it returns the Postgres version.
CPU per request is in the dashboard under Workers → imamzain-spike → Observability (`cpuTimeMs`).

## Results, checks 1–2 (2026-10-01)

### Local workerd + Postgres 16 (prod schema from `prisma/migrations`, seeded rows)

All five check-2 routes **pass**.

- **Find-many:** translations and category translations are nested correctly, and `published_at` is a `Date`.
- **Similarity:** `similarity()` returns `number` scores.
- **BigInt:** the ORM and raw SQL both return `bigint`, and `9007199254740993n` comes back exact.
- **Interactive transaction:** one txid across all statements, and it commits.
- **prisma/orm#30374** did not reproduce. After the P2002 inside the tx, `findUnique('ar')`, both counts and a follow-up tx all returned correct results. This held for 100 sequential calls and 100 concurrent calls (10 parallel). The issue was filed against 7.8.0; we are on 6.19.3.

### CPU per request (isolate thread, user time, local workerd, average of 200 warm requests)

These are local numbers. `wrangler dev` adds about 1.9 ms per request (the no-op 404 baseline). Production numbers come from Observability after the deploy.

| Route | CPU ms | Minus baseline |
|---|---|---|
| 404 (no DB) | 1.9 | 0 |
| `pg-select1` (no Prisma) | 5.0 | 3.1 |
| `connect-only` | 10.4 | 8.5 |
| `select1` | 13.6 | 11.7 |
| `select1x5` | 16.1 | 14.2 |
| `ping` | 13.7 | 11.8 |
| `similarity` | 14.1 | 12.2 |
| `bigint` (3 queries) | 16.0 | 14.1 |
| `tx` | 19.6 | 17.7 |
| `find-many` | 20.1 | 18.2 |
| `tx-error` (≈12 queries, 3 tx) | 25.7 | 23.8 |
| Cold first request in an isolate | ≈223 | |

Where the cost goes: about **8.5 ms per request is Prisma client setup**. On every connect, the WASM query compiler is built from the 56-model schema. Each extra simple query adds about 0.6 ms. Reusing one `PrismaClient` across requests did not cut the cost, and it failed under concurrency, so it is not an option.

**Every Prisma route is over the Free plan's 10 ms in this measurement.** Confirm with the deployed numbers.

### Deployed: `imamzain-spike.imamzainalabdeen1.workers.dev` → Hyperdrive → Supabase prod

**Check 1: pass, with a connection-limit problem.**
- The Worker reaches prod through the Supavisor session pooler (`aws-1-eu-north-1.pooler.supabase.com:5432`). `/ping` returns Postgres 17.6, and `/tx-error` counts 79 posts, which matches prod.
- **Problem:** under load, Supavisor rejects connections with `EMAXCONNSESSION: max clients reached in session mode, limited to pool_size: 15`. A related error is `Connection terminated unexpectedly`. Two changes reduce it but don't remove it:
  - The adapter now uses `max: 1`, so each request opens one connection. Before, Prisma's parallel relation queries opened several.
  - Hyperdrive's `origin_connection_limit` was lowered from 20 to 10. It is a soft limit, applied per Hyperdrive location.
  - Result: 25/25 sequential `/find-many` calls passed. Under 10-way concurrency, 44 of 50 passed.
- **Fix:** give Hyperdrive more origin headroom than session mode's 15. Use the direct connection (bounded by `max_connections` = 60), or raise the pool size.

**Check 2: all five routes pass against prod data.** prisma/orm#30374 did not reproduce in 25 sequential runs.

**CPU per request, production** (from `wrangler tail`, 25 requests per route, ms):

| Route | min | median | p90 | max | wall median |
|---|---|---|---|---|---|
| `pg-select1` (no Prisma) | 2 | 2 | 5 | 16 | 113 |
| `connect-only` | 9 | 12 | 21 | 50 | 13 |
| `select1` | 12 | 16 | 32 | 99 | 126 |
| `select1x5` | 15 | 20 | 30 | 45 | 554 |
| `ping` | 11 | 14 | 18 | 84 | 126 |
| `similarity` | 12 | 14 | 20 | 38 | 147 |
| `bigint` | 15 | 20 | 36 | 57 | 345 |
| `tx` | 18 | 25 | 49 | 67 | 783 |
| `find-many` (n=187) | 11 | 24 | 95 | 208 | 449 |
| `tx-error` | 31 | 37 | 63 | 71 | 1739 |

- **CPU:** every Prisma route is over 10 ms at the median. About 10–12 ms of that is Prisma's per-request setup (`connect-only`); plain `pg` costs 2 ms.
- **No kills:** none of the roughly 440 requests ended as `exceededCpu`; every tail outcome was `ok`.
- **Wall time:** about 110 ms per round trip to Stockholm without Smart Placement, so the interactive transactions take 0.8–1.7 s. Check 6 measures placement.

## Results, checks 3–6 (2026-10-03)

Deployed to `imamzain-spike.imamzainalabdeen1.workers.dev` on **Workers Free**. CPU comes from `wrangler tail --format json` (`cpuTime`).

### Check 3: bcryptjs cost 12

| | n | CPU min | median | p90 | max | outcome |
|---|---|---|---|---|---|---|
| 1 compare (`/bcrypt`) | 25 | 306 | 343 | 480 | 588 | 25 ok |
| 2 compares (`/bcrypt?miss`) | 5 | 180 | 671 | 1021 | 1021 | 4 ok, 1 `exceededCpu` |

- **Correctness:** the compare passes.
- **CPU:** one compare costs about 340 ms. That is 34× the Free plan's 10 ms.
- **Free plan:** it let most of these through, but not all, so login on Free would fail at random.
- **Paid plan:** the default limit is 30 s, so this is fine.

### Check 4: Images binding

Input: a 19.9 MB, 7000×4850 JPEG (ImageMagick noise; `D12`'s cap is 20 MB for `.input()`).

- **`.info()`:** returns `{ format: image/jpeg, width: 7000, height: 4850, fileSize: 19892344 }`.
- **Variants:** all four come out as `image/webp`, at the requested widths:

| Width | Height | Bytes |
|---|---|---|
| 320 | 221 | 8,508 |
| 768 | 532 | 37,618 |
| 1280 | 886 | 91,980 |
| 1920 | 1,330 | 230,744 |

- **Time:** 6.5 s wall for `.info()`, the four transforms and four `.info()` re-checks, so it belongs in `waitUntil`. CPU was 1.34 s, most of it copying the 20 MB body into `Blob`s in JS. The real pipeline can pass R2 streams straight to the binding instead.
- **Over the cap:** a 29 MB JPEG fails after 170 ms with a catchable `Error: Network connection lost`. D12's "keep the original, skip variants" works as written.

### Check 5: email via worker-mailer → Hostinger 465: **fails**

- **Error:** `/email` fails in 6 ms with `proxy request failed, cannot connect to the specified address`.
- **Cause:** `smtp.hostinger.com` resolves to `172.65.255.143` / `2606:4700:90::…`. Those are Cloudflare addresses (Hostinger fronts SMTP with Spectrum), and Workers' `connect()` refuses Cloudflare IP ranges ([docs](https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/#considerations)). `mx1/mx2.hostinger.com` are also Cloudflare addresses. No Worker can talk SMTP to Hostinger.
- **SPF / DKIM / DMARC:** not tested, because nothing was sent.
- **DNS found along the way:** `_dmarc.imamzain.org` has **two** TXT records (`p=none` and `p=none; rua=…`). Receivers treat more than one DMARC record as no DMARC at all. Delete one.

### Check 6: latency of `/three`, with and without placement

Successful requests only (see the errors below).
- **Iraq:** one Globalping probe in Baghdad, on a hosting network. It reaches Cloudflare at **SOF** (Sofia). Every Globalping request opens a new TLS connection; `firstByte` is TTFB after the handshake.
- **IAD:** this container, in the US. Its edge is IAD.
- **Server wall:** the Worker's own `wallMs` for the three queries.

| Where | Config | n | TTFB p50 | TTFB p95 | Server wall p50 | Server wall p95 |
|---|---|---|---|---|---|---|
| Baghdad → SOF | no placement | 39 | 289 | 384 | 182 | 197 |
| Baghdad → SOF | `placement.region = aws:eu-north-1` (runs in ARN) | 35 | 203 | 509 | 28 | 33 |
| US → IAD | no placement | 32 | 538 | 759 | 334 | 379 |
| US → IAD | `placement.region = aws:eu-north-1` (runs in ARN) | 34 | 306 | 413 | 28 | 31 |

- **Smart Placement:** it never placed the Worker. It ran from 05:07 to 05:40 UTC with about 0.5 req/s from IAD plus about 80 Globalping requests from Europe, Asia, Africa and South America. It stayed at `INSUFFICIENT_INVOCATIONS` and every response was `cf-placement: local-…`, so it behaves exactly like "off". Production API traffic is about 0.01 req/s, 50× less, so Smart Placement will not place the real Worker either.
- **Region hint:** `placement.region = "aws:eu-north-1"` (the Supabase project's region; the pooler is `aws-1-eu-north-1`) takes effect immediately: `cf-placement: remote-ARN`.
- **DB time:** the three queries drop from 182 ms (SOF) or 334 ms (IAD) to 28 ms.
- **Baghdad TTFB:** the p50 improves by 86 ms. The p95 is noisier because of the errors below.
- **Errors:** with the Worker in ARN, about half of the requests failed, even when sent one at a time (35 of 70 from Baghdad, 36 of 70 from IAD). The error was `EMAXCONNSESSION ... pool_size: 15`, the session-mode limit from check 1. Without placement, only 9 of about 850 failed, and those were `exceededCpu` on Free, not DB errors.
- **Production:** not affected. Nest uses the transaction pooler (6543). But `prisma migrate deploy` uses the session pooler (`DIRECT_URL`) and would hit the same limit while Hyperdrive holds the 15 sessions.
- **Free plan CPU:** `/three` used a median 21 ms and p90 88 ms of CPU. 9 of 845 requests were killed with `exceededCpu`.

**Fix (later the same day):** Hyperdrive's `origin_connection_limit` went from 10 to 5. Hyperdrive can open a second pool while the first still holds its sessions, and 2 × 10 > 15. With the limit at 5, with the hint, from IAD:
- **Sequential:** 50 of 50 OK.
- **10-way concurrency:** 50 of 50 OK.
- **Latency:** server wall p50 31 ms, p95 79 ms; TTFB p50 357 ms.

From Baghdad, the 17 probes that ran all returned 200: TTFB p50 211 ms, server wall p50 31 ms. The other 23 were Globalping errors that never reached the Worker.
