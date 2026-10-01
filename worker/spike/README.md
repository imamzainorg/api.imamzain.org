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

Expected output: every check route prints `"pass": true`, and `/ping` returns a Postgres 17 version.
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

### Check 1: Hyperdrive → Supabase

Not exercised from this session: the cloud environment's network policy blocks `api.cloudflare.com` and `*.workers.dev`. What is known:

- Hyperdrive `imamzain-db` points at the **Supavisor session pooler**, `aws-1-eu-north-1.pooler.supabase.com:5432`, user `postgres.rvvemsbkencpoltrhqyb`. Caching is off and the origin connection limit is 20. Hyperdrive tests the origin connection when it creates the config, so the pooler accepted it.
- Supabase project `rvvemsbkencpoltrhqyb` is in **eu-north-1 (Stockholm)**, not Frankfurt. It runs Postgres 17 with pg_trgm 1.6. `max_connections` is 60, with 29 in use when checked.
