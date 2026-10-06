# Diff report: gallery-categories

Nest (DB copy A) vs the Worker (DB copy B; unported routes fall through to a Nest on B), on the scrubbed prod dump of 2026-10-04.
Regenerate with `npm run diff -- gallery-categories` in `worker/`.

- Requests: 45 (1 write scenario)
- Same: 45
- Diffs: 0, unexplained: 0
- Routes skipped: 0

## Requests

| Request | A | B | Result |
|---|---|---|---|
| `GET /api/v1/gallery-categories [ar anon]` | 200 | 200 | same |
| `GET /api/v1/gallery-categories [ar admin]` | 200 | 200 | same |
| `GET /api/v1/gallery-categories [en anon]` | 200 | 200 | same |
| `GET /api/v1/gallery-categories [en admin]` | 200 | 200 | same |
| `GET /api/v1/gallery-categories [- anon]` | 200 | 200 | same |
| `GET /api/v1/gallery-categories [- admin]` | 200 | 200 | same |
| `GET /api/v1/gallery-categories?page=2&limit=5 [- anon]` | 200 | 200 | same |
| `GET /api/v1/gallery-categories?page=2&limit=5 [- admin]` | 200 | 200 | same |
| `GET /api/v1/gallery-categories/081d58ff-f285-4db4-8011-14cea47328e6 [ar anon]` | 200 | 200 | same |
| `GET /api/v1/gallery-categories/081d58ff-f285-4db4-8011-14cea47328e6 [ar admin]` | 200 | 200 | same |
| `GET /api/v1/gallery-categories/081d58ff-f285-4db4-8011-14cea47328e6 [en anon]` | 200 | 200 | same |
| `GET /api/v1/gallery-categories/081d58ff-f285-4db4-8011-14cea47328e6 [en admin]` | 200 | 200 | same |
| `GET /api/v1/gallery-categories/081d58ff-f285-4db4-8011-14cea47328e6 [- anon]` | 200 | 200 | same |
| `GET /api/v1/gallery-categories/081d58ff-f285-4db4-8011-14cea47328e6 [- admin]` | 200 | 200 | same |
| `GET /api/v1/gallery-categories/0e7fe879-ad05-4ab3-b709-e9ec73a92075 [ar anon]` | 200 | 200 | same |
| `GET /api/v1/gallery-categories/0e7fe879-ad05-4ab3-b709-e9ec73a92075 [ar admin]` | 200 | 200 | same |
| `GET /api/v1/gallery-categories/0e7fe879-ad05-4ab3-b709-e9ec73a92075 [en anon]` | 200 | 200 | same |
| `GET /api/v1/gallery-categories/0e7fe879-ad05-4ab3-b709-e9ec73a92075 [en admin]` | 200 | 200 | same |
| `GET /api/v1/gallery-categories/0e7fe879-ad05-4ab3-b709-e9ec73a92075 [- anon]` | 200 | 200 | same |
| `GET /api/v1/gallery-categories/0e7fe879-ad05-4ab3-b709-e9ec73a92075 [- admin]` | 200 | 200 | same |
| `GET /api/v1/gallery-categories/00000000-0000-4000-8000-000000000000 [ar anon]` | 404 | 404 | same |
| `GET /api/v1/gallery-categories/00000000-0000-4000-8000-000000000000 [ar admin]` | 404 | 404 | same |
| `GET /api/v1/gallery-categories/00000000-0000-4000-8000-000000000000 [en anon]` | 404 | 404 | same |
| `GET /api/v1/gallery-categories/00000000-0000-4000-8000-000000000000 [en admin]` | 404 | 404 | same |
| `GET /api/v1/gallery-categories/00000000-0000-4000-8000-000000000000 [- anon]` | 404 | 404 | same |
| `GET /api/v1/gallery-categories/00000000-0000-4000-8000-000000000000 [- admin]` | 404 | 404 | same |
| `GET /api/v1/gallery-categories/trash [ar anon]` | 401 | 401 | same |
| `GET /api/v1/gallery-categories/trash [ar admin]` | 200 | 200 | same |
| `GET /api/v1/gallery-categories/trash [en anon]` | 401 | 401 | same |
| `GET /api/v1/gallery-categories/trash [en admin]` | 200 | 200 | same |
| `GET /api/v1/gallery-categories/trash [- anon]` | 401 | 401 | same |
| `GET /api/v1/gallery-categories/trash [- admin]` | 200 | 200 | same |
| `GET /api/v1/gallery-categories/trash?page=2&limit=5 [- anon]` | 401 | 401 | same |
| `GET /api/v1/gallery-categories/trash?page=2&limit=5 [- admin]` | 200 | 200 | same |
| `scenario lifecycle #1 POST /api/v1/gallery-categories [- admin]` | 201 | 201 | same |
| `scenario lifecycle #2 GET /api/v1/gallery-categories/{{cat}} [en anon]` | 200 | 200 | same |
| `scenario lifecycle #3 PATCH /api/v1/gallery-categories/{{cat}} [- admin]` | 200 | 200 | same |
| `scenario lifecycle #4 POST /api/v1/gallery-categories [- admin]` | 409 | 409 | same |
| `scenario lifecycle #5 POST /api/v1/gallery-categories [- admin]` | 409 | 409 | same |
| `scenario lifecycle #6 DELETE /api/v1/gallery-categories/{{cat}} [- admin]` | 200 | 200 | same |
| `scenario lifecycle #7 GET /api/v1/gallery-categories/{{cat}} [- anon]` | 404 | 404 | same |
| `scenario lifecycle #8 GET /api/v1/gallery-categories/trash?limit=100 [- admin]` | 200 | 200 | same |
| `scenario lifecycle #9 POST /api/v1/gallery-categories/{{cat}}/restore [- admin]` | 200 | 200 | same |
| `scenario lifecycle #10 GET /api/v1/gallery-categories/{{cat}} [- anon]` | 200 | 200 | same |
| `scenario lifecycle #11 POST /api/v1/gallery-categories/{{cat}}/restore [- admin]` | 404 | 404 | same |

## Explanations

<!-- Everything above this heading is regenerated on every run; everything from it down is kept.
One bullet per explained diff: a backticked key, `*` matching anything, then why. Example:
- `GET /api/v1/posts* [*] $.data[*].views`: views are counted by the RL_VIEW binding now (D7).
-->
