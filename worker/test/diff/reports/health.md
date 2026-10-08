# Diff report: health

Nest (DB copy A) vs the Worker (DB copy B; unported routes fall through to a Nest on B), on the scrubbed prod dump of 2026-10-04.
Regenerate with `npm run diff -- health` in `worker/`.

- Requests: 6 (0 write scenarios)
- Same: 0
- Diffs: 12, unexplained: 0
- Routes skipped: 0

## Requests

| Request | A | B | Result |
|---|---|---|---|
| `GET /api/v1/health [ar anon]` | 200 | 200 | 2 diffs |
| `GET /api/v1/health [ar admin]` | 200 | 200 | 2 diffs |
| `GET /api/v1/health [en anon]` | 200 | 200 | 2 diffs |
| `GET /api/v1/health [en admin]` | 200 | 200 | 2 diffs |
| `GET /api/v1/health [- anon]` | 200 | 200 | 2 diffs |
| `GET /api/v1/health [- admin]` | 200 | 200 | 2 diffs |

## Diffs

| Key | A | B | Explained |
|---|---|---|---|
| `GET /api/v1/health [ar anon] $.status` | `"DEGRADED"` | `"OK"` | yes |
| `GET /api/v1/health [ar anon] $.storage.status` | `"unhealthy"` | `"healthy"` | yes |
| `GET /api/v1/health [ar admin] $.status` | `"DEGRADED"` | `"OK"` | yes |
| `GET /api/v1/health [ar admin] $.storage.status` | `"unhealthy"` | `"healthy"` | yes |
| `GET /api/v1/health [en anon] $.status` | `"DEGRADED"` | `"OK"` | yes |
| `GET /api/v1/health [en anon] $.storage.status` | `"unhealthy"` | `"healthy"` | yes |
| `GET /api/v1/health [en admin] $.status` | `"DEGRADED"` | `"OK"` | yes |
| `GET /api/v1/health [en admin] $.storage.status` | `"unhealthy"` | `"healthy"` | yes |
| `GET /api/v1/health [- anon] $.status` | `"DEGRADED"` | `"OK"` | yes |
| `GET /api/v1/health [- anon] $.storage.status` | `"unhealthy"` | `"healthy"` | yes |
| `GET /api/v1/health [- admin] $.status` | `"DEGRADED"` | `"OK"` | yes |
| `GET /api/v1/health [- admin] $.storage.status` | `"unhealthy"` | `"healthy"` | yes |

## Explanations

<!-- Everything above this heading is regenerated on every run; everything from it down is kept.
One bullet per explained diff: a backticked key, `*` matching anything, then why. Example:
- `GET /api/v1/posts* [*] $.data[*].views`: views are counted by the RL_VIEW binding now (D7).
-->
- `GET /api/v1/health [*] $.storage.status`: the harness Nest has no R2 credentials, so its storage probe fails; the Worker's local R2 binding answers. Production has both, so both read healthy there.
- `GET /api/v1/health [*] $.status`: follows `storage.status` (DEGRADED on Nest only because of the line above).
