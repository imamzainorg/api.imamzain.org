# Worker tests

| Where | What | Run |
|---|---|---|
| `*.test.ts` (this folder) | Unit tests of `src/lib` helpers and the seed's grant planners | `npm test` |
| `contract/` | Black-box HTTP suite against the Worker under `wrangler dev --local` | `npm run contract [-- <group>]` |
| `harness/` | Starts `wrangler dev`, mints admin tokens | — |

## `npm run contract`

Starts the Worker with a generated env file (`test/.work/worker.env`, which also stops wrangler reading
`.dev.vars`) on port 8797 (`CONTRACT_PORT` overrides it), runs the suite once, and stops it. Logs are in `test/.work/logs/` (gitignored).

The database is `CONTRACT_DATABASE_URL`, default `postgresql://postgres:postgres@localhost:5432/imamzain_test`.
It must be migrated and seeded first; from the repo root:

```bash
npm run prisma:deploy && SEED_ADMIN_PASSWORD=local-only BCRYPT_ROUNDS=4 npm run prisma:seed
```

- Never point it at a database you care about: the tests write rows (they use unique names and clean up
  after themselves, but don't count on it).
- Mail, R2, Twilio and YouTube are not reachable: the env file has fake R2 credentials, wrangler's local
  email binding sends nothing, and the other secrets are unset.
- Crons are off; `contract/jobs.test.ts` fires them through `/__scheduled?cron=...` (`--test-scheduled`).
- Every request carries a synthetic `CF-Connecting-IP`, so rate limits never fill unless a test shares
  one IP on purpose.
- Admin requests use a token minted for the DB's first super-admin, so nothing is written to sign in.

## Adding a group

`contract/<group>.test.ts`, using `support/http.ts` (`api`, `adminToken`, `expectSuccess`, `expectError`).
Tests create their own data with unique names and never assume an empty DB.

## CI

The `contract` job in `.github/workflows/ci.yml` migrates and seeds the Postgres service, then runs
`npm run contract` with `CONTRACT_DATABASE_URL`.
