# Diff report: audit-logs

Nest (DB copy A) vs the Worker (DB copy B; unported routes fall through to a Nest on B), on the scrubbed prod dump of 2026-10-04.
Regenerate with `npm run diff -- audit-logs` in `worker/`.

- Requests: 26 (0 write scenarios)
- Same: 26
- Diffs: 0, unexplained: 0
- Routes skipped: 0

## Requests

| Request | A | B | Result |
|---|---|---|---|
| `GET /api/v1/audit-logs [ar anon]` | 401 | 401 | same |
| `GET /api/v1/audit-logs [ar admin]` | 200 | 200 | same |
| `GET /api/v1/audit-logs [en anon]` | 401 | 401 | same |
| `GET /api/v1/audit-logs [en admin]` | 200 | 200 | same |
| `GET /api/v1/audit-logs [- anon]` | 401 | 401 | same |
| `GET /api/v1/audit-logs [- admin]` | 200 | 200 | same |
| `GET /api/v1/audit-logs?page=2&limit=5 [- anon]` | 401 | 401 | same |
| `GET /api/v1/audit-logs?page=2&limit=5 [- admin]` | 200 | 200 | same |
| `GET /api/v1/audit-logs/000c7aaf-50b1-4293-9831-3c359415ac8d [ar anon]` | 401 | 401 | same |
| `GET /api/v1/audit-logs/000c7aaf-50b1-4293-9831-3c359415ac8d [ar admin]` | 200 | 200 | same |
| `GET /api/v1/audit-logs/000c7aaf-50b1-4293-9831-3c359415ac8d [en anon]` | 401 | 401 | same |
| `GET /api/v1/audit-logs/000c7aaf-50b1-4293-9831-3c359415ac8d [en admin]` | 200 | 200 | same |
| `GET /api/v1/audit-logs/000c7aaf-50b1-4293-9831-3c359415ac8d [- anon]` | 401 | 401 | same |
| `GET /api/v1/audit-logs/000c7aaf-50b1-4293-9831-3c359415ac8d [- admin]` | 200 | 200 | same |
| `GET /api/v1/audit-logs/005470c1-820e-46b8-bc94-f89c970b5b96 [ar anon]` | 401 | 401 | same |
| `GET /api/v1/audit-logs/005470c1-820e-46b8-bc94-f89c970b5b96 [ar admin]` | 200 | 200 | same |
| `GET /api/v1/audit-logs/005470c1-820e-46b8-bc94-f89c970b5b96 [en anon]` | 401 | 401 | same |
| `GET /api/v1/audit-logs/005470c1-820e-46b8-bc94-f89c970b5b96 [en admin]` | 200 | 200 | same |
| `GET /api/v1/audit-logs/005470c1-820e-46b8-bc94-f89c970b5b96 [- anon]` | 401 | 401 | same |
| `GET /api/v1/audit-logs/005470c1-820e-46b8-bc94-f89c970b5b96 [- admin]` | 200 | 200 | same |
| `GET /api/v1/audit-logs/00000000-0000-4000-8000-000000000000 [ar anon]` | 401 | 401 | same |
| `GET /api/v1/audit-logs/00000000-0000-4000-8000-000000000000 [ar admin]` | 404 | 404 | same |
| `GET /api/v1/audit-logs/00000000-0000-4000-8000-000000000000 [en anon]` | 401 | 401 | same |
| `GET /api/v1/audit-logs/00000000-0000-4000-8000-000000000000 [en admin]` | 404 | 404 | same |
| `GET /api/v1/audit-logs/00000000-0000-4000-8000-000000000000 [- anon]` | 401 | 401 | same |
| `GET /api/v1/audit-logs/00000000-0000-4000-8000-000000000000 [- admin]` | 404 | 404 | same |

## Explanations

<!-- Everything above this heading is regenerated on every run; everything from it down is kept.
One bullet per explained diff: a backticked key, `*` matching anything, then why. Example:
- `GET /api/v1/posts* [*] $.data[*].views`: views are counted by the RL_VIEW binding now (D7).
-->
