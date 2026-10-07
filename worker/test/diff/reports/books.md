# Diff report: books

Nest (DB copy A) vs the Worker (DB copy B; unported routes fall through to a Nest on B), on the scrubbed prod dump of 2026-10-04.
Regenerate with `npm run diff -- books` in `worker/`.

- Requests: 132 (1 write scenario)
- Same: 132
- Diffs: 0, unexplained: 0
- Routes skipped: 0

## Requests

| Request | A | B | Result |
|---|---|---|---|
| `GET /api/v1/books [ar anon]` | 200 | 200 | same |
| `GET /api/v1/books [ar admin]` | 200 | 200 | same |
| `GET /api/v1/books [en anon]` | 200 | 200 | same |
| `GET /api/v1/books [en admin]` | 200 | 200 | same |
| `GET /api/v1/books [- anon]` | 200 | 200 | same |
| `GET /api/v1/books [- admin]` | 200 | 200 | same |
| `GET /api/v1/books?page=2&limit=5 [- anon]` | 200 | 200 | same |
| `GET /api/v1/books?page=2&limit=5 [- admin]` | 200 | 200 | same |
| `GET /api/v1/books/00d871d7-142b-492d-888f-1dd3aff5a2dc [ar anon]` | 200 | 200 | same |
| `GET /api/v1/books/00d871d7-142b-492d-888f-1dd3aff5a2dc [ar admin]` | 200 | 200 | same |
| `GET /api/v1/books/00d871d7-142b-492d-888f-1dd3aff5a2dc [en anon]` | 200 | 200 | same |
| `GET /api/v1/books/00d871d7-142b-492d-888f-1dd3aff5a2dc [en admin]` | 200 | 200 | same |
| `GET /api/v1/books/00d871d7-142b-492d-888f-1dd3aff5a2dc [- anon]` | 200 | 200 | same |
| `GET /api/v1/books/00d871d7-142b-492d-888f-1dd3aff5a2dc [- admin]` | 200 | 200 | same |
| `GET /api/v1/books/03b1a519-3e42-4084-a9c3-6f28ed790377 [ar anon]` | 200 | 200 | same |
| `GET /api/v1/books/03b1a519-3e42-4084-a9c3-6f28ed790377 [ar admin]` | 200 | 200 | same |
| `GET /api/v1/books/03b1a519-3e42-4084-a9c3-6f28ed790377 [en anon]` | 200 | 200 | same |
| `GET /api/v1/books/03b1a519-3e42-4084-a9c3-6f28ed790377 [en admin]` | 200 | 200 | same |
| `GET /api/v1/books/03b1a519-3e42-4084-a9c3-6f28ed790377 [- anon]` | 200 | 200 | same |
| `GET /api/v1/books/03b1a519-3e42-4084-a9c3-6f28ed790377 [- admin]` | 200 | 200 | same |
| `GET /api/v1/books/00000000-0000-4000-8000-000000000000 [ar anon]` | 404 | 404 | same |
| `GET /api/v1/books/00000000-0000-4000-8000-000000000000 [ar admin]` | 404 | 404 | same |
| `GET /api/v1/books/00000000-0000-4000-8000-000000000000 [en anon]` | 404 | 404 | same |
| `GET /api/v1/books/00000000-0000-4000-8000-000000000000 [en admin]` | 404 | 404 | same |
| `GET /api/v1/books/00000000-0000-4000-8000-000000000000 [- anon]` | 404 | 404 | same |
| `GET /api/v1/books/00000000-0000-4000-8000-000000000000 [- admin]` | 404 | 404 | same |
| `GET /api/v1/books/admin [ar anon]` | 401 | 401 | same |
| `GET /api/v1/books/admin [ar admin]` | 200 | 200 | same |
| `GET /api/v1/books/admin [en anon]` | 401 | 401 | same |
| `GET /api/v1/books/admin [en admin]` | 200 | 200 | same |
| `GET /api/v1/books/admin [- anon]` | 401 | 401 | same |
| `GET /api/v1/books/admin [- admin]` | 200 | 200 | same |
| `GET /api/v1/books/admin?page=2&limit=5 [- anon]` | 401 | 401 | same |
| `GET /api/v1/books/admin?page=2&limit=5 [- admin]` | 200 | 200 | same |
| `GET /api/v1/books/admin/00d871d7-142b-492d-888f-1dd3aff5a2dc [ar anon]` | 401 | 401 | same |
| `GET /api/v1/books/admin/00d871d7-142b-492d-888f-1dd3aff5a2dc [ar admin]` | 200 | 200 | same |
| `GET /api/v1/books/admin/00d871d7-142b-492d-888f-1dd3aff5a2dc [en anon]` | 401 | 401 | same |
| `GET /api/v1/books/admin/00d871d7-142b-492d-888f-1dd3aff5a2dc [en admin]` | 200 | 200 | same |
| `GET /api/v1/books/admin/00d871d7-142b-492d-888f-1dd3aff5a2dc [- anon]` | 401 | 401 | same |
| `GET /api/v1/books/admin/00d871d7-142b-492d-888f-1dd3aff5a2dc [- admin]` | 200 | 200 | same |
| `GET /api/v1/books/admin/03b1a519-3e42-4084-a9c3-6f28ed790377 [ar anon]` | 401 | 401 | same |
| `GET /api/v1/books/admin/03b1a519-3e42-4084-a9c3-6f28ed790377 [ar admin]` | 200 | 200 | same |
| `GET /api/v1/books/admin/03b1a519-3e42-4084-a9c3-6f28ed790377 [en anon]` | 401 | 401 | same |
| `GET /api/v1/books/admin/03b1a519-3e42-4084-a9c3-6f28ed790377 [en admin]` | 200 | 200 | same |
| `GET /api/v1/books/admin/03b1a519-3e42-4084-a9c3-6f28ed790377 [- anon]` | 401 | 401 | same |
| `GET /api/v1/books/admin/03b1a519-3e42-4084-a9c3-6f28ed790377 [- admin]` | 200 | 200 | same |
| `GET /api/v1/books/admin/00000000-0000-4000-8000-000000000000 [ar anon]` | 401 | 401 | same |
| `GET /api/v1/books/admin/00000000-0000-4000-8000-000000000000 [ar admin]` | 404 | 404 | same |
| `GET /api/v1/books/admin/00000000-0000-4000-8000-000000000000 [en anon]` | 401 | 401 | same |
| `GET /api/v1/books/admin/00000000-0000-4000-8000-000000000000 [en admin]` | 404 | 404 | same |
| `GET /api/v1/books/admin/00000000-0000-4000-8000-000000000000 [- anon]` | 401 | 401 | same |
| `GET /api/v1/books/admin/00000000-0000-4000-8000-000000000000 [- admin]` | 404 | 404 | same |
| `GET /api/v1/books/by-slug/null [ar anon]` | 404 | 404 | same |
| `GET /api/v1/books/by-slug/null [ar admin]` | 404 | 404 | same |
| `GET /api/v1/books/by-slug/null [en anon]` | 404 | 404 | same |
| `GET /api/v1/books/by-slug/null [en admin]` | 404 | 404 | same |
| `GET /api/v1/books/by-slug/null [- anon]` | 404 | 404 | same |
| `GET /api/v1/books/by-slug/null [- admin]` | 404 | 404 | same |
| `GET /api/v1/books/by-slug/null [ar anon]` | 404 | 404 | same |
| `GET /api/v1/books/by-slug/null [ar admin]` | 404 | 404 | same |
| `GET /api/v1/books/by-slug/null [en anon]` | 404 | 404 | same |
| `GET /api/v1/books/by-slug/null [en admin]` | 404 | 404 | same |
| `GET /api/v1/books/by-slug/null [- anon]` | 404 | 404 | same |
| `GET /api/v1/books/by-slug/null [- admin]` | 404 | 404 | same |
| `GET /api/v1/books/by-slug/does-not-exist [ar anon]` | 404 | 404 | same |
| `GET /api/v1/books/by-slug/does-not-exist [ar admin]` | 404 | 404 | same |
| `GET /api/v1/books/by-slug/does-not-exist [en anon]` | 404 | 404 | same |
| `GET /api/v1/books/by-slug/does-not-exist [en admin]` | 404 | 404 | same |
| `GET /api/v1/books/by-slug/does-not-exist [- anon]` | 404 | 404 | same |
| `GET /api/v1/books/by-slug/does-not-exist [- admin]` | 404 | 404 | same |
| `GET /api/v1/books/trash [ar anon]` | 401 | 401 | same |
| `GET /api/v1/books/trash [ar admin]` | 200 | 200 | same |
| `GET /api/v1/books/trash [en anon]` | 401 | 401 | same |
| `GET /api/v1/books/trash [en admin]` | 200 | 200 | same |
| `GET /api/v1/books/trash [- anon]` | 401 | 401 | same |
| `GET /api/v1/books/trash [- admin]` | 200 | 200 | same |
| `GET /api/v1/books/trash?page=2&limit=5 [- anon]` | 401 | 401 | same |
| `GET /api/v1/books/trash?page=2&limit=5 [- admin]` | 200 | 200 | same |
| `scenario lifecycle #1 POST /api/v1/book-categories [- admin]` | 201 | 201 | same |
| `scenario lifecycle #2 POST /api/v1/book-categories [- admin]` | 201 | 201 | same |
| `scenario lifecycle #3 GET /api/v1/books/admin?limit=1 [- admin]` | 200 | 200 | same |
| `scenario lifecycle #4 POST /api/v1/books [- admin]` | 201 | 201 | same |
| `scenario lifecycle #5 POST /api/v1/books [- admin]` | 404 | 404 | same |
| `scenario lifecycle #6 POST /api/v1/books [- admin]` | 404 | 404 | same |
| `scenario lifecycle #7 POST /api/v1/books [- admin]` | 400 | 400 | same |
| `scenario lifecycle #8 POST /api/v1/books [- admin]` | 409 | 409 | same |
| `scenario lifecycle #9 POST /api/v1/books [- admin]` | 409 | 409 | same |
| `scenario lifecycle #10 POST /api/v1/books [- admin]` | 400 | 400 | same |
| `scenario lifecycle #11 POST /api/v1/books [- admin]` | 400 | 400 | same |
| `scenario lifecycle #12 POST /api/v1/books [- admin]` | 201 | 201 | same |
| `scenario lifecycle #13 POST /api/v1/books [- admin]` | 201 | 201 | same |
| `scenario lifecycle #14 POST /api/v1/books [- admin]` | 409 | 409 | same |
| `scenario lifecycle #15 POST /api/v1/books [- admin]` | 400 | 400 | same |
| `scenario lifecycle #16 POST /api/v1/books [- admin]` | 404 | 404 | same |
| `scenario lifecycle #17 GET /api/v1/books/{{b}} [en anon]` | 200 | 200 | same |
| `scenario lifecycle #18 GET /api/v1/books/admin/{{b}} [en admin]` | 200 | 200 | same |
| `scenario lifecycle #19 GET /api/v1/books/{{p1}} [- anon]` | 200 | 200 | same |
| `scenario lifecycle #20 GET /api/v1/books/{{p2}} [- anon]` | 404 | 404 | same |
| `scenario lifecycle #21 GET /api/v1/books/by-slug/diff-books-series [- anon]` | 200 | 200 | same |
| `scenario lifecycle #22 GET /api/v1/books?category_id={{cat_a}}&is_publication=true [- anon]` | 200 | 200 | same |
| `scenario lifecycle #23 GET /api/v1/books/admin?category_id={{cat_a}} [- admin]` | 200 | 200 | same |
| `scenario lifecycle #24 POST /api/v1/books/{{p1}}/view [- anon]` | 201 | 201 | same |
| `scenario lifecycle #25 PATCH /api/v1/books/{{b}} [- admin]` | 200 | 200 | same |
| `scenario lifecycle #26 PATCH /api/v1/books/{{b}} [- admin]` | 409 | 409 | same |
| `scenario lifecycle #27 PATCH /api/v1/books/{{b}} [- admin]` | 400 | 400 | same |
| `scenario lifecycle #28 PATCH /api/v1/books/{{b}} [- admin]` | 404 | 404 | same |
| `scenario lifecycle #29 PATCH /api/v1/books/{{b}} [- admin]` | 404 | 404 | same |
| `scenario lifecycle #30 PATCH /api/v1/books/{{b}} [- admin]` | 400 | 400 | same |
| `scenario lifecycle #31 PATCH /api/v1/books/{{b}} [- admin]` | 400 | 400 | same |
| `scenario lifecycle #32 PATCH /api/v1/books/{{p1}} [- admin]` | 409 | 409 | same |
| `scenario lifecycle #33 PATCH /api/v1/books/{{p1}} [- admin]` | 400 | 400 | same |
| `scenario lifecycle #34 PATCH /api/v1/books/{{p1}} [- admin]` | 200 | 200 | same |
| `scenario lifecycle #35 DELETE /api/v1/books/{{b}} [- admin]` | 409 | 409 | same |
| `scenario lifecycle #36 PATCH /api/v1/books/{{b}}/publish [- admin]` | 200 | 200 | same |
| `scenario lifecycle #37 PATCH /api/v1/books/{{b}}/publish [- admin]` | 200 | 200 | same |
| `scenario lifecycle #38 PATCH /api/v1/books/{{b}}/publish [- admin]` | 400 | 400 | same |
| `scenario lifecycle #39 GET /api/v1/books/{{p1}} [- anon]` | 404 | 404 | same |
| `scenario lifecycle #40 POST /api/v1/books/{{p1}}/view [- anon]` | 404 | 404 | same |
| `scenario lifecycle #41 PATCH /api/v1/books/{{b}} [- admin]` | 200 | 200 | same |
| `scenario lifecycle #42 PATCH /api/v1/books/{{b}}/publish [- admin]` | 200 | 200 | same |
| `scenario lifecycle #43 DELETE /api/v1/books/{{p1}} [- admin]` | 200 | 200 | same |
| `scenario lifecycle #44 DELETE /api/v1/books/{{p2}} [- admin]` | 200 | 200 | same |
| `scenario lifecycle #45 DELETE /api/v1/books/{{b}} [- admin]` | 200 | 200 | same |
| `scenario lifecycle #46 DELETE /api/v1/books/{{b}} [- admin]` | 404 | 404 | same |
| `scenario lifecycle #47 GET /api/v1/books/trash?limit=100 [- admin]` | 200 | 200 | same |
| `scenario lifecycle #48 POST /api/v1/books/{{p1}}/restore [- admin]` | 409 | 409 | same |
| `scenario lifecycle #49 POST /api/v1/books/{{b}}/restore [- admin]` | 200 | 200 | same |
| `scenario lifecycle #50 POST /api/v1/books/{{p1}}/restore [- admin]` | 200 | 200 | same |
| `scenario lifecycle #51 POST /api/v1/books/{{p2}}/restore [- admin]` | 200 | 200 | same |
| `scenario lifecycle #52 POST /api/v1/books/{{b}}/restore [- admin]` | 404 | 404 | same |
| `scenario lifecycle #53 DELETE /api/v1/book-categories/{{cat_a}} [- admin]` | 409 | 409 | same |
| `scenario lifecycle #54 GET /api/v1/books/{{b}} [- anon]` | 200 | 200 | same |

## Explanations

<!-- Everything above this heading is regenerated on every run; everything from it down is kept.
One bullet per explained diff: a backticked key, `*` matching anything, then why. Example:
- `GET /api/v1/posts* [*] $.data[*].views`: views are counted by the RL_VIEW binding now (D7).
-->
