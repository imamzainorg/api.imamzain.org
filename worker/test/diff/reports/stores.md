# Diff report: stores

Nest (DB copy A) vs the Worker (DB copy B; unported routes fall through to a Nest on B), on the scrubbed prod dump of 2026-10-04.
Regenerate with `npm run diff -- stores` in `worker/`.

- Requests: 48 (1 write scenario)
- Same: 48
- Diffs: 0, unexplained: 0
- Routes skipped: 0

## Requests

| Request | A | B | Result |
|---|---|---|---|
| `GET /api/v1/stores [ar anon]` | 200 | 200 | same |
| `GET /api/v1/stores [ar admin]` | 200 | 200 | same |
| `GET /api/v1/stores [en anon]` | 200 | 200 | same |
| `GET /api/v1/stores [en admin]` | 200 | 200 | same |
| `GET /api/v1/stores [- anon]` | 200 | 200 | same |
| `GET /api/v1/stores [- admin]` | 200 | 200 | same |
| `GET /api/v1/stores?page=2&limit=5 [- anon]` | 200 | 200 | same |
| `GET /api/v1/stores?page=2&limit=5 [- admin]` | 200 | 200 | same |
| `GET /api/v1/stores/56245709-580a-4b2f-b72f-962044bac860 [ar anon]` | 200 | 200 | same |
| `GET /api/v1/stores/56245709-580a-4b2f-b72f-962044bac860 [ar admin]` | 200 | 200 | same |
| `GET /api/v1/stores/56245709-580a-4b2f-b72f-962044bac860 [en anon]` | 200 | 200 | same |
| `GET /api/v1/stores/56245709-580a-4b2f-b72f-962044bac860 [en admin]` | 200 | 200 | same |
| `GET /api/v1/stores/56245709-580a-4b2f-b72f-962044bac860 [- anon]` | 200 | 200 | same |
| `GET /api/v1/stores/56245709-580a-4b2f-b72f-962044bac860 [- admin]` | 200 | 200 | same |
| `GET /api/v1/stores/aeb756e6-56a2-477b-8946-733066c8241f [ar anon]` | 200 | 200 | same |
| `GET /api/v1/stores/aeb756e6-56a2-477b-8946-733066c8241f [ar admin]` | 200 | 200 | same |
| `GET /api/v1/stores/aeb756e6-56a2-477b-8946-733066c8241f [en anon]` | 200 | 200 | same |
| `GET /api/v1/stores/aeb756e6-56a2-477b-8946-733066c8241f [en admin]` | 200 | 200 | same |
| `GET /api/v1/stores/aeb756e6-56a2-477b-8946-733066c8241f [- anon]` | 200 | 200 | same |
| `GET /api/v1/stores/aeb756e6-56a2-477b-8946-733066c8241f [- admin]` | 200 | 200 | same |
| `GET /api/v1/stores/00000000-0000-4000-8000-000000000000 [ar anon]` | 404 | 404 | same |
| `GET /api/v1/stores/00000000-0000-4000-8000-000000000000 [ar admin]` | 404 | 404 | same |
| `GET /api/v1/stores/00000000-0000-4000-8000-000000000000 [en anon]` | 404 | 404 | same |
| `GET /api/v1/stores/00000000-0000-4000-8000-000000000000 [en admin]` | 404 | 404 | same |
| `GET /api/v1/stores/00000000-0000-4000-8000-000000000000 [- anon]` | 404 | 404 | same |
| `GET /api/v1/stores/00000000-0000-4000-8000-000000000000 [- admin]` | 404 | 404 | same |
| `GET /api/v1/stores/trash [ar anon]` | 401 | 401 | same |
| `GET /api/v1/stores/trash [ar admin]` | 200 | 200 | same |
| `GET /api/v1/stores/trash [en anon]` | 401 | 401 | same |
| `GET /api/v1/stores/trash [en admin]` | 200 | 200 | same |
| `GET /api/v1/stores/trash [- anon]` | 401 | 401 | same |
| `GET /api/v1/stores/trash [- admin]` | 200 | 200 | same |
| `GET /api/v1/stores/trash?page=2&limit=5 [- anon]` | 401 | 401 | same |
| `GET /api/v1/stores/trash?page=2&limit=5 [- admin]` | 200 | 200 | same |
| `scenario lifecycle #1 POST /api/v1/stores [- admin]` | 201 | 201 | same |
| `scenario lifecycle #2 GET /api/v1/stores/{{store}} [en anon]` | 200 | 200 | same |
| `scenario lifecycle #3 PATCH /api/v1/stores/{{store}} [- admin]` | 200 | 200 | same |
| `scenario lifecycle #4 POST /api/v1/stores/{{store}}/locations [- admin]` | 201 | 201 | same |
| `scenario lifecycle #5 PATCH /api/v1/stores/{{store}}/locations/{{loc}} [- admin]` | 200 | 200 | same |
| `scenario lifecycle #6 DELETE /api/v1/stores/{{store}}/locations/{{loc}} [- admin]` | 200 | 200 | same |
| `scenario lifecycle #7 DELETE /api/v1/stores/{{store}}/locations/{{loc}} [- admin]` | 404 | 404 | same |
| `scenario lifecycle #8 POST /api/v1/stores [- admin]` | 400 | 400 | same |
| `scenario lifecycle #9 DELETE /api/v1/stores/{{store}} [- admin]` | 200 | 200 | same |
| `scenario lifecycle #10 GET /api/v1/stores/{{store}} [- anon]` | 404 | 404 | same |
| `scenario lifecycle #11 GET /api/v1/stores/trash?limit=100 [- admin]` | 200 | 200 | same |
| `scenario lifecycle #12 POST /api/v1/stores/{{store}}/restore [- admin]` | 200 | 200 | same |
| `scenario lifecycle #13 GET /api/v1/stores/{{store}} [- anon]` | 200 | 200 | same |
| `scenario lifecycle #14 POST /api/v1/stores/{{store}}/restore [- admin]` | 404 | 404 | same |

## Explanations

<!-- Everything above this heading is regenerated on every run; everything from it down is kept.
One bullet per explained diff: a backticked key, `*` matching anything, then why. Example:
- `GET /api/v1/posts* [*] $.data[*].views`: views are counted by the RL_VIEW binding now (D7).
-->
