# Diff report: languages

Nest (DB copy A) vs the Worker (DB copy B; unported routes fall through to a Nest on B), on the scrubbed prod dump of 2026-10-04.
Regenerate with `npm run diff -- languages` in `worker/`.

- Requests: 23 (1 write scenario)
- Same: 23
- Diffs: 0, unexplained: 0
- Routes skipped: 0

## Requests

| Request | A | B | Result |
|---|---|---|---|
| `GET /api/v1/languages [ar anon]` | 200 | 200 | same |
| `GET /api/v1/languages [ar admin]` | 200 | 200 | same |
| `GET /api/v1/languages [en anon]` | 200 | 200 | same |
| `GET /api/v1/languages [en admin]` | 200 | 200 | same |
| `GET /api/v1/languages [- anon]` | 200 | 200 | same |
| `GET /api/v1/languages [- admin]` | 200 | 200 | same |
| `GET /api/v1/languages/all [ar anon]` | 401 | 401 | same |
| `GET /api/v1/languages/all [ar admin]` | 200 | 200 | same |
| `GET /api/v1/languages/all [en anon]` | 401 | 401 | same |
| `GET /api/v1/languages/all [en admin]` | 200 | 200 | same |
| `GET /api/v1/languages/all [- anon]` | 401 | 401 | same |
| `GET /api/v1/languages/all [- admin]` | 200 | 200 | same |
| `scenario lifecycle #1 POST /api/v1/languages [- admin]` | 201 | 201 | same |
| `scenario lifecycle #2 POST /api/v1/languages [- admin]` | 409 | 409 | same |
| `scenario lifecycle #3 GET /api/v1/languages/all [- admin]` | 200 | 200 | same |
| `scenario lifecycle #4 PATCH /api/v1/languages/qj [- admin]` | 200 | 200 | same |
| `scenario lifecycle #5 GET /api/v1/languages [- anon]` | 200 | 200 | same |
| `scenario lifecycle #6 POST /api/v1/languages [- admin]` | 400 | 400 | same |
| `scenario lifecycle #7 DELETE /api/v1/languages/qj [- admin]` | 200 | 200 | same |
| `scenario lifecycle #8 DELETE /api/v1/languages/qj [- admin]` | 404 | 404 | same |
| `scenario lifecycle #9 PATCH /api/v1/languages/qj [- admin]` | 404 | 404 | same |
| `scenario lifecycle #10 POST /api/v1/languages [- admin]` | 201 | 201 | same |
| `scenario lifecycle #11 GET /api/v1/languages/all [- admin]` | 200 | 200 | same |

## Explanations

<!-- Everything above this heading is regenerated on every run; everything from it down is kept.
One bullet per explained diff: a backticked key, `*` matching anything, then why. Example:
- `GET /api/v1/posts* [*] $.data[*].views`: views are counted by the RL_VIEW binding now (D7).
-->
