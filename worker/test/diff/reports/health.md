# Diff report: health

Nest (DB copy A) vs the Worker (DB copy B; unported routes fall through to a Nest on B), on the scrubbed prod dump of 2026-10-04.
Regenerate with `npm run diff -- health` in `worker/`.

- Requests: 6 (0 write scenarios)
- Same: 6
- Diffs: 0, unexplained: 0
- Routes skipped: 0

## Requests

| Request | A | B | Result |
|---|---|---|---|
| `GET /api/v1/health [ar anon]` | 200 | 200 | same |
| `GET /api/v1/health [ar admin]` | 200 | 200 | same |
| `GET /api/v1/health [en anon]` | 200 | 200 | same |
| `GET /api/v1/health [en admin]` | 200 | 200 | same |
| `GET /api/v1/health [- anon]` | 200 | 200 | same |
| `GET /api/v1/health [- admin]` | 200 | 200 | same |

## Explanations

<!-- Everything above this heading is regenerated on every run; everything from it down is kept.
One bullet per explained diff: a backticked key, `*` matching anything, then why. Example:
- `GET /api/v1/posts* [*] $.data[*].views`: views are counted by the RL_VIEW binding now (D7).
-->
