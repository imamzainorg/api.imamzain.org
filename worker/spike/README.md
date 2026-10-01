# Phase 1 spike: checks 1 and 2 (DB)

Throwaway Worker for `docs/HONO-MIGRATION-PLAN.md`, Phase 1 checks 1 and 2: Prisma 6.19.3 with
`engineType = "client"`, `@prisma/adapter-pg`, one client per request, through Hyperdrive
`c81bd672682b4d7c8ee2661b0d0f7f08`. It is never attached to the API route. Delete it after Phase 1.

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

## Deploy and verify

```bash
cd worker/spike
npm ci
npx wrangler deploy      # runs on Workers Free; bundle is 876 KiB gzip (limit 3 MB)
./check.sh https://imamzain-spike.<your-subdomain>.workers.dev
```

Expected output: every check route prints `"pass": true`. `/ping` has no pass field; it returns the Postgres version.
CPU per request is in the dashboard under Workers → imamzain-spike → Observability (`cpuTimeMs`).

## Results (2026-10-01)

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
