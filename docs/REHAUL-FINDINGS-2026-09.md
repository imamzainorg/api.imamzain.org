# Rehaul findings — September 2026 audit (Tier 0–3)

An independent review of the entire Tier 0–3 diff (commit `a2cbff3` on
`fix/tier-0-audit-2026-09`), run after all four tiers landed, per the
"see if we messed up anywhere" ask that framed this whole round. 8 domain
sweeps produced 86 raw findings; the 47 correctness-class ones were each
independently re-verified against the current code by a second reviewer,
refute-first. 44 confirmed, 1 rejected as harmless in practice, 1 downgraded
(real defect, but a global exception filter already prevents the specific
failure mode first suspected).

Three were high severity and are **already fixed** in `a2cbff3` itself (see
below). The rest are catalogued here for follow-up — none were judged urgent
enough to hold up the push, but none should be forgotten either.

## Fixed (in this same commit)

### 1. `daily-hadiths.service.ts:488` — public hadith list could 500 for every visitor
This round's active-language filtering made a translation lookup capable of
returning nothing, but one call site (`toPublicItem`) still asserted it
always would. **Reproducible:** an admin creates a hadith with a single
translation, later deactivates that language — every request to
`GET /daily-hadiths` then 500s, indefinitely, until someone notices and
fixes the data by hand. Fixed with a null guard (mirroring the sibling
`formatPick`'s existing one) and a tightened query that excludes such rows
up front.

### 2. `media.service.ts:396` — deleting media could destroy files a live post still uses
An earlier fix in this same round reordered `delete()` to remove storage
before the database row, specifically to avoid orphaning files if the row
delete failed. That reordering opened a worse race: a reference added
between the pre-check and the storage deletion is still caught by the final
transactional recheck (the row survives, 409), but the files are already
irreversibly gone by then — leaving a live post/book pointing at a 404.
Fixed by making the database delete authoritative first (inside the
transactional recheck) and storage cleanup best-effort afterward; a storage
failure now only orphans a blob (logged for follow-up) instead of breaking
a live reference. This removes the `502 STORAGE_DELETE_FAILED` response
entirely — a delete either 409s for a real reference or fully succeeds.

### 3. `users.service.ts:316` — restoring a user bypassed the privilege-envelope check
`update`, `adminResetPassword` and `softDelete` are all gated by the Tier 0
privilege-envelope check (an actor can't act on an account with more
permissions than their own); `restore()` never was, at either the service
or controller layer. **Impact:** an actor holding only `users:delete` could
soft-delete a super-admin account (already blocked from resetting or
renaming it directly) and then simply restore it, fully reversing the
protection. Fixed: `restore()` now takes the full actor payload and runs
the same envelope check before restoring.

### Two smaller tooling fixes
- `.prettierrc.json`'s `endOfLine` was set to `"crlf"` based on the local
  Windows working tree; the actual committed git blobs are LF
  (`core.autocrlf=true`, no `.gitattributes`) — verified with `git show`.
  Changed to `"lf"` so `npm run format`/`format:check` don't rewrite every
  file's line endings on a fresh Linux clone or in CI.
- `eslint.config.js`'s `sourceType` was `"commonjs"` for `src/**/*.ts`,
  which is pure ESM `import`/`export` syntax. Changed to `"module"`.

## Not fixed — for follow-up

### Pre-existing, not introduced by this round
- **`books.service.ts:578` / `posts.service.ts` — a partial translation PATCH silently nulls omitted fields.**
  The `book_translations`/`post_translations` upsert writes every optional
  field as `field ?? null`, so supplying only some fields in a translation
  update erases the rest. Example: PATCHing
  `{translations:[{lang:'ar', title:'fixed typo', is_default:true}]}` to fix
  a typo silently wipes that translation's author, publisher, description
  and `og_image_id`. Confirmed via `git diff` to predate this whole audit
  round — real, but not something this work broke. **Severity: high.**

### Security / privacy
- **`email.service.ts:223`** — the "never log the recipient" error path logs
  the raw SMTP error message, which routinely embeds the address in real
  bounce text (e.g. `550 5.1.1 <visitor@example.com>: ...`).
- **`email.service.ts:214`** — custom email headers aren't checked for CRLF
  injection the way `subject`/`replyTo` already are (not currently
  exploitable via the one real caller, which uses a validated address).
- **`auth.service.ts:347`** — refresh-token-family revocation on reuse
  doesn't bump `token_version`, so a stolen access token stays valid up to
  `JWT_EXPIRES_IN` (24h default) after the theft is detected and logged.
  *This matches an explicit, already-documented Tier 2 tradeoff and is
  correctly implemented as decided — noted here for completeness, not as a
  new gap.*

### Timing / race conditions
- **`auth.service.ts:166`** — the per-username login lockout check and the
  failure-counter write are separate round trips split by a `bcrypt.compare`
  call; a burst of concurrent attempts against one username can spend more
  than the intended 5 guesses before lockout engages.
- **`roles.service.ts:128` / `users.service.ts:145`** — case-insensitive
  name uniqueness (`Admin` vs `admin`) is a bare `findFirst` before the
  write, with no lock, transaction, or matching database constraint (both
  columns are plain case-sensitive `@unique`). Two concurrent requests can
  still both succeed.
- **`newsletter.service.ts:172`** — the global hourly confirmation-email cap
  is a count-then-claim pair, not atomic across concurrent requests for
  different addresses; a burst of sign-ups can overshoot it.
- **`newsletter.service.ts:192`** — a confirmation send claims its row
  synchronously then emails in the background; an ungraceful process exit
  (not a normal shutdown, which is covered) between the two can strand the
  claim with no email actually sent, blocking a resend for 15 minutes.
- **`form-notifications.service.ts:116`** — the retry cool-down after a
  failed send is held in process memory, but the cron's mutual exclusion is
  a per-tick lock any replica can win; under horizontal scaling a different
  replica can retry before the intended cool-down elapses.

### Data correctness
- **`campaigns.service.ts:477`** — `renderBody()` passes the raw subscriber
  email as a `String.replace()` replacement argument, which gives `$&`/`$1`
  special meaning; an address containing a literal `$` (valid per RFC 5322)
  corrupts the rendered template.
- **`email.service.ts:167`** — the campaign SMTP lane's `secure` (TLS) flag
  wrongly inherits the shared `SMTP_SECURE` value when only
  `CAMPAIGN_SMTP_HOST`/`PORT` are overridden per-lane.
- **`forms.service.ts:107` / `:253`** — the optimistic-concurrency guard on
  proxy-visit and contact PATCHes always compares against `status`, even for
  a notes-only edit; a concurrent status change on the same record can
  reject an unrelated notes edit with a spurious 409.
- **`books.service.ts:405` / `:532`** — a book can be created with
  series-position fields (`part_number`/`parts`) without actually having a
  parent, and disconnecting a part from its series (`parent_id: null`)
  doesn't clear those now-stale fields.
- **`media.service.ts:163`** — the sniffed real format of an uploaded image
  is computed but never compared against the `Content-Type` that actually
  gets persisted as `mime_type`, so a mismatched declaration can be stored.
- **`image-variant.service.ts:313`** — if the database write for a
  sanitized image's `file_size` fails, the API response still reports the
  new size as if it had been saved.
- **`media.service.ts:162`** — a degenerate upload (e.g. 0 bytes) can throw
  an unhandled error during format-sniffing, surfacing as a generic 500
  instead of the clean 400 every other upload-validation failure produces.
- **`campaigns.service.ts:890`** — a campaign's `last_error` can go stale:
  if a campaign paused earlier by an outage later fails for an unrelated
  reason (every recipient permanently rejected), the old error message is
  never refreshed.
- **`audios.service.ts:98`** — `shapeAudio`/`shapeSpeaker` never got the
  `includeInactive` option this same round added to `gallery.service.ts`'s
  identical pattern, so an audio/speaker whose only translation is in a
  retired language renders `translation: null` in the CMS admin view.
- **`feeds/homepage.service.ts:96`** — unlike the equivalent `/search` fix
  added in this same diff, the homepage mappers keep an item with
  `title`/`name: null` instead of dropping it once its only translation's
  language is retired.
- **`newsletter.service.ts:325`** — an admin listing `is_active=false`
  subscribers can't distinguish "never confirmed" sign-ups from genuine
  unsubscribes; both share that flag with no other filter available.

### Minor / low priority
- **`form-notifications.service.ts:54`** — the digest's "and N more"
  overflow count is derived from an already-200-row-capped query, so a
  larger real backlog is undercounted.
- **`config/env.validation.ts:317` / `:310`** — `THROTTLE_GLOBAL_LIMIT` and
  `TRUST_PROXY_HOPS` are missing the `@BlankIsUnset()` decorator their
  sibling fields got, so a blank value validates to `0` instead of unset.
  Currently latent: both are read straight from `process.env` by dedicated
  resolvers that already handle blank correctly.
- **`youtube-sync.service.ts:481`** — `pruneVanishedPlaylists` is missing
  the `orderBy` its sibling `pruneVanishedVideos` has, so once the playlist
  backlog exceeds the per-sync check limit it won't rotate through the
  whole backlog the way videos do.
- **`image-variant.service.ts:227`** — the media backfill script's calling
  convention never supplies `width`/`height`, so its "only patch if
  different" optimization never triggers and every row gets a redundant
  (value-correct) update.
- **`common/validators/iso-instant-offset.validator.ts:20`** — a leap-day
  check delegates to `Date.UTC`, which applies JavaScript's legacy
  two-digit-year remapping; this only misclassifies the literal year
  `0000`, practically irrelevant for real publish dates.
- **`common/filters/all-exceptions.filter.ts:58`** — the client-error
  classifier accepts any plain object with a numeric 4xx status, broader
  than its own docstring claims. No call site in this codebase currently
  triggers a false positive.
- **`daily-hadiths.service.ts:329`** — `restore()`'s conflict handling was
  narrowed to only convert a specific unique-constraint violation into a
  friendly 409; anything else now rethrows raw. The global exception filter
  already catches any raw unique-constraint violation into a generic 409
  today, so this is a message-quality issue, not an outage risk.

## Method

Findings were produced by parallel domain-scoped review agents (forms &
email, media/gallery/audio/storage, users/roles/misc, auth & security,
common infra, newsletter, prisma/schema/seed/config tooling, content
modules) and then independently re-verified — each verifier tried to
*refute* the finding first, re-reading the current code and tracing the
actual call path, before confirming. Verdicts:

- **CONFIRMED** — reproduced or fully traced against the current code.
- **PLAUSIBLE** — the underlying defect is real, but the specific failure
  mode first suspected doesn't reach production today (something else
  already guards against it).
- Findings the verifier could not reproduce, or found already-handled
  elsewhere, were dropped (one such case, on `unique-conflict.util.ts`).
