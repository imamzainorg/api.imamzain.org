# Diff report: gallery

Nest (DB copy A) vs the Worker (DB copy B; unported routes fall through to a Nest on B), on the scrubbed prod dump of 2026-10-04.
Regenerate with `npm run diff -- gallery` in `worker/`.

- Requests: 88 (1 write scenario)
- Same: 88
- Diffs: 0, unexplained: 0
- Routes skipped: 0

## Requests

| Request | A | B | Result |
|---|---|---|---|
| `GET /api/v1/gallery [ar anon]` | 200 | 200 | same |
| `GET /api/v1/gallery [ar admin]` | 200 | 200 | same |
| `GET /api/v1/gallery [en anon]` | 200 | 200 | same |
| `GET /api/v1/gallery [en admin]` | 200 | 200 | same |
| `GET /api/v1/gallery [- anon]` | 200 | 200 | same |
| `GET /api/v1/gallery [- admin]` | 200 | 200 | same |
| `GET /api/v1/gallery?page=2&limit=5 [- anon]` | 200 | 200 | same |
| `GET /api/v1/gallery?page=2&limit=5 [- admin]` | 200 | 200 | same |
| `GET /api/v1/gallery/00f6cc72-cc5e-4c8e-b47a-df149825596d [ar anon]` | 200 | 200 | same |
| `GET /api/v1/gallery/00f6cc72-cc5e-4c8e-b47a-df149825596d [ar admin]` | 200 | 200 | same |
| `GET /api/v1/gallery/00f6cc72-cc5e-4c8e-b47a-df149825596d [en anon]` | 200 | 200 | same |
| `GET /api/v1/gallery/00f6cc72-cc5e-4c8e-b47a-df149825596d [en admin]` | 200 | 200 | same |
| `GET /api/v1/gallery/00f6cc72-cc5e-4c8e-b47a-df149825596d [- anon]` | 200 | 200 | same |
| `GET /api/v1/gallery/00f6cc72-cc5e-4c8e-b47a-df149825596d [- admin]` | 200 | 200 | same |
| `GET /api/v1/gallery/01ccdfac-ea40-45ac-a93f-7886db0e1f5e [ar anon]` | 200 | 200 | same |
| `GET /api/v1/gallery/01ccdfac-ea40-45ac-a93f-7886db0e1f5e [ar admin]` | 200 | 200 | same |
| `GET /api/v1/gallery/01ccdfac-ea40-45ac-a93f-7886db0e1f5e [en anon]` | 200 | 200 | same |
| `GET /api/v1/gallery/01ccdfac-ea40-45ac-a93f-7886db0e1f5e [en admin]` | 200 | 200 | same |
| `GET /api/v1/gallery/01ccdfac-ea40-45ac-a93f-7886db0e1f5e [- anon]` | 200 | 200 | same |
| `GET /api/v1/gallery/01ccdfac-ea40-45ac-a93f-7886db0e1f5e [- admin]` | 200 | 200 | same |
| `GET /api/v1/gallery/does-not-exist [ar anon]` | 400 | 400 | same |
| `GET /api/v1/gallery/does-not-exist [ar admin]` | 400 | 400 | same |
| `GET /api/v1/gallery/does-not-exist [en anon]` | 400 | 400 | same |
| `GET /api/v1/gallery/does-not-exist [en admin]` | 400 | 400 | same |
| `GET /api/v1/gallery/does-not-exist [- anon]` | 400 | 400 | same |
| `GET /api/v1/gallery/does-not-exist [- admin]` | 400 | 400 | same |
| `GET /api/v1/gallery/admin [ar anon]` | 401 | 401 | same |
| `GET /api/v1/gallery/admin [ar admin]` | 200 | 200 | same |
| `GET /api/v1/gallery/admin [en anon]` | 401 | 401 | same |
| `GET /api/v1/gallery/admin [en admin]` | 200 | 200 | same |
| `GET /api/v1/gallery/admin [- anon]` | 401 | 401 | same |
| `GET /api/v1/gallery/admin [- admin]` | 200 | 200 | same |
| `GET /api/v1/gallery/admin?page=2&limit=5 [- anon]` | 401 | 401 | same |
| `GET /api/v1/gallery/admin?page=2&limit=5 [- admin]` | 200 | 200 | same |
| `GET /api/v1/gallery/admin/00f6cc72-cc5e-4c8e-b47a-df149825596d [ar anon]` | 401 | 401 | same |
| `GET /api/v1/gallery/admin/00f6cc72-cc5e-4c8e-b47a-df149825596d [ar admin]` | 200 | 200 | same |
| `GET /api/v1/gallery/admin/00f6cc72-cc5e-4c8e-b47a-df149825596d [en anon]` | 401 | 401 | same |
| `GET /api/v1/gallery/admin/00f6cc72-cc5e-4c8e-b47a-df149825596d [en admin]` | 200 | 200 | same |
| `GET /api/v1/gallery/admin/00f6cc72-cc5e-4c8e-b47a-df149825596d [- anon]` | 401 | 401 | same |
| `GET /api/v1/gallery/admin/00f6cc72-cc5e-4c8e-b47a-df149825596d [- admin]` | 200 | 200 | same |
| `GET /api/v1/gallery/admin/01ccdfac-ea40-45ac-a93f-7886db0e1f5e [ar anon]` | 401 | 401 | same |
| `GET /api/v1/gallery/admin/01ccdfac-ea40-45ac-a93f-7886db0e1f5e [ar admin]` | 200 | 200 | same |
| `GET /api/v1/gallery/admin/01ccdfac-ea40-45ac-a93f-7886db0e1f5e [en anon]` | 401 | 401 | same |
| `GET /api/v1/gallery/admin/01ccdfac-ea40-45ac-a93f-7886db0e1f5e [en admin]` | 200 | 200 | same |
| `GET /api/v1/gallery/admin/01ccdfac-ea40-45ac-a93f-7886db0e1f5e [- anon]` | 401 | 401 | same |
| `GET /api/v1/gallery/admin/01ccdfac-ea40-45ac-a93f-7886db0e1f5e [- admin]` | 200 | 200 | same |
| `GET /api/v1/gallery/admin/does-not-exist [ar anon]` | 401 | 401 | same |
| `GET /api/v1/gallery/admin/does-not-exist [ar admin]` | 400 | 400 | same |
| `GET /api/v1/gallery/admin/does-not-exist [en anon]` | 401 | 401 | same |
| `GET /api/v1/gallery/admin/does-not-exist [en admin]` | 400 | 400 | same |
| `GET /api/v1/gallery/admin/does-not-exist [- anon]` | 401 | 401 | same |
| `GET /api/v1/gallery/admin/does-not-exist [- admin]` | 400 | 400 | same |
| `GET /api/v1/gallery/trash [ar anon]` | 401 | 401 | same |
| `GET /api/v1/gallery/trash [ar admin]` | 200 | 200 | same |
| `GET /api/v1/gallery/trash [en anon]` | 401 | 401 | same |
| `GET /api/v1/gallery/trash [en admin]` | 200 | 200 | same |
| `GET /api/v1/gallery/trash [- anon]` | 401 | 401 | same |
| `GET /api/v1/gallery/trash [- admin]` | 200 | 200 | same |
| `GET /api/v1/gallery/trash?page=2&limit=5 [- anon]` | 401 | 401 | same |
| `GET /api/v1/gallery/trash?page=2&limit=5 [- admin]` | 200 | 200 | same |
| `scenario lifecycle #1 GET /api/v1/gallery/admin?limit=100 [- admin]` | 200 | 200 | same |
| `scenario lifecycle #2 POST /api/v1/gallery [- admin]` | 409 | 409 | same |
| `scenario lifecycle #3 POST /api/v1/gallery [- admin]` | 404 | 404 | same |
| `scenario lifecycle #4 POST /api/v1/gallery [- admin]` | 400 | 400 | same |
| `scenario lifecycle #5 POST /api/v1/gallery [- admin]` | 400 | 400 | same |
| `scenario lifecycle #6 PATCH /api/v1/gallery/{{media_a}} [- admin]` | 200 | 200 | same |
| `scenario lifecycle #7 PATCH /api/v1/gallery/{{media_a}} [- admin]` | 404 | 404 | same |
| `scenario lifecycle #8 PATCH /api/v1/gallery/{{media_a}} [- admin]` | 404 | 404 | same |
| `scenario lifecycle #9 PATCH /api/v1/gallery/{{media_a}} [- admin]` | 400 | 400 | same |
| `scenario lifecycle #10 GET /api/v1/gallery?tags=diff-a&tags=diff-b [- anon]` | 200 | 200 | same |
| `scenario lifecycle #11 GET /api/v1/gallery?locations=Karbala&limit=5 [en anon]` | 200 | 200 | same |
| `scenario lifecycle #12 GET /api/v1/gallery/{{media_a}} [en anon]` | 200 | 200 | same |
| `scenario lifecycle #13 POST /api/v1/gallery/{{media_a}}/view [- anon]` | 201 | 201 | same |
| `scenario lifecycle #14 GET /api/v1/gallery/{{media_a}} [- anon]` | 200 | 200 | same |
| `scenario lifecycle #15 PATCH /api/v1/gallery/{{media_a}}/publish [- admin]` | 200 | 200 | same |
| `scenario lifecycle #16 PATCH /api/v1/gallery/{{media_a}}/publish [- admin]` | 200 | 200 | same |
| `scenario lifecycle #17 PATCH /api/v1/gallery/{{media_a}}/publish [- admin]` | 400 | 400 | same |
| `scenario lifecycle #18 GET /api/v1/gallery/{{media_a}} [- anon]` | 404 | 404 | same |
| `scenario lifecycle #19 POST /api/v1/gallery/{{media_a}}/view [- anon]` | 404 | 404 | same |
| `scenario lifecycle #20 GET /api/v1/gallery/admin/{{media_a}} [- admin]` | 200 | 200 | same |
| `scenario lifecycle #21 PATCH /api/v1/gallery/{{media_a}}/publish [- admin]` | 200 | 200 | same |
| `scenario lifecycle #22 DELETE /api/v1/gallery/{{media_a}} [- admin]` | 200 | 200 | same |
| `scenario lifecycle #23 DELETE /api/v1/gallery/{{media_a}} [- admin]` | 404 | 404 | same |
| `scenario lifecycle #24 POST /api/v1/gallery [- admin]` | 409 | 409 | same |
| `scenario lifecycle #25 GET /api/v1/gallery/trash?limit=100 [- admin]` | 200 | 200 | same |
| `scenario lifecycle #26 POST /api/v1/gallery/{{media_a}}/restore [- admin]` | 200 | 200 | same |
| `scenario lifecycle #27 POST /api/v1/gallery/{{media_a}}/restore [- admin]` | 404 | 404 | same |
| `scenario lifecycle #28 GET /api/v1/gallery/{{media_a}} [- anon]` | 200 | 200 | same |

## Explanations

<!-- Everything above this heading is regenerated on every run; everything from it down is kept.
One bullet per explained diff: a backticked key, `*` matching anything, then why. Example:
- `GET /api/v1/posts* [*] $.data[*].views`: views are counted by the RL_VIEW binding now (D7).
-->
