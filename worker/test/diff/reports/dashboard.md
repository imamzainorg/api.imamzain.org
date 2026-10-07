# Diff report: dashboard

Nest (DB copy A) vs the Worker (DB copy B; unported routes fall through to a Nest on B), on the scrubbed prod dump of 2026-10-04.
Regenerate with `npm run diff -- dashboard` in `worker/`.

- Requests: 6 (0 write scenarios)
- Same: 6
- Diffs: 0, unexplained: 0
- Routes skipped: 0

## Requests

| Request | A | B | Result |
|---|---|---|---|
| `GET /api/v1/dashboard/stats [ar anon]` | 401 | 401 | same |
| `GET /api/v1/dashboard/stats [ar admin]` | 200 | 200 | same |
| `GET /api/v1/dashboard/stats [en anon]` | 401 | 401 | same |
| `GET /api/v1/dashboard/stats [en admin]` | 200 | 200 | same |
| `GET /api/v1/dashboard/stats [- anon]` | 401 | 401 | same |
| `GET /api/v1/dashboard/stats [- admin]` | 200 | 200 | same |

## Explanations

<!-- Everything above this heading is regenerated on every run; everything from it down is kept.
One bullet per explained diff: a backticked key, `*` matching anything, then why. Example:
- `GET /api/v1/posts* [*] $.data[*].views`: views are counted by the RL_VIEW binding now (D7).
-->
