# Hono migration — runbook

This is the step-by-step companion to `docs/HONO-MIGRATION-PLAN.md`. The plan says *what* and *why*; this file says **who does what, in which session, with which prompt**. Work top to bottom. Tick each box as you go.

---

## How every session works

- **New session:** open a fresh session and set the model and effort *before* the first message.
- **Same session:** keep going in the current session. Do this only when the next step needs what was just built *and* the conversation is still short. If the context meter is past about half, start a new session instead.
- **The prompt:** paste the prompt block as-is, after replacing anything in `<angle brackets>`.
- **The preamble:** every prompt starts with this line; keep it:
  > `Context: docs/HONO-MIGRATION-PLAN.md and docs/HONO-MIGRATION-RUNBOOK.md. Branch off main as hono/<step>, commit there (no AI co-author trailers), open a PR, and don't deploy unless this prompt says so.`
- **Your part** is the ✋ checklist under each step.

### Standard deploy, verify and rollback (used from S7 on)

1. Wait for the PR's CI to go green, then merge it.
2. Deploy:

   ```bash
   cd worker && npx wrangler deploy
   ```

3. Watch the logs live for ~10 minutes. The same logs are in the dashboard under Workers → Logs.

   ```bash
   npx wrangler tail --status error
   ```

4. Click through the affected screens once in the CMS, and on the website if the group is public.
5. If anything is wrong, roll back. Nest takes over again within seconds.

   ```bash
   npx wrangler rollback
   ```

---

## Stage A — Preparation (you, no Claude)

- [ ] **A1.** Merge the audit PR (`fix/tier-0-audit-2026-09`) into `main`, then merge the `hono-migration-plan` branch too, including this runbook.
- [ ] **A2.** In the Cloudflare dashboard, go to Workers & Pages → Plans and upgrade to **Workers Paid** ($5/month).
- [ ] **A3.** On your machine, run `npx wrangler login` and `npx wrangler whoami`.
- [ ] **A4.** Install Docker Desktop. The comparison script needs a local Postgres.
- [ ] **A5.** *(Optional)* In a terminal `claude` session, run `/mcp` and authorize the Cloudflare connector, so Claude can inspect Hyperdrive and the Worker for you.
- [ ] **A6.** Set this user environment variable once, so subagents run on the cheapest model:

  ```bash
  setx CLAUDE_CODE_SUBAGENT_MODEL haiku
  ```

---

## Stage B — Facts and decisions

### S1 · New session · Sonnet · low

```
<preamble, step = phase0>
Do Phase 0 of the plan. 1) Record how production is hosted today (read Dockerfile, README,
deploy notes; ask me what you can't infer). 2) Give me the exact SQL to run against production
for the counts Phase 0 lists (read-only SELECTs, one script) and the Cloudflare analytics I
should screenshot. 3) When I paste the results, fill section 4 (decisions D1–D13) of the plan
with a recommendation per row and ask me to confirm each one. Commit only the plan edit.
```

✋ **You:**

- [ ] Run the SQL it gives you in the Supabase SQL editor and paste the output back.
- [ ] Paste the Cloudflare analytics numbers (zone → Analytics → Traffic, 30 days, top paths).
- [ ] Answer the D1–D13 questions.
- [ ] Merge the PR.

---

## Stage C — Go / no-go spike

### S2 · New session · Opus 5.5 · high — database

✋ **Before**, you create Hyperdrive yourself, because the command contains the DB password. Use the direct Supabase connection string; S2 tells you if it fails.

```bash
npx wrangler hyperdrive create imamzain-db --connection-string="<DIRECT_URL from .env>" --caching-disabled
```

Note the id it prints.

```
<preamble, step = spike-db>
Do Phase 1 checks 1 and 2 of the plan in a throwaway Worker at worker/spike/. The Hyperdrive
id is <id>. Build the smallest Worker that uses Prisma (engineType "client" + adapter-pg,
client per request) through Hyperdrive and exposes one test route per check: findMany with
translations, $queryRaw with similarity(), BigInt columns, an interactive $transaction, and
an interactive transaction that hits a DB error followed by more queries (prisma/orm#30374).
Deploy it to workers.dev (this deploy is allowed), call each route, and report pass/fail with
evidence. If Hyperdrive can't reach Supabase, try the session pooler (port 5432) and tell me
which connection string to recreate Hyperdrive with. Don't touch src/. We're on the Workers Free plan; report CPU ms per route and flag anything near or over 10 ms.
```

✋ **After:**

- [ ] If it asked you to, recreate Hyperdrive with the connection string it gave you, then say "continue" in the **same session**.
- [ ] Write the results down; you need them for the go/no-go.

### S3 · New session · Opus 5.5 · high — everything else

✋ **Before:**

- [ ] Dashboard → Images: enable Images (the binding needs it).
- [ ] If D1 = Cloudflare Email Service: dashboard → Email → onboard `imamzain.org` as a sending domain and add the DNS records it shows.
- [ ] Pick one test inbox you can read.

```
<preamble, step = spike-rest>
Extend worker/spike/ for Phase 1 checks 3–6: bcryptjs compare at cost 12 (report CPU ms from
logs), Images binding producing 4 WebP widths from a ~20 MB JPEG plus .info(), sending one
email via <D1 choice> to <test inbox>, and latency p50/p95 of a 3-query route with and without
Smart Placement. Deploy to workers.dev only. Finish with a go/no-go table for all six checks
and write it into the plan under Phase 1.
```

✋ **After:**

- [ ] Check the test inbox: did it arrive, and does it show SPF/DKIM "pass"? Tell the session.
- [ ] **Decide go or no-go.** If no-go, stop here; the plan says what the fallback is.
- [ ] Merge the PR, then delete the spike Worker:

  ```bash
  npx wrangler delete --name <spike-name>
  ```

---

## Stage D — Skeleton and safety net

### S4 · New session · Opus 5.5 · high — project + Prisma bump

```
<preamble, step = skeleton>
Do Phase 2 task 1. Two PRs: (a) hono/prisma-bump — bump prisma + @prisma/client to the latest
6.x >= 6.16 for Nest only, full Nest unit + integration suites must pass; (b) hono/skeleton —
create worker/ (package.json, tsconfig, wrangler.jsonc with Hyperdrive <id>, R2, Images and
rate-limit bindings, Smart Placement per D9), the second Prisma generator, make the Nest
build generate only its own client, Vitest, a `worker` CI job. Also create a short CLAUDE.md
at the repo root (<60 lines) pointing to the plan, the runbook and (future) worker/CONVENTIONS.md.
```

✋ **After:**

- [ ] Merge the **Prisma bump first**, then deploy Nest the way you normally do, and check that the site and CMS still work.
- [ ] Then merge the skeleton PR.

### S5 · New session · Opus 5.5 · high — shared code

```
<preamble, step = lib>
Do Phase 2 tasks 2 and 3: everything in worker/src/lib/ the plan lists (db, envelope, errors,
Zod hook, i18n, pagination, auth middleware, rate limit, audit, CORS, secure headers, ETag,
BigInt, defineRoute) and the fallthrough to the origin with X-Forwarded-For from
CF-Connecting-IP. Mirror the Nest behaviour exactly — read src/common/, src/main.ts,
src/auth/strategies/jwt.strategy.ts for the reference. Unit-test the lib pieces briefly.
Origin URL is <current Nest URL from S1>.
```

✋ **After:**

- [ ] Merge.

### S6 · New session · Opus 5.5 · high — comparison script and contract tests

✋ **Before:**

- [ ] Make a prod dump **outside the repo**, then give the file path in the prompt:

  ```bash
  pg_dump "<DIRECT_URL>" -Fc -f C:\dumps\imamzain.dump
  ```

```
<preamble, step = harness>
Do Phase 2 tasks 4 and 5: the diff harness (Docker Postgres 16, restore <dump path>, scrub.sql
for PII, template DB, corpus generator, replay against Nest and wrangler dev, report per group
with one summary line on the console) and the contract-test scaffold that runs the same suite
against BASE_URL=Nest and BASE_URL=Worker, wired into CI. Add `npm run check:<group>` =
typecheck + contract tests (both targets) + diff for that group, terse output. Prove it on
/health.
```

✋ **After:**

- [ ] Run it yourself once so you've seen it work:

  ```bash
  cd worker && npm run check:health
  ```

- [ ] Merge.

### S7 · New session · Sonnet · medium — pass-through goes live

```
<preamble, step = passthrough>
Do Phase 2 task 6: prepare the pass-through production deploy (zero ported groups, route
api.imamzain.org/*). Give me the exact `wrangler secret put` list, the route config, and a
verification checklist with the exact commands/SQL. Then walk me through it step by step.
Deploying is allowed in this session once I say "go".
```

✋ **You:**

- [ ] Run each `wrangler secret put` it lists, pasting the values from your `.env` yourself.
- [ ] Say "go".
- [ ] Verify:
  - Log in to the CMS, then check that the newest `audit_logs` row has **your** IP.
  - Open the website.
  - Submit a test form, then delete the submission.
- [ ] Watch `wrangler tail` for a day. If anything looks odd, run `npx wrangler rollback`.

---

## Stage E — Pilot and conventions

### S8 · New session · Opus 5.5 · high — pilot

```
<preamble, step = post-categories>
Do Phase 3: port post-categories end to end (translatable-category factory included), contract
tests green on Nest then Worker, diff clean, add it to the ported-group table.
```

✋ **After:** go straight on to S9 in the same session.

### S9 · Same session — conventions

```
Now write worker/CONVENTIONS.md (≤150 lines) from what we just did, exactly as the plan's
Phase 3 describes, and add it to the same PR.
```

✋ **After:**

- [ ] Read `CONVENTIONS.md` yourself; it's the rulebook for everything after this.
- [ ] Merge, then do the standard deploy. **Wait 48 hours** before S10.

---

## Stage F — Porting, one group per session

Use the **routine prompt** for every session in this stage unless a row says "sensitive":

```
<preamble, step = <group>>
Port <group>: src/<group>/ → worker/src/features/<group>/ following worker/CONVENTIONS.md.
Use worker/src/features/post-categories/ as the only reference; don't read other features.
Write worker/test/contract/<group>.test.ts, pass on Nest first, then the Worker. Run
`npm run check:<group>` until green; every remaining diff gets an explanation in
worker/test/diff/reports/<group>.md. Fix any open audit finding for this group as an
intentional diff with a worker-only test. If a Nest rule is unclear, stop and ask.
```

For **sensitive** rows, add this to the end:

```
Before porting, list every business rule in src/<group>/ and write a scenario test for each
against Nest. Port those rules line by line; simplify only the infrastructure.
```

✋ **After every session:**

- [ ] Read the summary and `reports/<group>.md`.
- [ ] Merge, then do the standard deploy.
- [ ] Check the logs the next day.
- [ ] If it failed the same group twice on Sonnet, rerun that group on Opus 5.5 · high.

| # | Session | Model · effort | `<group>` | Prompt | Extra ✋ |
| --- | --- | --- | --- | --- | --- |
| S10 | new | Sonnet · low | book-categories, gallery-categories, academic-paper-categories | routine | — |
| S11 | new | Sonnet · medium | languages, speakers, stores, settings | routine | — |
| S12 | new | Sonnet · medium | static-pages | routine | — |
| S13 | new | Sonnet · medium | gallery | routine | — |
| S14 | new | Sonnet · medium | audios | routine | — |
| S15 | new | Sonnet · medium | academic-papers | routine | — |
| S16 | new | Sonnet · high | books | routine | check a multi-part book in the CMS |
| S17 | new | Sonnet · high | posts | routine | schedule a test post a few minutes ahead; Nest's cron still publishes it (crons move in S28) |
| S18 | new | Sonnet · high | daily-hadiths | sensitive | check today's hadith on the site after midnight Baghdad time |
| S19 | new | Sonnet · medium | feeds, search, youtube (reads only) | routine | open `/sitemap.xml` and the RSS feed; search one Arabic word |
| S20 | new | Sonnet · low | dashboard, audit-logs, health | routine | — |
| S21 | new | Opus 5.5 · high | roles, users | sensitive | create a test user, change a role, delete the user |
| S22 | new | Opus 5.5 · high | auth | sensitive | log in / refresh / log out in two tabs; change your password |
| S23 | new | Opus 5.5 · high | forms (+ WhatsApp) | sensitive | submit one real test form; **don't** mark a proxy visit COMPLETED (it sends a real WhatsApp) |
| S24 | new | Opus 5.5 · high | contest | sensitive | **only while the contest is closed**; verify it still reports closed |
| S25 | new | Opus 5.5 · high | media | sensitive | upload an image in the CMS, wait for the variants, delete a test image |
| S26 | new | Sonnet · medium | newsletter | routine | subscribe a test email, confirm, unsubscribe |
| S27 | new | per D2: Opus 5.5 · high if the sender is kept, else skip | campaigns | sensitive | send a campaign to a one-address test list |

**When the diff has something Claude can't explain:** if the conversation is still short, say this in the **same session**. Otherwise start a **new session** (Sonnet · medium) with it.

```
<preamble, step = <group>-triage>
Read worker/test/diff/reports/<group>.md. For each unexplained diff, find the cause by
comparing src/<group>/ with worker/src/features/<group>/, fix the Worker (Nest is the
reference unless it's a known Nest bug), rerun `npm run check:<group>`.
```

If Sonnet can't explain it, switch that one to Opus 5.5 · high.

---

## Stage G — Background jobs

### S28 · New session · Opus 5.5 · medium

```
<preamble, step = jobs>
Do Phase 5: port the cron jobs to worker/src/jobs/ with the schedules in the plan's table (no
advisory locks; keep the row leases). Include a runbook in the PR description for the
cutover order. Don't enable the Cron Triggers in wrangler.jsonc yet — put them behind a
commented block I uncomment at cutover.
```

✋ **Cutover:**

1. Set `DISABLE_CRON=true` on the Nest host and redeploy Nest.
2. Wait 5 minutes and check that no new cron activity appears in Nest's logs.
3. Uncomment the Cron Triggers and do the standard deploy.
4. Within 10 minutes, check that `wrangler tail` shows the ticks.
5. Schedule a test post two minutes ahead and watch it publish.

---

## Stage H — Switch Nest off

### S29 · New session · Sonnet · low — 7 days after the last group

✋ **Before:**

- [ ] Check that Workers Logs show **zero fallthrough requests** for 7 days. S5 logs each fallthrough as `fallthrough`; search for it.

```
<preamble, step = cutover>
Do Phase 6 code changes: remove the fallthrough, delete src/, Nest dependencies, Jest config,
the Dockerfile and unused env vars from .env.example, move worker/ to the repo root if the
plan says so, and make CI run only the Worker. Measure and report source lines and test
lines vs the Phase 0 baseline.
```

✋ **After:**

- [ ] Merge, then do the standard deploy.
- [ ] Shut down the Nest host.
- [ ] Remove its secrets and domain mapping.

### S30 · Same session (or new, Sonnet · low) — docs

```
Update docs/integration.md, the README deploy section and add a "What changed" section to
docs/CMS-INTEGRATION-NOTES.md. Then mark the plan as done.
```

✋ **After:**

- [ ] Merge.

**Optional, later:** a new session on Opus 5.5 · high that decides on D1 (the database) using the latency numbers, as discussed.

---

## Quick reference

| Situation | Do this |
| --- | --- |
| A session is getting long (context meter past ~half) | Ask it to write a handoff note into the PR description, then continue in a new session with that note |
| Sonnet fails a group twice | Redo the group on Opus 5.5 · high |
| Production error after a deploy | `npx wrangler rollback`, then open a triage session |
| A bug in Nest found mid-migration | Group already ported: fix it in the Worker only. Group not ported yet: fix it in Nest; the port picks it up |
| Want to see what you've used | `/usage` |
