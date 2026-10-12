# Diff report: newsletter

Nest (DB copy A) vs the Worker (DB copy B; unported routes fall through to a Nest on B), on the scrubbed prod dump of 2026-10-04.
Regenerate with `npm run diff -- newsletter` in `worker/`.

- Requests: 33 (2 write scenarios)
- Same: 33
- Diffs: 0, unexplained: 0
- Routes skipped: 0

## Requests

| Request | A | B | Result |
|---|---|---|---|
| `GET /api/v1/newsletter/subscribers [ar anon]` | 401 | 401 | same |
| `GET /api/v1/newsletter/subscribers [ar admin]` | 200 | 200 | same |
| `GET /api/v1/newsletter/subscribers [en anon]` | 401 | 401 | same |
| `GET /api/v1/newsletter/subscribers [en admin]` | 200 | 200 | same |
| `GET /api/v1/newsletter/subscribers [- anon]` | 401 | 401 | same |
| `GET /api/v1/newsletter/subscribers [- admin]` | 200 | 200 | same |
| `GET /api/v1/newsletter/subscribers?page=2&limit=5 [- anon]` | 401 | 401 | same |
| `GET /api/v1/newsletter/subscribers?page=2&limit=5 [- admin]` | 200 | 200 | same |
| `GET /api/v1/newsletter/subscribers/trash [ar anon]` | 401 | 401 | same |
| `GET /api/v1/newsletter/subscribers/trash [ar admin]` | 200 | 200 | same |
| `GET /api/v1/newsletter/subscribers/trash [en anon]` | 401 | 401 | same |
| `GET /api/v1/newsletter/subscribers/trash [en admin]` | 200 | 200 | same |
| `GET /api/v1/newsletter/subscribers/trash [- anon]` | 401 | 401 | same |
| `GET /api/v1/newsletter/subscribers/trash [- admin]` | 200 | 200 | same |
| `GET /api/v1/newsletter/subscribers/trash?page=2&limit=5 [- anon]` | 401 | 401 | same |
| `GET /api/v1/newsletter/subscribers/trash?page=2&limit=5 [- admin]` | 200 | 200 | same |
| `scenario subscriber-lifecycle #1 GET /api/v1/newsletter/subscribers?limit=1 [- admin]` | 200 | 200 | same |
| `scenario subscriber-lifecycle #2 POST /api/v1/newsletter/subscribers/{{s}}/unsubscribe [- admin]` | 200 | 200 | same |
| `scenario subscriber-lifecycle #3 POST /api/v1/newsletter/subscribers/{{s}}/unsubscribe [- admin]` | 200 | 200 | same |
| `scenario subscriber-lifecycle #4 GET /api/v1/newsletter/subscribers?is_active=false&limit=100 [- admin]` | 200 | 200 | same |
| `scenario subscriber-lifecycle #5 POST /api/v1/newsletter/subscribers/{{s}}/resubscribe [- admin]` | 200 | 200 | same |
| `scenario subscriber-lifecycle #6 POST /api/v1/newsletter/subscribers/{{s}}/resubscribe [- admin]` | 200 | 200 | same |
| `scenario subscriber-lifecycle #7 DELETE /api/v1/newsletter/subscribers/{{s}} [- admin]` | 200 | 200 | same |
| `scenario subscriber-lifecycle #8 DELETE /api/v1/newsletter/subscribers/{{s}} [- admin]` | 404 | 404 | same |
| `scenario subscriber-lifecycle #9 POST /api/v1/newsletter/subscribers/{{s}}/unsubscribe [- admin]` | 404 | 404 | same |
| `scenario subscriber-lifecycle #10 GET /api/v1/newsletter/subscribers/trash?limit=100 [- admin]` | 200 | 200 | same |
| `scenario subscriber-lifecycle #11 POST /api/v1/newsletter/subscribers/{{s}}/restore [- admin]` | 200 | 200 | same |
| `scenario subscriber-lifecycle #12 POST /api/v1/newsletter/subscribers/{{s}}/restore [- admin]` | 404 | 404 | same |
| `scenario subscriber-lifecycle #13 GET /api/v1/newsletter/subscribers?limit=100 [- admin]` | 200 | 200 | same |
| `scenario public-tokens #1 POST /api/v1/newsletter/confirm [- anon]` | 401 | 401 | same |
| `scenario public-tokens #2 POST /api/v1/newsletter/confirm [- anon]` | 400 | 400 | same |
| `scenario public-tokens #3 POST /api/v1/newsletter/unsubscribe [- anon]` | 401 | 401 | same |
| `scenario public-tokens #4 POST /api/v1/newsletter/unsubscribe [- anon]` | 400 | 400 | same |

## Explanations

<!-- Everything above this heading is regenerated on every run; everything from it down is kept.
One bullet per explained diff: a backticked key, `*` matching anything, then why. Example:
- `GET /api/v1/posts* [*] $.data[*].views`: views are counted by the RL_VIEW binding now (D7).
-->
