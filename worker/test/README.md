# Worker tests

| Where | What | Run |
|---|---|---|
| `*.test.ts` (this folder) | Unit tests of `src/lib` | `npm test` |
| `contract/` | Black-box HTTP suite, run unchanged against Nest and against the Worker | `npm run contract [-- <group>]` |
| `diff/` | Replay harness: Nest vs the Worker on a scrubbed prod copy, one report per group | `npm run diff -- <group>` |
| `check.ts` | All of the above for one group (plan, Phase 4) | `npm run check:<group>` |
| `harness/` | Shared plumbing: Docker Postgres, starting Nest and `wrangler dev`, admin tokens | — |

## `npm run check:<group>`

Prints one line per check and exits 1 if any fails:

```
check health
  typecheck        ok
  diff             ok    6 requests, 6 same, 0 diffs (0 unexplained) → test/diff/reports/health.md
  contract nest    ok    7 passed
  contract worker  ok    7 passed
```

Full output is in `test/.work/logs/` (gitignored). Needs Docker Desktop running. The first run restores the
prod dump from `C:\dumps\imamzain.dump` (runbook S6), or from `DIFF_DUMP` if set. After that, the scrubbed
template DB lives in the `imamzain-diff-pg` container and the dump is only read again when it changes.

Run one group per check: the diff needs fresh DB copies, and a second group would see the first one's writes.

## What runs where

- **Postgres 16** in Docker on port 55432. The template is built once: `pg_restore` of the public schema,
  then `diff/scrub.sql` (fakes names, phones, e-mails, password hashes, IPs; every password becomes
  `harness-password`), then `prisma migrate deploy`. Each run clones it into `diff_a` and `diff_b`.
- **Nest A** (port 3101) on `diff_a` is the reference. **The Worker** (`wrangler dev --local`, port 8797) runs
  on `diff_b`, and its fallthrough goes to **Nest B** (port 3102), also on `diff_b`. That is the production
  strangler layout, so ported and unported routes see the same data.
- Nest is hermetic: running from `test/.work/` is not enough, because the generated Prisma client loads
  the repo-root `.env` whatever the cwd (without overriding variables that are already defined). So
  `startNest` defines every variable named in `.env.example` and `.env.test.example` itself, blank unless
  Nest needs a value (`NON_BLANK_NEST_ENV` in `harness/servers.ts`). No real mail, R2, WhatsApp or YouTube
  channel. When a new variable is added to `.env.example`, it is picked up; if blank is not the same as unset
  for it (a `??` default, or `env.validation.ts` rejects it), add it to that map.
  The Worker gets a generated `--env-file`, which also stops wrangler reading `.dev.vars`. Crons are off.
- Every request carries a synthetic client IP (`X-Forwarded-For` for Nest, `CF-Connecting-IP` for the
  Worker), so throttles never fill unless a test shares one IP on purpose.
- Admin requests use a token minted for the DB's first super-admin, so nothing is written to sign in.

## Diff harness

- **Corpus:** every GET route of the group in Nest's `/openapi.json` × sampled path parameters × `lang`
  (ar, en, none) × anonymous/admin, plus `page=2&limit=5` where the route paginates. Then the group's write
  scenarios, if any.
- **Compared:** status, `content-type`, `etag` and the body. The envelope `timestamp` and error `requestId`
  are ignored. Ids a scenario creates are paired between A and B. Datetimes generated during the run are
  treated as equal. ETags are compared only where the bytes should be identical: not for error envelopes,
  and not when ids or dates were normalized.
- **Report:** `diff/reports/<group>.md` is regenerated on every run except its `## Explanations` section.
  Explain a diff with a bullet holding a backticked key, where `*` matches anything:
  ``- `GET /api/v1/posts* [*] $.data[*].views`: counted by the RL_VIEW binding now (D7).``
  The check passes when every diff is explained.

## Porting a group: what to add

1. `"check:<group>": "tsx test/check.ts <group>"` in `package.json`.
2. `contract/<group>.test.ts`, using `support/http.ts` (`api`, `adminToken`, `expectSuccess`, `expectError`).
   Tests create their own data with unique names and never assume an empty DB. The suite runs twice on
   one DB in CI, and on the prod copy locally.
3. A sampler for each path parameter in `diff/samplers.ts`, e.g. `'post-categories': { id: rows('post_categories') }`.
   A route without one is skipped and listed in the report.
4. `diff/scenarios/<group>.ts` with the write lifecycle (create → update → publish → delete → restore).
   The format is in `diff/scenario.ts`.
5. If the group's URLs don't start with its name, add it to `GROUP_PREFIXES` in `diff/corpus.ts` (contest,
   campaigns and feeds are already there).

## CI

The `contract` job in `.github/workflows/ci.yml` migrates and seeds the Postgres service, then runs
`npm run contract` with `CONTRACT_DATABASE_URL`: one Nest, and the Worker falling through to it. The diff
harness doesn't run in CI, because it needs the prod dump.
