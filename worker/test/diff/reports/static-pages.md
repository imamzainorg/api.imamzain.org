# Diff report: static-pages

Nest (DB copy A) vs the Worker (DB copy B; unported routes fall through to a Nest on B), on the scrubbed prod dump of 2026-10-04.
Regenerate with `npm run diff -- static-pages` in `worker/`.

- Requests: 109 (1 write scenario)
- Same: 109
- Diffs: 0, unexplained: 0
- Routes skipped: 0

## Requests

| Request | A | B | Result |
|---|---|---|---|
| `GET /api/v1/static-pages [ar anon]` | 200 | 200 | same |
| `GET /api/v1/static-pages [ar admin]` | 200 | 200 | same |
| `GET /api/v1/static-pages [en anon]` | 200 | 200 | same |
| `GET /api/v1/static-pages [en admin]` | 200 | 200 | same |
| `GET /api/v1/static-pages [- anon]` | 200 | 200 | same |
| `GET /api/v1/static-pages [- admin]` | 200 | 200 | same |
| `GET /api/v1/static-pages?page=2&limit=5 [- anon]` | 200 | 200 | same |
| `GET /api/v1/static-pages?page=2&limit=5 [- admin]` | 200 | 200 | same |
| `GET /api/v1/static-pages/0cf0578e-eafd-453e-b979-5a19981594dc [ar anon]` | 200 | 200 | same |
| `GET /api/v1/static-pages/0cf0578e-eafd-453e-b979-5a19981594dc [ar admin]` | 200 | 200 | same |
| `GET /api/v1/static-pages/0cf0578e-eafd-453e-b979-5a19981594dc [en anon]` | 200 | 200 | same |
| `GET /api/v1/static-pages/0cf0578e-eafd-453e-b979-5a19981594dc [en admin]` | 200 | 200 | same |
| `GET /api/v1/static-pages/0cf0578e-eafd-453e-b979-5a19981594dc [- anon]` | 200 | 200 | same |
| `GET /api/v1/static-pages/0cf0578e-eafd-453e-b979-5a19981594dc [- admin]` | 200 | 200 | same |
| `GET /api/v1/static-pages/11c47ea5-1dfc-48fe-9d83-670f2f17ba1a [ar anon]` | 200 | 200 | same |
| `GET /api/v1/static-pages/11c47ea5-1dfc-48fe-9d83-670f2f17ba1a [ar admin]` | 200 | 200 | same |
| `GET /api/v1/static-pages/11c47ea5-1dfc-48fe-9d83-670f2f17ba1a [en anon]` | 200 | 200 | same |
| `GET /api/v1/static-pages/11c47ea5-1dfc-48fe-9d83-670f2f17ba1a [en admin]` | 200 | 200 | same |
| `GET /api/v1/static-pages/11c47ea5-1dfc-48fe-9d83-670f2f17ba1a [- anon]` | 200 | 200 | same |
| `GET /api/v1/static-pages/11c47ea5-1dfc-48fe-9d83-670f2f17ba1a [- admin]` | 200 | 200 | same |
| `GET /api/v1/static-pages/00000000-0000-4000-8000-000000000000 [ar anon]` | 404 | 404 | same |
| `GET /api/v1/static-pages/00000000-0000-4000-8000-000000000000 [ar admin]` | 404 | 404 | same |
| `GET /api/v1/static-pages/00000000-0000-4000-8000-000000000000 [en anon]` | 404 | 404 | same |
| `GET /api/v1/static-pages/00000000-0000-4000-8000-000000000000 [en admin]` | 404 | 404 | same |
| `GET /api/v1/static-pages/00000000-0000-4000-8000-000000000000 [- anon]` | 404 | 404 | same |
| `GET /api/v1/static-pages/00000000-0000-4000-8000-000000000000 [- admin]` | 404 | 404 | same |
| `GET /api/v1/static-pages/admin [ar anon]` | 401 | 401 | same |
| `GET /api/v1/static-pages/admin [ar admin]` | 200 | 200 | same |
| `GET /api/v1/static-pages/admin [en anon]` | 401 | 401 | same |
| `GET /api/v1/static-pages/admin [en admin]` | 200 | 200 | same |
| `GET /api/v1/static-pages/admin [- anon]` | 401 | 401 | same |
| `GET /api/v1/static-pages/admin [- admin]` | 200 | 200 | same |
| `GET /api/v1/static-pages/admin?page=2&limit=5 [- anon]` | 401 | 401 | same |
| `GET /api/v1/static-pages/admin?page=2&limit=5 [- admin]` | 200 | 200 | same |
| `GET /api/v1/static-pages/admin/0cf0578e-eafd-453e-b979-5a19981594dc [ar anon]` | 401 | 401 | same |
| `GET /api/v1/static-pages/admin/0cf0578e-eafd-453e-b979-5a19981594dc [ar admin]` | 200 | 200 | same |
| `GET /api/v1/static-pages/admin/0cf0578e-eafd-453e-b979-5a19981594dc [en anon]` | 401 | 401 | same |
| `GET /api/v1/static-pages/admin/0cf0578e-eafd-453e-b979-5a19981594dc [en admin]` | 200 | 200 | same |
| `GET /api/v1/static-pages/admin/0cf0578e-eafd-453e-b979-5a19981594dc [- anon]` | 401 | 401 | same |
| `GET /api/v1/static-pages/admin/0cf0578e-eafd-453e-b979-5a19981594dc [- admin]` | 200 | 200 | same |
| `GET /api/v1/static-pages/admin/11c47ea5-1dfc-48fe-9d83-670f2f17ba1a [ar anon]` | 401 | 401 | same |
| `GET /api/v1/static-pages/admin/11c47ea5-1dfc-48fe-9d83-670f2f17ba1a [ar admin]` | 200 | 200 | same |
| `GET /api/v1/static-pages/admin/11c47ea5-1dfc-48fe-9d83-670f2f17ba1a [en anon]` | 401 | 401 | same |
| `GET /api/v1/static-pages/admin/11c47ea5-1dfc-48fe-9d83-670f2f17ba1a [en admin]` | 200 | 200 | same |
| `GET /api/v1/static-pages/admin/11c47ea5-1dfc-48fe-9d83-670f2f17ba1a [- anon]` | 401 | 401 | same |
| `GET /api/v1/static-pages/admin/11c47ea5-1dfc-48fe-9d83-670f2f17ba1a [- admin]` | 200 | 200 | same |
| `GET /api/v1/static-pages/admin/00000000-0000-4000-8000-000000000000 [ar anon]` | 401 | 401 | same |
| `GET /api/v1/static-pages/admin/00000000-0000-4000-8000-000000000000 [ar admin]` | 404 | 404 | same |
| `GET /api/v1/static-pages/admin/00000000-0000-4000-8000-000000000000 [en anon]` | 401 | 401 | same |
| `GET /api/v1/static-pages/admin/00000000-0000-4000-8000-000000000000 [en admin]` | 404 | 404 | same |
| `GET /api/v1/static-pages/admin/00000000-0000-4000-8000-000000000000 [- anon]` | 401 | 401 | same |
| `GET /api/v1/static-pages/admin/00000000-0000-4000-8000-000000000000 [- admin]` | 404 | 404 | same |
| `GET /api/v1/static-pages/by-slug/abraz-ashabahu-wa-muasirih [ar anon]` | 200 | 200 | same |
| `GET /api/v1/static-pages/by-slug/abraz-ashabahu-wa-muasirih [ar admin]` | 200 | 200 | same |
| `GET /api/v1/static-pages/by-slug/abraz-ashabahu-wa-muasirih [en anon]` | 200 | 200 | same |
| `GET /api/v1/static-pages/by-slug/abraz-ashabahu-wa-muasirih [en admin]` | 200 | 200 | same |
| `GET /api/v1/static-pages/by-slug/abraz-ashabahu-wa-muasirih [- anon]` | 200 | 200 | same |
| `GET /api/v1/static-pages/by-slug/abraz-ashabahu-wa-muasirih [- admin]` | 200 | 200 | same |
| `GET /api/v1/static-pages/by-slug/al-khutab [ar anon]` | 200 | 200 | same |
| `GET /api/v1/static-pages/by-slug/al-khutab [ar admin]` | 200 | 200 | same |
| `GET /api/v1/static-pages/by-slug/al-khutab [en anon]` | 200 | 200 | same |
| `GET /api/v1/static-pages/by-slug/al-khutab [en admin]` | 200 | 200 | same |
| `GET /api/v1/static-pages/by-slug/al-khutab [- anon]` | 200 | 200 | same |
| `GET /api/v1/static-pages/by-slug/al-khutab [- admin]` | 200 | 200 | same |
| `GET /api/v1/static-pages/by-slug/does-not-exist [ar anon]` | 404 | 404 | same |
| `GET /api/v1/static-pages/by-slug/does-not-exist [ar admin]` | 404 | 404 | same |
| `GET /api/v1/static-pages/by-slug/does-not-exist [en anon]` | 404 | 404 | same |
| `GET /api/v1/static-pages/by-slug/does-not-exist [en admin]` | 404 | 404 | same |
| `GET /api/v1/static-pages/by-slug/does-not-exist [- anon]` | 404 | 404 | same |
| `GET /api/v1/static-pages/by-slug/does-not-exist [- admin]` | 404 | 404 | same |
| `GET /api/v1/static-pages/trash [ar anon]` | 401 | 401 | same |
| `GET /api/v1/static-pages/trash [ar admin]` | 200 | 200 | same |
| `GET /api/v1/static-pages/trash [en anon]` | 401 | 401 | same |
| `GET /api/v1/static-pages/trash [en admin]` | 200 | 200 | same |
| `GET /api/v1/static-pages/trash [- anon]` | 401 | 401 | same |
| `GET /api/v1/static-pages/trash [- admin]` | 200 | 200 | same |
| `GET /api/v1/static-pages/trash?page=2&limit=5 [- anon]` | 401 | 401 | same |
| `GET /api/v1/static-pages/trash?page=2&limit=5 [- admin]` | 200 | 200 | same |
| `scenario lifecycle #1 POST /api/v1/static-pages [- admin]` | 201 | 201 | same |
| `scenario lifecycle #2 GET /api/v1/static-pages/{{pg}} [en anon]` | 200 | 200 | same |
| `scenario lifecycle #3 GET /api/v1/static-pages/by-slug/diff-page [- anon]` | 200 | 200 | same |
| `scenario lifecycle #4 GET /api/v1/static-pages/admin?limit=100 [- admin]` | 200 | 200 | same |
| `scenario lifecycle #5 GET /api/v1/static-pages/admin?is_published=false [- admin]` | 200 | 200 | same |
| `scenario lifecycle #6 GET /api/v1/static-pages/admin?is_published=yes [- admin]` | 400 | 400 | same |
| `scenario lifecycle #7 POST /api/v1/static-pages [- admin]` | 409 | 409 | same |
| `scenario lifecycle #8 POST /api/v1/static-pages [- admin]` | 400 | 400 | same |
| `scenario lifecycle #9 POST /api/v1/static-pages [- admin]` | 409 | 409 | same |
| `scenario lifecycle #10 POST /api/v1/static-pages [- admin]` | 404 | 404 | same |
| `scenario lifecycle #11 POST /api/v1/static-pages [- admin]` | 400 | 400 | same |
| `scenario lifecycle #12 PATCH /api/v1/static-pages/{{pg}} [- admin]` | 409 | 409 | same |
| `scenario lifecycle #13 PATCH /api/v1/static-pages/{{pg}} [- admin]` | 200 | 200 | same |
| `scenario lifecycle #14 PATCH /api/v1/static-pages/{{pg}} [- admin]` | 400 | 400 | same |
| `scenario lifecycle #15 PATCH /api/v1/static-pages/{{pg}}/publish [- admin]` | 200 | 200 | same |
| `scenario lifecycle #16 PATCH /api/v1/static-pages/{{pg}} [- admin]` | 200 | 200 | same |
| `scenario lifecycle #17 GET /api/v1/static-pages/{{pg}} [- anon]` | 404 | 404 | same |
| `scenario lifecycle #18 GET /api/v1/static-pages/by-slug/diff-renamed [- anon]` | 404 | 404 | same |
| `scenario lifecycle #19 GET /api/v1/static-pages/admin/{{pg}} [- admin]` | 200 | 200 | same |
| `scenario lifecycle #20 PATCH /api/v1/static-pages/{{pg}}/publish [- admin]` | 200 | 200 | same |
| `scenario lifecycle #21 PATCH /api/v1/static-pages/{{pg}}/publish [- admin]` | 400 | 400 | same |
| `scenario lifecycle #22 DELETE /api/v1/static-pages/{{pg}} [- admin]` | 200 | 200 | same |
| `scenario lifecycle #23 DELETE /api/v1/static-pages/{{pg}} [- admin]` | 404 | 404 | same |
| `scenario lifecycle #24 GET /api/v1/static-pages/{{pg}} [- anon]` | 404 | 404 | same |
| `scenario lifecycle #25 GET /api/v1/static-pages/trash?limit=100 [- admin]` | 200 | 200 | same |
| `scenario lifecycle #26 POST /api/v1/static-pages [- admin]` | 201 | 201 | same |
| `scenario lifecycle #27 POST /api/v1/static-pages/{{pg}}/restore [- admin]` | 409 | 409 | same |
| `scenario lifecycle #28 DELETE /api/v1/static-pages/{{taker}} [- admin]` | 200 | 200 | same |
| `scenario lifecycle #29 POST /api/v1/static-pages/{{pg}}/restore [- admin]` | 200 | 200 | same |
| `scenario lifecycle #30 POST /api/v1/static-pages/{{pg}}/restore [- admin]` | 404 | 404 | same |
| `scenario lifecycle #31 GET /api/v1/static-pages/by-slug/diff-renamed [- anon]` | 200 | 200 | same |

## Explanations

<!-- Everything above this heading is regenerated on every run; everything from it down is kept.
One bullet per explained diff: a backticked key, `*` matching anything, then why. Example:
- `GET /api/v1/posts* [*] $.data[*].views`: views are counted by the RL_VIEW binding now (D7).
-->
