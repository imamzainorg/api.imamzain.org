# api.imamzain.org

REST API for ImamZain.org: a Hono app on Cloudflare Workers (`worker/`). It replaced the NestJS app
(`src/`, removed in Phase 6 of the migration plan below; see git history for it).

## Read first
- `docs/HONO-MIGRATION-PLAN.md`: what and why (phases, decisions D1–D13, ground rules).
- `docs/HONO-MIGRATION-RUNBOOK.md`: which session did what.
- `worker/CONVENTIONS.md`: the rulebook for route groups; follow it over anything in this file.

## Layout
- `worker/`: the Worker, with its own `package.json`, `wrangler.jsonc` and Vitest. Not moved to the repo root.
- `worker/spike/`: Phase 1 throwaway; don't build on it.
- `prisma/schema.prisma` and `prisma/migrations`: the database, shared by the Worker and the seed scripts.
  Two generators:
  - `client`: for the root scripts (`prisma-client-js`); `npm run prisma:generate`.
  - `worker`: for the Worker (`prisma-client`, `engineType = "client"`), output `worker/src/generated/`
    (gitignored). `cd worker && npm run gen` generates it.
- `prisma/*.ts`: seed and one-off data scripts, run from the repo root (`npm run prisma:seed`, ...).

## Commands
Repo root (Prisma only): `npm run type-check` (seed scripts), `npm run prisma:deploy`, `npm run prisma:seed`.

Worker (`cd worker`):
```bash
npm run typecheck   # generates the Prisma client + wrangler types, then tsc
npm test            # vitest unit tests
npm run dev         # wrangler dev; Hyperdrive uses localConnectionString (local Postgres)
npm run contract    # black-box suite against wrangler dev; needs a migrated + seeded Postgres
```
How the contract harness works: `worker/test/README.md`.

## Testing policy
Applies to the Worker and the seed scripts. Fewer, meaningful tests beat coverage-driven ones. If following
this ever produces more tests than the existing process would, drop the policy for that case.
1. Test externally observable behavior, not implementation details.
2. Prioritize business rules, security boundaries, data transformations, authorization, failure modes.
3. No tests written only to raise coverage.
4. Don't test trivial getters/setters, constants, types or framework behavior.
5. Don't test private/internal functions directly unless they hold substantial independent logic.
6. Prefer a few high-value tests over exhaustive permutations.
7. Per feature cover: the primary success path, important boundary cases, important failure/security cases.
8. No tests whose only point is "a mock was called", unless that interaction is itself the contract.
9. If behavior is obvious from the code and has no real regression risk, don't test it just because you can.
10. Before adding a test, name the regression it would catch. No answer, no test.

## Rules
- The CMS and the website depend on the contract: URLs, envelopes, status codes, error `code`s and `error`
  text. Change them only deliberately, announced to both.
- Schema changes go through `prisma/migrations`; split additive and destructive migrations.
- Never put secrets in `wrangler.jsonc`; use `wrangler secret put` or `worker/.dev.vars`.
- Don't deploy unless the session prompt says so.
- Commits and PRs: no AI co-author trailers, AI attribution footers or session links.
