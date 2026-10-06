# Diff report: post-categories

Nest (DB copy A) vs the Worker (DB copy B; unported routes fall through to a Nest on B), on the scrubbed prod dump of 2026-10-04.
Regenerate with `npm run diff -- post-categories` in `worker/`.

- Requests: 45 (1 write scenario)
- Same: 45
- Diffs: 0, unexplained: 0
- Routes skipped: 0

## Requests

| Request | A | B | Result |
|---|---|---|---|
| `GET /api/v1/post-categories [ar anon]` | 200 | 200 | same |
| `GET /api/v1/post-categories [ar admin]` | 200 | 200 | same |
| `GET /api/v1/post-categories [en anon]` | 200 | 200 | same |
| `GET /api/v1/post-categories [en admin]` | 200 | 200 | same |
| `GET /api/v1/post-categories [- anon]` | 200 | 200 | same |
| `GET /api/v1/post-categories [- admin]` | 200 | 200 | same |
| `GET /api/v1/post-categories?page=2&limit=5 [- anon]` | 200 | 200 | same |
| `GET /api/v1/post-categories?page=2&limit=5 [- admin]` | 200 | 200 | same |
| `GET /api/v1/post-categories/042f4ab9-ef46-45eb-805b-a4543836e730 [ar anon]` | 200 | 200 | same |
| `GET /api/v1/post-categories/042f4ab9-ef46-45eb-805b-a4543836e730 [ar admin]` | 200 | 200 | same |
| `GET /api/v1/post-categories/042f4ab9-ef46-45eb-805b-a4543836e730 [en anon]` | 200 | 200 | same |
| `GET /api/v1/post-categories/042f4ab9-ef46-45eb-805b-a4543836e730 [en admin]` | 200 | 200 | same |
| `GET /api/v1/post-categories/042f4ab9-ef46-45eb-805b-a4543836e730 [- anon]` | 200 | 200 | same |
| `GET /api/v1/post-categories/042f4ab9-ef46-45eb-805b-a4543836e730 [- admin]` | 200 | 200 | same |
| `GET /api/v1/post-categories/5d3b0b74-f8c3-40cb-9ee0-cab9f30d625f [ar anon]` | 200 | 200 | same |
| `GET /api/v1/post-categories/5d3b0b74-f8c3-40cb-9ee0-cab9f30d625f [ar admin]` | 200 | 200 | same |
| `GET /api/v1/post-categories/5d3b0b74-f8c3-40cb-9ee0-cab9f30d625f [en anon]` | 200 | 200 | same |
| `GET /api/v1/post-categories/5d3b0b74-f8c3-40cb-9ee0-cab9f30d625f [en admin]` | 200 | 200 | same |
| `GET /api/v1/post-categories/5d3b0b74-f8c3-40cb-9ee0-cab9f30d625f [- anon]` | 200 | 200 | same |
| `GET /api/v1/post-categories/5d3b0b74-f8c3-40cb-9ee0-cab9f30d625f [- admin]` | 200 | 200 | same |
| `GET /api/v1/post-categories/00000000-0000-4000-8000-000000000000 [ar anon]` | 404 | 404 | same |
| `GET /api/v1/post-categories/00000000-0000-4000-8000-000000000000 [ar admin]` | 404 | 404 | same |
| `GET /api/v1/post-categories/00000000-0000-4000-8000-000000000000 [en anon]` | 404 | 404 | same |
| `GET /api/v1/post-categories/00000000-0000-4000-8000-000000000000 [en admin]` | 404 | 404 | same |
| `GET /api/v1/post-categories/00000000-0000-4000-8000-000000000000 [- anon]` | 404 | 404 | same |
| `GET /api/v1/post-categories/00000000-0000-4000-8000-000000000000 [- admin]` | 404 | 404 | same |
| `GET /api/v1/post-categories/trash [ar anon]` | 401 | 401 | same |
| `GET /api/v1/post-categories/trash [ar admin]` | 200 | 200 | same |
| `GET /api/v1/post-categories/trash [en anon]` | 401 | 401 | same |
| `GET /api/v1/post-categories/trash [en admin]` | 200 | 200 | same |
| `GET /api/v1/post-categories/trash [- anon]` | 401 | 401 | same |
| `GET /api/v1/post-categories/trash [- admin]` | 200 | 200 | same |
| `GET /api/v1/post-categories/trash?page=2&limit=5 [- anon]` | 401 | 401 | same |
| `GET /api/v1/post-categories/trash?page=2&limit=5 [- admin]` | 200 | 200 | same |
| `scenario lifecycle #1 POST /api/v1/post-categories [- admin]` | 201 | 201 | same |
| `scenario lifecycle #2 GET /api/v1/post-categories/{{cat}} [en anon]` | 200 | 200 | same |
| `scenario lifecycle #3 PATCH /api/v1/post-categories/{{cat}} [- admin]` | 200 | 200 | same |
| `scenario lifecycle #4 POST /api/v1/post-categories [- admin]` | 409 | 409 | same |
| `scenario lifecycle #5 POST /api/v1/post-categories [- admin]` | 409 | 409 | same |
| `scenario lifecycle #6 DELETE /api/v1/post-categories/{{cat}} [- admin]` | 200 | 200 | same |
| `scenario lifecycle #7 GET /api/v1/post-categories/{{cat}} [- anon]` | 404 | 404 | same |
| `scenario lifecycle #8 GET /api/v1/post-categories/trash?limit=100 [- admin]` | 200 | 200 | same |
| `scenario lifecycle #9 POST /api/v1/post-categories/{{cat}}/restore [- admin]` | 200 | 200 | same |
| `scenario lifecycle #10 GET /api/v1/post-categories/{{cat}} [- anon]` | 200 | 200 | same |
| `scenario lifecycle #11 POST /api/v1/post-categories/{{cat}}/restore [- admin]` | 404 | 404 | same |

## Explanations

<!-- Everything above this heading is regenerated on every run; everything from it down is kept.
One bullet per explained diff: a backticked key, `*` matching anything, then why. Example:
- `GET /api/v1/posts* [*] $.data[*].views`: views are counted by the RL_VIEW binding now (D7).
-->
