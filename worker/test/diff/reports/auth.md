# Diff report: auth

Nest (DB copy A) vs the Worker (DB copy B; unported routes fall through to a Nest on B), on the scrubbed prod dump of 2026-10-04.
Regenerate with `npm run diff -- auth` in `worker/`.

- Requests: 14 (1 write scenario)
- Same: 12
- Diffs: 4, unexplained: 0
- Routes skipped: 0

## Requests

| Request | A | B | Result |
|---|---|---|---|
| `GET /api/v1/auth/me [ar anon]` | 401 | 401 | same |
| `GET /api/v1/auth/me [ar admin]` | 200 | 200 | same |
| `GET /api/v1/auth/me [en anon]` | 401 | 401 | same |
| `GET /api/v1/auth/me [en admin]` | 200 | 200 | same |
| `GET /api/v1/auth/me [- anon]` | 401 | 401 | same |
| `GET /api/v1/auth/me [- admin]` | 200 | 200 | same |
| `scenario sign-in #1 POST /api/v1/users [- admin]` | 201 | 201 | same |
| `scenario sign-in #2 POST /api/v1/auth/login [- anon]` | 200 | 200 | 2 diffs |
| `scenario sign-in #3 POST /api/v1/auth/login [- anon]` | 401 | 401 | same |
| `scenario sign-in #4 POST /api/v1/auth/login [- anon]` | 401 | 401 | same |
| `scenario sign-in #5 POST /api/v1/auth/login [- anon]` | 400 | 400 | same |
| `scenario sign-in #6 POST /api/v1/auth/refresh [- anon]` | 200 | 200 | 2 diffs |
| `scenario sign-in #7 POST /api/v1/auth/refresh [- anon]` | 401 | 401 | same |
| `scenario sign-in #8 POST /api/v1/auth/logout [- anon]` | 401 | 401 | same |

## Diffs

| Key | A | B | Explained |
|---|---|---|---|
| `scenario sign-in #2 POST /api/v1/auth/login [- anon] $.data.accessToken` | `"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI5OGE4NjQ0Ni1iNmZlLTQ4MDItOGQ3Ny1hYTdkYTU2MTdkZjIiLCJ1c2VybmFtZSI6ImR...` | `"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJjOGZiZjJiZi0yYmNhLTRkZjQtOTdhOC1jOTQzNTE4MGVlZTkiLCJ1c2VybmFtZSI6ImR...` | yes |
| `scenario sign-in #2 POST /api/v1/auth/login [- anon] $.data.refresh_token` | `"181450260131d4f4defcf3fba25f45ea940e09bcfa38c9e98e3f4dcea8d4d0873a37dfe1df0fe31f"` | `"094ef5e689eb130612fde5dd7201d48660a9a05547c78066ecb21e9ed76e991c93ca04f3aa7438d5"` | yes |
| `scenario sign-in #6 POST /api/v1/auth/refresh [- anon] $.data.accessToken` | `"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI5OGE4NjQ0Ni1iNmZlLTQ4MDItOGQ3Ny1hYTdkYTU2MTdkZjIiLCJ1c2VybmFtZSI6ImR...` | `"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJjOGZiZjJiZi0yYmNhLTRkZjQtOTdhOC1jOTQzNTE4MGVlZTkiLCJ1c2VybmFtZSI6ImR...` | yes |
| `scenario sign-in #6 POST /api/v1/auth/refresh [- anon] $.data.refresh_token` | `"c3453ebb9c74b84ff96773596241c073b29d27df04a286cb46cea980cc996f1679bd5a040e2a1688"` | `"e286e5324185d4700b20c0aca5a9852558fc07fa213f6f96e0b4ac7a9439dc3ed4cc60219a75dbd7"` | yes |

## Explanations

<!-- Everything above this heading is regenerated on every run; everything from it down is kept.
One bullet per explained diff: a backticked key, `*` matching anything, then why. Example:
- `GET /api/v1/posts* [*] $.data[*].views`: views are counted by the RL_VIEW binding now (D7).
-->
- `scenario sign-in * $.data.accessToken`: a JWT carrying the user's id and `iat`, both different on each side; the claims and their order are checked by `contract/auth.test.ts` on both targets.
- `scenario sign-in * $.data.refresh_token`: 40 random bytes per issue.

Intentional fix (not visible in a sequential replay, covered by the `worker-only` test in `contract/auth.test.ts`): each login runs in one transaction serialized per username key (`pg_advisory_xact_lock`), so the lock check, the bcrypt compare and the failure count can't interleave and a concurrent burst gets exactly 5 guesses before the lock (REHAUL-FINDINGS-2026-09, `auth.service.ts:166`). Side effect: if `login_attempts` can't be read or written, the login fails instead of skipping the lockout as Nest does.
