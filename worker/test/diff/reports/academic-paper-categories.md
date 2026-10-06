# Diff report: academic-paper-categories

Nest (DB copy A) vs the Worker (DB copy B; unported routes fall through to a Nest on B), on the scrubbed prod dump of 2026-10-04.
Regenerate with `npm run diff -- academic-paper-categories` in `worker/`.

- Requests: 45 (1 write scenario)
- Same: 45
- Diffs: 0, unexplained: 0
- Routes skipped: 0

## Requests

| Request | A | B | Result |
|---|---|---|---|
| `GET /api/v1/academic-paper-categories [ar anon]` | 200 | 200 | same |
| `GET /api/v1/academic-paper-categories [ar admin]` | 200 | 200 | same |
| `GET /api/v1/academic-paper-categories [en anon]` | 200 | 200 | same |
| `GET /api/v1/academic-paper-categories [en admin]` | 200 | 200 | same |
| `GET /api/v1/academic-paper-categories [- anon]` | 200 | 200 | same |
| `GET /api/v1/academic-paper-categories [- admin]` | 200 | 200 | same |
| `GET /api/v1/academic-paper-categories?page=2&limit=5 [- anon]` | 200 | 200 | same |
| `GET /api/v1/academic-paper-categories?page=2&limit=5 [- admin]` | 200 | 200 | same |
| `GET /api/v1/academic-paper-categories/163cab47-9a09-4473-89ea-c07e7a3e7c8d [ar anon]` | 200 | 200 | same |
| `GET /api/v1/academic-paper-categories/163cab47-9a09-4473-89ea-c07e7a3e7c8d [ar admin]` | 200 | 200 | same |
| `GET /api/v1/academic-paper-categories/163cab47-9a09-4473-89ea-c07e7a3e7c8d [en anon]` | 200 | 200 | same |
| `GET /api/v1/academic-paper-categories/163cab47-9a09-4473-89ea-c07e7a3e7c8d [en admin]` | 200 | 200 | same |
| `GET /api/v1/academic-paper-categories/163cab47-9a09-4473-89ea-c07e7a3e7c8d [- anon]` | 200 | 200 | same |
| `GET /api/v1/academic-paper-categories/163cab47-9a09-4473-89ea-c07e7a3e7c8d [- admin]` | 200 | 200 | same |
| `GET /api/v1/academic-paper-categories/63c7b8ff-ea3d-45ac-9b9a-a050c4e19b2b [ar anon]` | 200 | 200 | same |
| `GET /api/v1/academic-paper-categories/63c7b8ff-ea3d-45ac-9b9a-a050c4e19b2b [ar admin]` | 200 | 200 | same |
| `GET /api/v1/academic-paper-categories/63c7b8ff-ea3d-45ac-9b9a-a050c4e19b2b [en anon]` | 200 | 200 | same |
| `GET /api/v1/academic-paper-categories/63c7b8ff-ea3d-45ac-9b9a-a050c4e19b2b [en admin]` | 200 | 200 | same |
| `GET /api/v1/academic-paper-categories/63c7b8ff-ea3d-45ac-9b9a-a050c4e19b2b [- anon]` | 200 | 200 | same |
| `GET /api/v1/academic-paper-categories/63c7b8ff-ea3d-45ac-9b9a-a050c4e19b2b [- admin]` | 200 | 200 | same |
| `GET /api/v1/academic-paper-categories/00000000-0000-4000-8000-000000000000 [ar anon]` | 404 | 404 | same |
| `GET /api/v1/academic-paper-categories/00000000-0000-4000-8000-000000000000 [ar admin]` | 404 | 404 | same |
| `GET /api/v1/academic-paper-categories/00000000-0000-4000-8000-000000000000 [en anon]` | 404 | 404 | same |
| `GET /api/v1/academic-paper-categories/00000000-0000-4000-8000-000000000000 [en admin]` | 404 | 404 | same |
| `GET /api/v1/academic-paper-categories/00000000-0000-4000-8000-000000000000 [- anon]` | 404 | 404 | same |
| `GET /api/v1/academic-paper-categories/00000000-0000-4000-8000-000000000000 [- admin]` | 404 | 404 | same |
| `GET /api/v1/academic-paper-categories/trash [ar anon]` | 401 | 401 | same |
| `GET /api/v1/academic-paper-categories/trash [ar admin]` | 200 | 200 | same |
| `GET /api/v1/academic-paper-categories/trash [en anon]` | 401 | 401 | same |
| `GET /api/v1/academic-paper-categories/trash [en admin]` | 200 | 200 | same |
| `GET /api/v1/academic-paper-categories/trash [- anon]` | 401 | 401 | same |
| `GET /api/v1/academic-paper-categories/trash [- admin]` | 200 | 200 | same |
| `GET /api/v1/academic-paper-categories/trash?page=2&limit=5 [- anon]` | 401 | 401 | same |
| `GET /api/v1/academic-paper-categories/trash?page=2&limit=5 [- admin]` | 200 | 200 | same |
| `scenario lifecycle #1 POST /api/v1/academic-paper-categories [- admin]` | 201 | 201 | same |
| `scenario lifecycle #2 GET /api/v1/academic-paper-categories/{{cat}} [en anon]` | 200 | 200 | same |
| `scenario lifecycle #3 PATCH /api/v1/academic-paper-categories/{{cat}} [- admin]` | 200 | 200 | same |
| `scenario lifecycle #4 POST /api/v1/academic-paper-categories [- admin]` | 409 | 409 | same |
| `scenario lifecycle #5 POST /api/v1/academic-paper-categories [- admin]` | 409 | 409 | same |
| `scenario lifecycle #6 DELETE /api/v1/academic-paper-categories/{{cat}} [- admin]` | 200 | 200 | same |
| `scenario lifecycle #7 GET /api/v1/academic-paper-categories/{{cat}} [- anon]` | 404 | 404 | same |
| `scenario lifecycle #8 GET /api/v1/academic-paper-categories/trash?limit=100 [- admin]` | 200 | 200 | same |
| `scenario lifecycle #9 POST /api/v1/academic-paper-categories/{{cat}}/restore [- admin]` | 200 | 200 | same |
| `scenario lifecycle #10 GET /api/v1/academic-paper-categories/{{cat}} [- anon]` | 200 | 200 | same |
| `scenario lifecycle #11 POST /api/v1/academic-paper-categories/{{cat}}/restore [- admin]` | 404 | 404 | same |

## Explanations

<!-- Everything above this heading is regenerated on every run; everything from it down is kept.
One bullet per explained diff: a backticked key, `*` matching anything, then why. Example:
- `GET /api/v1/posts* [*] $.data[*].views`: views are counted by the RL_VIEW binding now (D7).
-->
