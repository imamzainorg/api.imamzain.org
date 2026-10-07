# Diff report: academic-papers

Nest (DB copy A) vs the Worker (DB copy B; unported routes fall through to a Nest on B), on the scrubbed prod dump of 2026-10-04.
Regenerate with `npm run diff -- academic-papers` in `worker/`.

- Requests: 90 (1 write scenario)
- Same: 90
- Diffs: 0, unexplained: 0
- Routes skipped: 0

## Requests

| Request | A | B | Result |
|---|---|---|---|
| `GET /api/v1/academic-papers [ar anon]` | 200 | 200 | same |
| `GET /api/v1/academic-papers [ar admin]` | 200 | 200 | same |
| `GET /api/v1/academic-papers [en anon]` | 200 | 200 | same |
| `GET /api/v1/academic-papers [en admin]` | 200 | 200 | same |
| `GET /api/v1/academic-papers [- anon]` | 200 | 200 | same |
| `GET /api/v1/academic-papers [- admin]` | 200 | 200 | same |
| `GET /api/v1/academic-papers?page=2&limit=5 [- anon]` | 200 | 200 | same |
| `GET /api/v1/academic-papers?page=2&limit=5 [- admin]` | 200 | 200 | same |
| `GET /api/v1/academic-papers/0018d3de-dca5-46ec-ac9e-1510e36a3a2a [ar anon]` | 200 | 200 | same |
| `GET /api/v1/academic-papers/0018d3de-dca5-46ec-ac9e-1510e36a3a2a [ar admin]` | 200 | 200 | same |
| `GET /api/v1/academic-papers/0018d3de-dca5-46ec-ac9e-1510e36a3a2a [en anon]` | 200 | 200 | same |
| `GET /api/v1/academic-papers/0018d3de-dca5-46ec-ac9e-1510e36a3a2a [en admin]` | 200 | 200 | same |
| `GET /api/v1/academic-papers/0018d3de-dca5-46ec-ac9e-1510e36a3a2a [- anon]` | 200 | 200 | same |
| `GET /api/v1/academic-papers/0018d3de-dca5-46ec-ac9e-1510e36a3a2a [- admin]` | 200 | 200 | same |
| `GET /api/v1/academic-papers/0023bad2-58c8-49f9-99b4-00928312b20a [ar anon]` | 200 | 200 | same |
| `GET /api/v1/academic-papers/0023bad2-58c8-49f9-99b4-00928312b20a [ar admin]` | 200 | 200 | same |
| `GET /api/v1/academic-papers/0023bad2-58c8-49f9-99b4-00928312b20a [en anon]` | 200 | 200 | same |
| `GET /api/v1/academic-papers/0023bad2-58c8-49f9-99b4-00928312b20a [en admin]` | 200 | 200 | same |
| `GET /api/v1/academic-papers/0023bad2-58c8-49f9-99b4-00928312b20a [- anon]` | 200 | 200 | same |
| `GET /api/v1/academic-papers/0023bad2-58c8-49f9-99b4-00928312b20a [- admin]` | 200 | 200 | same |
| `GET /api/v1/academic-papers/00000000-0000-4000-8000-000000000000 [ar anon]` | 404 | 404 | same |
| `GET /api/v1/academic-papers/00000000-0000-4000-8000-000000000000 [ar admin]` | 404 | 404 | same |
| `GET /api/v1/academic-papers/00000000-0000-4000-8000-000000000000 [en anon]` | 404 | 404 | same |
| `GET /api/v1/academic-papers/00000000-0000-4000-8000-000000000000 [en admin]` | 404 | 404 | same |
| `GET /api/v1/academic-papers/00000000-0000-4000-8000-000000000000 [- anon]` | 404 | 404 | same |
| `GET /api/v1/academic-papers/00000000-0000-4000-8000-000000000000 [- admin]` | 404 | 404 | same |
| `GET /api/v1/academic-papers/admin [ar anon]` | 401 | 401 | same |
| `GET /api/v1/academic-papers/admin [ar admin]` | 200 | 200 | same |
| `GET /api/v1/academic-papers/admin [en anon]` | 401 | 401 | same |
| `GET /api/v1/academic-papers/admin [en admin]` | 200 | 200 | same |
| `GET /api/v1/academic-papers/admin [- anon]` | 401 | 401 | same |
| `GET /api/v1/academic-papers/admin [- admin]` | 200 | 200 | same |
| `GET /api/v1/academic-papers/admin?page=2&limit=5 [- anon]` | 401 | 401 | same |
| `GET /api/v1/academic-papers/admin?page=2&limit=5 [- admin]` | 200 | 200 | same |
| `GET /api/v1/academic-papers/admin/0018d3de-dca5-46ec-ac9e-1510e36a3a2a [ar anon]` | 401 | 401 | same |
| `GET /api/v1/academic-papers/admin/0018d3de-dca5-46ec-ac9e-1510e36a3a2a [ar admin]` | 200 | 200 | same |
| `GET /api/v1/academic-papers/admin/0018d3de-dca5-46ec-ac9e-1510e36a3a2a [en anon]` | 401 | 401 | same |
| `GET /api/v1/academic-papers/admin/0018d3de-dca5-46ec-ac9e-1510e36a3a2a [en admin]` | 200 | 200 | same |
| `GET /api/v1/academic-papers/admin/0018d3de-dca5-46ec-ac9e-1510e36a3a2a [- anon]` | 401 | 401 | same |
| `GET /api/v1/academic-papers/admin/0018d3de-dca5-46ec-ac9e-1510e36a3a2a [- admin]` | 200 | 200 | same |
| `GET /api/v1/academic-papers/admin/0023bad2-58c8-49f9-99b4-00928312b20a [ar anon]` | 401 | 401 | same |
| `GET /api/v1/academic-papers/admin/0023bad2-58c8-49f9-99b4-00928312b20a [ar admin]` | 200 | 200 | same |
| `GET /api/v1/academic-papers/admin/0023bad2-58c8-49f9-99b4-00928312b20a [en anon]` | 401 | 401 | same |
| `GET /api/v1/academic-papers/admin/0023bad2-58c8-49f9-99b4-00928312b20a [en admin]` | 200 | 200 | same |
| `GET /api/v1/academic-papers/admin/0023bad2-58c8-49f9-99b4-00928312b20a [- anon]` | 401 | 401 | same |
| `GET /api/v1/academic-papers/admin/0023bad2-58c8-49f9-99b4-00928312b20a [- admin]` | 200 | 200 | same |
| `GET /api/v1/academic-papers/admin/00000000-0000-4000-8000-000000000000 [ar anon]` | 401 | 401 | same |
| `GET /api/v1/academic-papers/admin/00000000-0000-4000-8000-000000000000 [ar admin]` | 404 | 404 | same |
| `GET /api/v1/academic-papers/admin/00000000-0000-4000-8000-000000000000 [en anon]` | 401 | 401 | same |
| `GET /api/v1/academic-papers/admin/00000000-0000-4000-8000-000000000000 [en admin]` | 404 | 404 | same |
| `GET /api/v1/academic-papers/admin/00000000-0000-4000-8000-000000000000 [- anon]` | 401 | 401 | same |
| `GET /api/v1/academic-papers/admin/00000000-0000-4000-8000-000000000000 [- admin]` | 404 | 404 | same |
| `GET /api/v1/academic-papers/trash [ar anon]` | 401 | 401 | same |
| `GET /api/v1/academic-papers/trash [ar admin]` | 200 | 200 | same |
| `GET /api/v1/academic-papers/trash [en anon]` | 401 | 401 | same |
| `GET /api/v1/academic-papers/trash [en admin]` | 200 | 200 | same |
| `GET /api/v1/academic-papers/trash [- anon]` | 401 | 401 | same |
| `GET /api/v1/academic-papers/trash [- admin]` | 200 | 200 | same |
| `GET /api/v1/academic-papers/trash?page=2&limit=5 [- anon]` | 401 | 401 | same |
| `GET /api/v1/academic-papers/trash?page=2&limit=5 [- admin]` | 200 | 200 | same |
| `scenario lifecycle #1 POST /api/v1/academic-paper-categories [- admin]` | 201 | 201 | same |
| `scenario lifecycle #2 POST /api/v1/academic-paper-categories [- admin]` | 201 | 201 | same |
| `scenario lifecycle #3 POST /api/v1/academic-papers [- admin]` | 201 | 201 | same |
| `scenario lifecycle #4 POST /api/v1/academic-papers [- admin]` | 404 | 404 | same |
| `scenario lifecycle #5 POST /api/v1/academic-papers [- admin]` | 400 | 400 | same |
| `scenario lifecycle #6 POST /api/v1/academic-papers [- admin]` | 400 | 400 | same |
| `scenario lifecycle #7 POST /api/v1/academic-papers [- admin]` | 400 | 400 | same |
| `scenario lifecycle #8 PATCH /api/v1/academic-papers/{{p}} [- admin]` | 200 | 200 | same |
| `scenario lifecycle #9 PATCH /api/v1/academic-papers/{{p}} [- admin]` | 400 | 400 | same |
| `scenario lifecycle #10 PATCH /api/v1/academic-papers/{{p}} [- admin]` | 404 | 404 | same |
| `scenario lifecycle #11 PATCH /api/v1/academic-papers/{{p}} [- admin]` | 200 | 200 | same |
| `scenario lifecycle #12 GET /api/v1/academic-papers/{{p}} [en anon]` | 200 | 200 | same |
| `scenario lifecycle #13 GET /api/v1/academic-papers?search=abstract&category_id={{cat_b}} [- anon]` | 200 | 200 | same |
| `scenario lifecycle #14 POST /api/v1/academic-papers/{{p}}/view [- anon]` | 201 | 201 | same |
| `scenario lifecycle #15 PATCH /api/v1/academic-papers/{{p}}/publish [- admin]` | 200 | 200 | same |
| `scenario lifecycle #16 PATCH /api/v1/academic-papers/{{p}}/publish [- admin]` | 200 | 200 | same |
| `scenario lifecycle #17 PATCH /api/v1/academic-papers/{{p}}/publish [- admin]` | 400 | 400 | same |
| `scenario lifecycle #18 GET /api/v1/academic-papers/{{p}} [- anon]` | 404 | 404 | same |
| `scenario lifecycle #19 POST /api/v1/academic-papers/{{p}}/view [- anon]` | 404 | 404 | same |
| `scenario lifecycle #20 GET /api/v1/academic-papers/admin/{{p}} [- admin]` | 200 | 200 | same |
| `scenario lifecycle #21 PATCH /api/v1/academic-papers/{{p}}/publish [- admin]` | 200 | 200 | same |
| `scenario lifecycle #22 DELETE /api/v1/academic-papers/{{p}} [- admin]` | 200 | 200 | same |
| `scenario lifecycle #23 DELETE /api/v1/academic-papers/{{p}} [- admin]` | 404 | 404 | same |
| `scenario lifecycle #24 GET /api/v1/academic-papers/trash?limit=100 [- admin]` | 200 | 200 | same |
| `scenario lifecycle #25 DELETE /api/v1/academic-paper-categories/{{cat_b}} [- admin]` | 200 | 200 | same |
| `scenario lifecycle #26 POST /api/v1/academic-papers/{{p}}/restore [- admin]` | 409 | 409 | same |
| `scenario lifecycle #27 POST /api/v1/academic-paper-categories/{{cat_b}}/restore [- admin]` | 200 | 200 | same |
| `scenario lifecycle #28 POST /api/v1/academic-papers/{{p}}/restore [- admin]` | 200 | 200 | same |
| `scenario lifecycle #29 POST /api/v1/academic-papers/{{p}}/restore [- admin]` | 404 | 404 | same |
| `scenario lifecycle #30 GET /api/v1/academic-papers/{{p}} [- anon]` | 200 | 200 | same |

## Explanations

<!-- Everything above this heading is regenerated on every run; everything from it down is kept.
One bullet per explained diff: a backticked key, `*` matching anything, then why. Example:
- `GET /api/v1/posts* [*] $.data[*].views`: views are counted by the RL_VIEW binding now (D7).
-->
