# Diff report: book-categories

Nest (DB copy A) vs the Worker (DB copy B; unported routes fall through to a Nest on B), on the scrubbed prod dump of 2026-10-04.
Regenerate with `npm run diff -- book-categories` in `worker/`.

- Requests: 45 (1 write scenario)
- Same: 45
- Diffs: 0, unexplained: 0
- Routes skipped: 0

## Requests

| Request | A | B | Result |
|---|---|---|---|
| `GET /api/v1/book-categories [ar anon]` | 200 | 200 | same |
| `GET /api/v1/book-categories [ar admin]` | 200 | 200 | same |
| `GET /api/v1/book-categories [en anon]` | 200 | 200 | same |
| `GET /api/v1/book-categories [en admin]` | 200 | 200 | same |
| `GET /api/v1/book-categories [- anon]` | 200 | 200 | same |
| `GET /api/v1/book-categories [- admin]` | 200 | 200 | same |
| `GET /api/v1/book-categories?page=2&limit=5 [- anon]` | 200 | 200 | same |
| `GET /api/v1/book-categories?page=2&limit=5 [- admin]` | 200 | 200 | same |
| `GET /api/v1/book-categories/3832479d-f150-4d34-8965-c1fd60a660c3 [ar anon]` | 200 | 200 | same |
| `GET /api/v1/book-categories/3832479d-f150-4d34-8965-c1fd60a660c3 [ar admin]` | 200 | 200 | same |
| `GET /api/v1/book-categories/3832479d-f150-4d34-8965-c1fd60a660c3 [en anon]` | 200 | 200 | same |
| `GET /api/v1/book-categories/3832479d-f150-4d34-8965-c1fd60a660c3 [en admin]` | 200 | 200 | same |
| `GET /api/v1/book-categories/3832479d-f150-4d34-8965-c1fd60a660c3 [- anon]` | 200 | 200 | same |
| `GET /api/v1/book-categories/3832479d-f150-4d34-8965-c1fd60a660c3 [- admin]` | 200 | 200 | same |
| `GET /api/v1/book-categories/385471ad-bc51-4531-97fa-934b888bc62a [ar anon]` | 200 | 200 | same |
| `GET /api/v1/book-categories/385471ad-bc51-4531-97fa-934b888bc62a [ar admin]` | 200 | 200 | same |
| `GET /api/v1/book-categories/385471ad-bc51-4531-97fa-934b888bc62a [en anon]` | 200 | 200 | same |
| `GET /api/v1/book-categories/385471ad-bc51-4531-97fa-934b888bc62a [en admin]` | 200 | 200 | same |
| `GET /api/v1/book-categories/385471ad-bc51-4531-97fa-934b888bc62a [- anon]` | 200 | 200 | same |
| `GET /api/v1/book-categories/385471ad-bc51-4531-97fa-934b888bc62a [- admin]` | 200 | 200 | same |
| `GET /api/v1/book-categories/00000000-0000-4000-8000-000000000000 [ar anon]` | 404 | 404 | same |
| `GET /api/v1/book-categories/00000000-0000-4000-8000-000000000000 [ar admin]` | 404 | 404 | same |
| `GET /api/v1/book-categories/00000000-0000-4000-8000-000000000000 [en anon]` | 404 | 404 | same |
| `GET /api/v1/book-categories/00000000-0000-4000-8000-000000000000 [en admin]` | 404 | 404 | same |
| `GET /api/v1/book-categories/00000000-0000-4000-8000-000000000000 [- anon]` | 404 | 404 | same |
| `GET /api/v1/book-categories/00000000-0000-4000-8000-000000000000 [- admin]` | 404 | 404 | same |
| `GET /api/v1/book-categories/trash [ar anon]` | 401 | 401 | same |
| `GET /api/v1/book-categories/trash [ar admin]` | 200 | 200 | same |
| `GET /api/v1/book-categories/trash [en anon]` | 401 | 401 | same |
| `GET /api/v1/book-categories/trash [en admin]` | 200 | 200 | same |
| `GET /api/v1/book-categories/trash [- anon]` | 401 | 401 | same |
| `GET /api/v1/book-categories/trash [- admin]` | 200 | 200 | same |
| `GET /api/v1/book-categories/trash?page=2&limit=5 [- anon]` | 401 | 401 | same |
| `GET /api/v1/book-categories/trash?page=2&limit=5 [- admin]` | 200 | 200 | same |
| `scenario lifecycle #1 POST /api/v1/book-categories [- admin]` | 201 | 201 | same |
| `scenario lifecycle #2 GET /api/v1/book-categories/{{cat}} [en anon]` | 200 | 200 | same |
| `scenario lifecycle #3 PATCH /api/v1/book-categories/{{cat}} [- admin]` | 200 | 200 | same |
| `scenario lifecycle #4 POST /api/v1/book-categories [- admin]` | 409 | 409 | same |
| `scenario lifecycle #5 POST /api/v1/book-categories [- admin]` | 409 | 409 | same |
| `scenario lifecycle #6 DELETE /api/v1/book-categories/{{cat}} [- admin]` | 200 | 200 | same |
| `scenario lifecycle #7 GET /api/v1/book-categories/{{cat}} [- anon]` | 404 | 404 | same |
| `scenario lifecycle #8 GET /api/v1/book-categories/trash?limit=100 [- admin]` | 200 | 200 | same |
| `scenario lifecycle #9 POST /api/v1/book-categories/{{cat}}/restore [- admin]` | 200 | 200 | same |
| `scenario lifecycle #10 GET /api/v1/book-categories/{{cat}} [- anon]` | 200 | 200 | same |
| `scenario lifecycle #11 POST /api/v1/book-categories/{{cat}}/restore [- admin]` | 404 | 404 | same |

## Explanations

<!-- Everything above this heading is regenerated on every run; everything from it down is kept.
One bullet per explained diff: a backticked key, `*` matching anything, then why. Example:
- `GET /api/v1/posts* [*] $.data[*].views`: views are counted by the RL_VIEW binding now (D7).
-->
