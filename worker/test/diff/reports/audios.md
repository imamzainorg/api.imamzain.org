# Diff report: audios

Nest (DB copy A) vs the Worker (DB copy B; unported routes fall through to a Nest on B), on the scrubbed prod dump of 2026-10-04.
Regenerate with `npm run diff -- audios` in `worker/`.

- Requests: 113 (1 write scenario)
- Same: 113
- Diffs: 0, unexplained: 0
- Routes skipped: 0

## Requests

| Request | A | B | Result |
|---|---|---|---|
| `GET /api/v1/audios [ar anon]` | 200 | 200 | same |
| `GET /api/v1/audios [ar admin]` | 200 | 200 | same |
| `GET /api/v1/audios [en anon]` | 200 | 200 | same |
| `GET /api/v1/audios [en admin]` | 200 | 200 | same |
| `GET /api/v1/audios [- anon]` | 200 | 200 | same |
| `GET /api/v1/audios [- admin]` | 200 | 200 | same |
| `GET /api/v1/audios?page=2&limit=5 [- anon]` | 200 | 200 | same |
| `GET /api/v1/audios?page=2&limit=5 [- admin]` | 200 | 200 | same |
| `GET /api/v1/audios/01152c4d-626b-46a2-b4e1-a7ebed372269 [ar anon]` | 200 | 200 | same |
| `GET /api/v1/audios/01152c4d-626b-46a2-b4e1-a7ebed372269 [ar admin]` | 200 | 200 | same |
| `GET /api/v1/audios/01152c4d-626b-46a2-b4e1-a7ebed372269 [en anon]` | 200 | 200 | same |
| `GET /api/v1/audios/01152c4d-626b-46a2-b4e1-a7ebed372269 [en admin]` | 200 | 200 | same |
| `GET /api/v1/audios/01152c4d-626b-46a2-b4e1-a7ebed372269 [- anon]` | 200 | 200 | same |
| `GET /api/v1/audios/01152c4d-626b-46a2-b4e1-a7ebed372269 [- admin]` | 200 | 200 | same |
| `GET /api/v1/audios/0289461d-99d4-461e-89b8-b5d49f6f7e69 [ar anon]` | 200 | 200 | same |
| `GET /api/v1/audios/0289461d-99d4-461e-89b8-b5d49f6f7e69 [ar admin]` | 200 | 200 | same |
| `GET /api/v1/audios/0289461d-99d4-461e-89b8-b5d49f6f7e69 [en anon]` | 200 | 200 | same |
| `GET /api/v1/audios/0289461d-99d4-461e-89b8-b5d49f6f7e69 [en admin]` | 200 | 200 | same |
| `GET /api/v1/audios/0289461d-99d4-461e-89b8-b5d49f6f7e69 [- anon]` | 200 | 200 | same |
| `GET /api/v1/audios/0289461d-99d4-461e-89b8-b5d49f6f7e69 [- admin]` | 200 | 200 | same |
| `GET /api/v1/audios/00000000-0000-4000-8000-000000000000 [ar anon]` | 404 | 404 | same |
| `GET /api/v1/audios/00000000-0000-4000-8000-000000000000 [ar admin]` | 404 | 404 | same |
| `GET /api/v1/audios/00000000-0000-4000-8000-000000000000 [en anon]` | 404 | 404 | same |
| `GET /api/v1/audios/00000000-0000-4000-8000-000000000000 [en admin]` | 404 | 404 | same |
| `GET /api/v1/audios/00000000-0000-4000-8000-000000000000 [- anon]` | 404 | 404 | same |
| `GET /api/v1/audios/00000000-0000-4000-8000-000000000000 [- admin]` | 404 | 404 | same |
| `GET /api/v1/audios/admin [ar anon]` | 401 | 401 | same |
| `GET /api/v1/audios/admin [ar admin]` | 200 | 200 | same |
| `GET /api/v1/audios/admin [en anon]` | 401 | 401 | same |
| `GET /api/v1/audios/admin [en admin]` | 200 | 200 | same |
| `GET /api/v1/audios/admin [- anon]` | 401 | 401 | same |
| `GET /api/v1/audios/admin [- admin]` | 200 | 200 | same |
| `GET /api/v1/audios/admin?page=2&limit=5 [- anon]` | 401 | 401 | same |
| `GET /api/v1/audios/admin?page=2&limit=5 [- admin]` | 200 | 200 | same |
| `GET /api/v1/audios/admin/01152c4d-626b-46a2-b4e1-a7ebed372269 [ar anon]` | 401 | 401 | same |
| `GET /api/v1/audios/admin/01152c4d-626b-46a2-b4e1-a7ebed372269 [ar admin]` | 200 | 200 | same |
| `GET /api/v1/audios/admin/01152c4d-626b-46a2-b4e1-a7ebed372269 [en anon]` | 401 | 401 | same |
| `GET /api/v1/audios/admin/01152c4d-626b-46a2-b4e1-a7ebed372269 [en admin]` | 200 | 200 | same |
| `GET /api/v1/audios/admin/01152c4d-626b-46a2-b4e1-a7ebed372269 [- anon]` | 401 | 401 | same |
| `GET /api/v1/audios/admin/01152c4d-626b-46a2-b4e1-a7ebed372269 [- admin]` | 200 | 200 | same |
| `GET /api/v1/audios/admin/0289461d-99d4-461e-89b8-b5d49f6f7e69 [ar anon]` | 401 | 401 | same |
| `GET /api/v1/audios/admin/0289461d-99d4-461e-89b8-b5d49f6f7e69 [ar admin]` | 200 | 200 | same |
| `GET /api/v1/audios/admin/0289461d-99d4-461e-89b8-b5d49f6f7e69 [en anon]` | 401 | 401 | same |
| `GET /api/v1/audios/admin/0289461d-99d4-461e-89b8-b5d49f6f7e69 [en admin]` | 200 | 200 | same |
| `GET /api/v1/audios/admin/0289461d-99d4-461e-89b8-b5d49f6f7e69 [- anon]` | 401 | 401 | same |
| `GET /api/v1/audios/admin/0289461d-99d4-461e-89b8-b5d49f6f7e69 [- admin]` | 200 | 200 | same |
| `GET /api/v1/audios/admin/00000000-0000-4000-8000-000000000000 [ar anon]` | 401 | 401 | same |
| `GET /api/v1/audios/admin/00000000-0000-4000-8000-000000000000 [ar admin]` | 404 | 404 | same |
| `GET /api/v1/audios/admin/00000000-0000-4000-8000-000000000000 [en anon]` | 401 | 401 | same |
| `GET /api/v1/audios/admin/00000000-0000-4000-8000-000000000000 [en admin]` | 404 | 404 | same |
| `GET /api/v1/audios/admin/00000000-0000-4000-8000-000000000000 [- anon]` | 401 | 401 | same |
| `GET /api/v1/audios/admin/00000000-0000-4000-8000-000000000000 [- admin]` | 404 | 404 | same |
| `GET /api/v1/audios/by-slug/null [ar anon]` | 404 | 404 | same |
| `GET /api/v1/audios/by-slug/null [ar admin]` | 404 | 404 | same |
| `GET /api/v1/audios/by-slug/null [en anon]` | 404 | 404 | same |
| `GET /api/v1/audios/by-slug/null [en admin]` | 404 | 404 | same |
| `GET /api/v1/audios/by-slug/null [- anon]` | 404 | 404 | same |
| `GET /api/v1/audios/by-slug/null [- admin]` | 404 | 404 | same |
| `GET /api/v1/audios/by-slug/null [ar anon]` | 404 | 404 | same |
| `GET /api/v1/audios/by-slug/null [ar admin]` | 404 | 404 | same |
| `GET /api/v1/audios/by-slug/null [en anon]` | 404 | 404 | same |
| `GET /api/v1/audios/by-slug/null [en admin]` | 404 | 404 | same |
| `GET /api/v1/audios/by-slug/null [- anon]` | 404 | 404 | same |
| `GET /api/v1/audios/by-slug/null [- admin]` | 404 | 404 | same |
| `GET /api/v1/audios/by-slug/does-not-exist [ar anon]` | 404 | 404 | same |
| `GET /api/v1/audios/by-slug/does-not-exist [ar admin]` | 404 | 404 | same |
| `GET /api/v1/audios/by-slug/does-not-exist [en anon]` | 404 | 404 | same |
| `GET /api/v1/audios/by-slug/does-not-exist [en admin]` | 404 | 404 | same |
| `GET /api/v1/audios/by-slug/does-not-exist [- anon]` | 404 | 404 | same |
| `GET /api/v1/audios/by-slug/does-not-exist [- admin]` | 404 | 404 | same |
| `GET /api/v1/audios/trash [ar anon]` | 401 | 401 | same |
| `GET /api/v1/audios/trash [ar admin]` | 200 | 200 | same |
| `GET /api/v1/audios/trash [en anon]` | 401 | 401 | same |
| `GET /api/v1/audios/trash [en admin]` | 200 | 200 | same |
| `GET /api/v1/audios/trash [- anon]` | 401 | 401 | same |
| `GET /api/v1/audios/trash [- admin]` | 200 | 200 | same |
| `GET /api/v1/audios/trash?page=2&limit=5 [- anon]` | 401 | 401 | same |
| `GET /api/v1/audios/trash?page=2&limit=5 [- admin]` | 200 | 200 | same |
| `scenario lifecycle #1 POST /api/v1/speakers [- admin]` | 201 | 201 | same |
| `scenario lifecycle #2 POST /api/v1/audios [- admin]` | 201 | 201 | same |
| `scenario lifecycle #3 POST /api/v1/audios [- admin]` | 409 | 409 | same |
| `scenario lifecycle #4 POST /api/v1/audios [- admin]` | 409 | 409 | same |
| `scenario lifecycle #5 POST /api/v1/audios [- admin]` | 404 | 404 | same |
| `scenario lifecycle #6 POST /api/v1/audios [- admin]` | 400 | 400 | same |
| `scenario lifecycle #7 POST /api/v1/audios [- admin]` | 400 | 400 | same |
| `scenario lifecycle #8 PATCH /api/v1/audios/{{a}} [- admin]` | 200 | 200 | same |
| `scenario lifecycle #9 PATCH /api/v1/audios/{{a}} [- admin]` | 400 | 400 | same |
| `scenario lifecycle #10 PATCH /api/v1/audios/{{a}} [- admin]` | 404 | 404 | same |
| `scenario lifecycle #11 PATCH /api/v1/audios/{{a}} [- admin]` | 200 | 200 | same |
| `scenario lifecycle #12 GET /api/v1/audios/{{a}} [en anon]` | 200 | 200 | same |
| `scenario lifecycle #13 GET /api/v1/audios/by-slug/diff-audio [- anon]` | 200 | 200 | same |
| `scenario lifecycle #14 GET /api/v1/audios?search=Diff [- anon]` | 200 | 200 | same |
| `scenario lifecycle #15 POST /api/v1/audios/{{a}}/view [- anon]` | 201 | 201 | same |
| `scenario lifecycle #16 PATCH /api/v1/audios/{{a}}/publish [- admin]` | 200 | 200 | same |
| `scenario lifecycle #17 PATCH /api/v1/audios/{{a}}/publish [- admin]` | 200 | 200 | same |
| `scenario lifecycle #18 PATCH /api/v1/audios/{{a}}/publish [- admin]` | 400 | 400 | same |
| `scenario lifecycle #19 GET /api/v1/audios/{{a}} [- anon]` | 404 | 404 | same |
| `scenario lifecycle #20 POST /api/v1/audios/{{a}}/view [- anon]` | 404 | 404 | same |
| `scenario lifecycle #21 GET /api/v1/audios/admin/{{a}} [- admin]` | 200 | 200 | same |
| `scenario lifecycle #22 GET /api/v1/audios/admin?is_published=false&limit=100 [- admin]` | 200 | 200 | same |
| `scenario lifecycle #23 PATCH /api/v1/audios/{{a}}/publish [- admin]` | 200 | 200 | same |
| `scenario lifecycle #24 DELETE /api/v1/audios/{{a}} [- admin]` | 200 | 200 | same |
| `scenario lifecycle #25 DELETE /api/v1/audios/{{a}} [- admin]` | 404 | 404 | same |
| `scenario lifecycle #26 POST /api/v1/audios [- admin]` | 201 | 201 | same |
| `scenario lifecycle #27 GET /api/v1/audios/trash?limit=100 [- admin]` | 200 | 200 | same |
| `scenario lifecycle #28 POST /api/v1/audios/{{a}}/restore [- admin]` | 409 | 409 | same |
| `scenario lifecycle #29 DELETE /api/v1/audios/{{b}} [- admin]` | 200 | 200 | same |
| `scenario lifecycle #30 POST /api/v1/audios/{{a}}/restore [- admin]` | 200 | 200 | same |
| `scenario lifecycle #31 POST /api/v1/audios/{{a}}/restore [- admin]` | 404 | 404 | same |
| `scenario lifecycle #32 GET /api/v1/audios/{{a}} [- anon]` | 200 | 200 | same |
| `scenario lifecycle #33 DELETE /api/v1/audios/{{a}} [- admin]` | 200 | 200 | same |
| `scenario lifecycle #34 DELETE /api/v1/speakers/{{spk}} [- admin]` | 200 | 200 | same |
| `scenario lifecycle #35 POST /api/v1/audios/{{a}}/restore [- admin]` | 200 | 200 | same |

## Explanations

<!-- Everything above this heading is regenerated on every run; everything from it down is kept.
One bullet per explained diff: a backticked key, `*` matching anything, then why. Example:
- `GET /api/v1/posts* [*] $.data[*].views`: views are counted by the RL_VIEW binding now (D7).
-->
