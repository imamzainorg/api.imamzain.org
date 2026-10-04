# api.imamzain.org

REST API for ImamZain.org. It is being moved from NestJS (`src/`) to Hono on Cloudflare
Workers (`worker/`) by the strangler plan below. Nest stays in production until Phase 6.

## Read first
- `docs/HONO-MIGRATION-PLAN.md`: what and why (phases, decisions D1–D13, ground rules).
- `docs/HONO-MIGRATION-RUNBOOK.md`: which session does what, with which prompt.
- `worker/CONVENTIONS.md` (written in Phase 3): the rulebook for every Worker port.
  Once it exists, follow it over anything in this file.

## Layout
- `src/`: Nest app, the reference implementation. Fix Nest bugs here only for groups not ported yet.
- `worker/`: Hono Worker with its own `package.json`, `wrangler.jsonc` and Vitest.
- `worker/spike/`: Phase 1 throwaway; don't build on it.
- `prisma/schema.prisma`: shared by both. Two generators:
  - `client`: Nest (`prisma-client-js`). The root scripts run `prisma generate --generator client`.
  - `worker`: Worker (`prisma-client`, `engineType = "client"`), output `worker/src/generated/`
    (gitignored). `cd worker && npm run gen` generates it.
- Schema changes go through `prisma/migrations` and must be additive only during the migration.

## Commands
Nest (repo root):
```bash
npm run type-check
npm test                  # unit
npm run test:integration  # needs DATABASE_TEST_URL (see .env.test.example)
```
Worker (`cd worker`):
```bash
npm run typecheck   # generates the Prisma client + wrangler types, then tsc
npm test            # vitest
npm run dev         # wrangler dev; Hyperdrive uses localConnectionString (local Postgres)
npm run check:<group>  # typecheck + diff + contract tests on Nest and the Worker (needs Docker)
```
How the harness works and what to add when porting a group: `worker/test/README.md`.

## Rules
- Same contract: URLs, envelopes, status codes, error `code`s and `error` text stay identical
  to Nest (D5). Contract changes wait until after cutover.
- Trim infrastructure (Redis, locks, in-process caches); port business rules line by line.
- No new features during the migration. Prisma stays on 6.x (≥ 6.16) until Nest is gone (D10).
- Never put secrets in `wrangler.jsonc`; use `wrangler secret put` or `worker/.dev.vars`.
- Don't deploy unless the session prompt says so.
- Commits and PRs: no AI co-author trailers, AI attribution footers or session links.
