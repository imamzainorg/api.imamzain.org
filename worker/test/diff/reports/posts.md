# Diff report: posts

Nest (DB copy A) vs the Worker (DB copy B; unported routes fall through to a Nest on B), on the scrubbed prod dump of 2026-10-04.
Regenerate with `npm run diff -- posts` in `worker/`.

- Requests: 142 (1 write scenario)
- Same: 142
- Diffs: 0, unexplained: 0
- Routes skipped: 0

## Requests

| Request | A | B | Result |
|---|---|---|---|
| `GET /api/v1/posts [ar anon]` | 200 | 200 | same |
| `GET /api/v1/posts [ar admin]` | 200 | 200 | same |
| `GET /api/v1/posts [en anon]` | 200 | 200 | same |
| `GET /api/v1/posts [en admin]` | 200 | 200 | same |
| `GET /api/v1/posts [- anon]` | 200 | 200 | same |
| `GET /api/v1/posts [- admin]` | 200 | 200 | same |
| `GET /api/v1/posts?page=2&limit=5 [- anon]` | 200 | 200 | same |
| `GET /api/v1/posts?page=2&limit=5 [- admin]` | 200 | 200 | same |
| `GET /api/v1/posts/0a504bae-26e7-484b-8d00-796052c49299 [ar anon]` | 200 | 200 | same |
| `GET /api/v1/posts/0a504bae-26e7-484b-8d00-796052c49299 [ar admin]` | 200 | 200 | same |
| `GET /api/v1/posts/0a504bae-26e7-484b-8d00-796052c49299 [en anon]` | 200 | 200 | same |
| `GET /api/v1/posts/0a504bae-26e7-484b-8d00-796052c49299 [en admin]` | 200 | 200 | same |
| `GET /api/v1/posts/0a504bae-26e7-484b-8d00-796052c49299 [- anon]` | 200 | 200 | same |
| `GET /api/v1/posts/0a504bae-26e7-484b-8d00-796052c49299 [- admin]` | 200 | 200 | same |
| `GET /api/v1/posts/0b273c1a-f155-4f86-b01d-d304908b6445 [ar anon]` | 200 | 200 | same |
| `GET /api/v1/posts/0b273c1a-f155-4f86-b01d-d304908b6445 [ar admin]` | 200 | 200 | same |
| `GET /api/v1/posts/0b273c1a-f155-4f86-b01d-d304908b6445 [en anon]` | 200 | 200 | same |
| `GET /api/v1/posts/0b273c1a-f155-4f86-b01d-d304908b6445 [en admin]` | 200 | 200 | same |
| `GET /api/v1/posts/0b273c1a-f155-4f86-b01d-d304908b6445 [- anon]` | 200 | 200 | same |
| `GET /api/v1/posts/0b273c1a-f155-4f86-b01d-d304908b6445 [- admin]` | 200 | 200 | same |
| `GET /api/v1/posts/00000000-0000-4000-8000-000000000000 [ar anon]` | 404 | 404 | same |
| `GET /api/v1/posts/00000000-0000-4000-8000-000000000000 [ar admin]` | 404 | 404 | same |
| `GET /api/v1/posts/00000000-0000-4000-8000-000000000000 [en anon]` | 404 | 404 | same |
| `GET /api/v1/posts/00000000-0000-4000-8000-000000000000 [en admin]` | 404 | 404 | same |
| `GET /api/v1/posts/00000000-0000-4000-8000-000000000000 [- anon]` | 404 | 404 | same |
| `GET /api/v1/posts/00000000-0000-4000-8000-000000000000 [- admin]` | 404 | 404 | same |
| `GET /api/v1/posts/admin [ar anon]` | 401 | 401 | same |
| `GET /api/v1/posts/admin [ar admin]` | 200 | 200 | same |
| `GET /api/v1/posts/admin [en anon]` | 401 | 401 | same |
| `GET /api/v1/posts/admin [en admin]` | 200 | 200 | same |
| `GET /api/v1/posts/admin [- anon]` | 401 | 401 | same |
| `GET /api/v1/posts/admin [- admin]` | 200 | 200 | same |
| `GET /api/v1/posts/admin?page=2&limit=5 [- anon]` | 401 | 401 | same |
| `GET /api/v1/posts/admin?page=2&limit=5 [- admin]` | 200 | 200 | same |
| `GET /api/v1/posts/admin/0a504bae-26e7-484b-8d00-796052c49299 [ar anon]` | 401 | 401 | same |
| `GET /api/v1/posts/admin/0a504bae-26e7-484b-8d00-796052c49299 [ar admin]` | 200 | 200 | same |
| `GET /api/v1/posts/admin/0a504bae-26e7-484b-8d00-796052c49299 [en anon]` | 401 | 401 | same |
| `GET /api/v1/posts/admin/0a504bae-26e7-484b-8d00-796052c49299 [en admin]` | 200 | 200 | same |
| `GET /api/v1/posts/admin/0a504bae-26e7-484b-8d00-796052c49299 [- anon]` | 401 | 401 | same |
| `GET /api/v1/posts/admin/0a504bae-26e7-484b-8d00-796052c49299 [- admin]` | 200 | 200 | same |
| `GET /api/v1/posts/admin/0b273c1a-f155-4f86-b01d-d304908b6445 [ar anon]` | 401 | 401 | same |
| `GET /api/v1/posts/admin/0b273c1a-f155-4f86-b01d-d304908b6445 [ar admin]` | 200 | 200 | same |
| `GET /api/v1/posts/admin/0b273c1a-f155-4f86-b01d-d304908b6445 [en anon]` | 401 | 401 | same |
| `GET /api/v1/posts/admin/0b273c1a-f155-4f86-b01d-d304908b6445 [en admin]` | 200 | 200 | same |
| `GET /api/v1/posts/admin/0b273c1a-f155-4f86-b01d-d304908b6445 [- anon]` | 401 | 401 | same |
| `GET /api/v1/posts/admin/0b273c1a-f155-4f86-b01d-d304908b6445 [- admin]` | 200 | 200 | same |
| `GET /api/v1/posts/admin/00000000-0000-4000-8000-000000000000 [ar anon]` | 401 | 401 | same |
| `GET /api/v1/posts/admin/00000000-0000-4000-8000-000000000000 [ar admin]` | 404 | 404 | same |
| `GET /api/v1/posts/admin/00000000-0000-4000-8000-000000000000 [en anon]` | 401 | 401 | same |
| `GET /api/v1/posts/admin/00000000-0000-4000-8000-000000000000 [en admin]` | 404 | 404 | same |
| `GET /api/v1/posts/admin/00000000-0000-4000-8000-000000000000 [- anon]` | 401 | 401 | same |
| `GET /api/v1/posts/admin/00000000-0000-4000-8000-000000000000 [- admin]` | 404 | 404 | same |
| `GET /api/v1/posts/by-slug/10000-successful-surgeries-lady-khadija-hospital [ar anon]` | 200 | 200 | same |
| `GET /api/v1/posts/by-slug/10000-successful-surgeries-lady-khadija-hospital [ar admin]` | 200 | 200 | same |
| `GET /api/v1/posts/by-slug/10000-successful-surgeries-lady-khadija-hospital [en anon]` | 200 | 200 | same |
| `GET /api/v1/posts/by-slug/10000-successful-surgeries-lady-khadija-hospital [en admin]` | 200 | 200 | same |
| `GET /api/v1/posts/by-slug/10000-successful-surgeries-lady-khadija-hospital [- anon]` | 200 | 200 | same |
| `GET /api/v1/posts/by-slug/10000-successful-surgeries-lady-khadija-hospital [- admin]` | 200 | 200 | same |
| `GET /api/v1/posts/by-slug/al-thaqalayn-cancer-hospital-basra-unveils-development-plan-on-first-anniversary [ar anon]` | 200 | 200 | same |
| `GET /api/v1/posts/by-slug/al-thaqalayn-cancer-hospital-basra-unveils-development-plan-on-first-anniversary [ar admin]` | 200 | 200 | same |
| `GET /api/v1/posts/by-slug/al-thaqalayn-cancer-hospital-basra-unveils-development-plan-on-first-anniversary [en anon]` | 200 | 200 | same |
| `GET /api/v1/posts/by-slug/al-thaqalayn-cancer-hospital-basra-unveils-development-plan-on-first-anniversary [en admin]` | 200 | 200 | same |
| `GET /api/v1/posts/by-slug/al-thaqalayn-cancer-hospital-basra-unveils-development-plan-on-first-anniversary [- anon]` | 200 | 200 | same |
| `GET /api/v1/posts/by-slug/al-thaqalayn-cancer-hospital-basra-unveils-development-plan-on-first-anniversary [- admin]` | 200 | 200 | same |
| `GET /api/v1/posts/by-slug/does-not-exist [ar anon]` | 404 | 404 | same |
| `GET /api/v1/posts/by-slug/does-not-exist [ar admin]` | 404 | 404 | same |
| `GET /api/v1/posts/by-slug/does-not-exist [en anon]` | 404 | 404 | same |
| `GET /api/v1/posts/by-slug/does-not-exist [en admin]` | 404 | 404 | same |
| `GET /api/v1/posts/by-slug/does-not-exist [- anon]` | 404 | 404 | same |
| `GET /api/v1/posts/by-slug/does-not-exist [- admin]` | 404 | 404 | same |
| `GET /api/v1/posts/trash [ar anon]` | 401 | 401 | same |
| `GET /api/v1/posts/trash [ar admin]` | 200 | 200 | same |
| `GET /api/v1/posts/trash [en anon]` | 401 | 401 | same |
| `GET /api/v1/posts/trash [en admin]` | 200 | 200 | same |
| `GET /api/v1/posts/trash [- anon]` | 401 | 401 | same |
| `GET /api/v1/posts/trash [- admin]` | 200 | 200 | same |
| `GET /api/v1/posts/trash?page=2&limit=5 [- anon]` | 401 | 401 | same |
| `GET /api/v1/posts/trash?page=2&limit=5 [- admin]` | 200 | 200 | same |
| `scenario lifecycle #1 POST /api/v1/post-categories [- admin]` | 201 | 201 | same |
| `scenario lifecycle #2 POST /api/v1/post-categories [- admin]` | 201 | 201 | same |
| `scenario lifecycle #3 GET /api/v1/books/admin?limit=1 [- admin]` | 200 | 200 | same |
| `scenario lifecycle #4 POST /api/v1/posts [- admin]` | 201 | 201 | same |
| `scenario lifecycle #5 POST /api/v1/posts [- admin]` | 201 | 201 | same |
| `scenario lifecycle #6 POST /api/v1/posts [- admin]` | 201 | 201 | same |
| `scenario lifecycle #7 POST /api/v1/posts [- admin]` | 201 | 201 | same |
| `scenario lifecycle #8 POST /api/v1/posts [- admin]` | 404 | 404 | same |
| `scenario lifecycle #9 POST /api/v1/posts [- admin]` | 404 | 404 | same |
| `scenario lifecycle #10 POST /api/v1/posts [- admin]` | 404 | 404 | same |
| `scenario lifecycle #11 POST /api/v1/posts [- admin]` | 400 | 400 | same |
| `scenario lifecycle #12 POST /api/v1/posts [- admin]` | 409 | 409 | same |
| `scenario lifecycle #13 POST /api/v1/posts [- admin]` | 409 | 409 | same |
| `scenario lifecycle #14 POST /api/v1/posts [- admin]` | 400 | 400 | same |
| `scenario lifecycle #15 POST /api/v1/posts [- admin]` | 400 | 400 | same |
| `scenario lifecycle #16 GET /api/v1/posts/{{a}} [- anon]` | 404 | 404 | same |
| `scenario lifecycle #17 GET /api/v1/posts/{{a}} [en anon]` | 404 | 404 | same |
| `scenario lifecycle #18 GET /api/v1/posts/{{b}} [- anon]` | 200 | 200 | same |
| `scenario lifecycle #19 GET /api/v1/posts/{{c}} [- anon]` | 404 | 404 | same |
| `scenario lifecycle #20 GET /api/v1/posts/admin/{{a}} [en admin]` | 200 | 200 | same |
| `scenario lifecycle #21 GET /api/v1/posts/admin/{{d}} [- admin]` | 200 | 200 | same |
| `scenario lifecycle #22 GET /api/v1/posts/by-slug/diff-posts-two [- anon]` | 200 | 200 | same |
| `scenario lifecycle #23 GET /api/v1/posts/by-slug/diff-posts-future [- anon]` | 404 | 404 | same |
| `scenario lifecycle #24 GET /api/v1/posts?category_id={{cat_a}} [- anon]` | 200 | 200 | same |
| `scenario lifecycle #25 GET /api/v1/posts?category_id={{cat_a}}&featured=true&sort=views [en anon]` | 200 | 200 | same |
| `scenario lifecycle #26 GET /api/v1/posts?category_id={{cat_a}}&search=Diff [- anon]` | 200 | 200 | same |
| `scenario lifecycle #27 GET /api/v1/posts/admin?category_id={{cat_a}}&status=scheduled [- admin]` | 200 | 200 | same |
| `scenario lifecycle #28 GET /api/v1/posts/admin?category_id={{cat_a}}&status=draft [- admin]` | 200 | 200 | same |
| `scenario lifecycle #29 GET /api/v1/posts/admin?category_id={{cat_a}}&status=published [- admin]` | 200 | 200 | same |
| `scenario lifecycle #30 POST /api/v1/posts/{{b}}/view [- anon]` | 201 | 201 | same |
| `scenario lifecycle #31 POST /api/v1/posts/{{c}}/view [- anon]` | 404 | 404 | same |
| `scenario lifecycle #32 PATCH /api/v1/posts/{{a}} [- admin]` | 200 | 200 | same |
| `scenario lifecycle #33 PATCH /api/v1/posts/{{a}} [- admin]` | 200 | 200 | same |
| `scenario lifecycle #34 PATCH /api/v1/posts/{{a}} [- admin]` | 400 | 400 | same |
| `scenario lifecycle #35 PATCH /api/v1/posts/{{a}} [- admin]` | 404 | 404 | same |
| `scenario lifecycle #36 PATCH /api/v1/posts/{{a}} [- admin]` | 404 | 404 | same |
| `scenario lifecycle #37 PATCH /api/v1/posts/{{a}} [- admin]` | 409 | 409 | same |
| `scenario lifecycle #38 PATCH /api/v1/posts/{{a}} [- admin]` | 200 | 200 | same |
| `scenario lifecycle #39 PATCH /api/v1/posts/{{b}} [- admin]` | 409 | 409 | same |
| `scenario lifecycle #40 PATCH /api/v1/posts/{{b}} [- admin]` | 200 | 200 | same |
| `scenario lifecycle #41 PATCH /api/v1/posts/{{a}}/publish [- admin]` | 200 | 200 | same |
| `scenario lifecycle #42 PATCH /api/v1/posts/{{a}}/publish [- admin]` | 200 | 200 | same |
| `scenario lifecycle #43 PATCH /api/v1/posts/{{a}}/publish [- admin]` | 400 | 400 | same |
| `scenario lifecycle #44 PATCH /api/v1/posts/{{c}}/publish [- admin]` | 200 | 200 | same |
| `scenario lifecycle #45 PATCH /api/v1/posts/{{c}}/publish [- admin]` | 200 | 200 | same |
| `scenario lifecycle #46 POST /api/v1/posts/bulk/publish [- admin]` | 200 | 200 | same |
| `scenario lifecycle #47 POST /api/v1/posts/bulk/publish [- admin]` | 200 | 200 | same |
| `scenario lifecycle #48 POST /api/v1/posts/bulk/publish [- admin]` | 400 | 400 | same |
| `scenario lifecycle #49 POST /api/v1/posts/bulk/publish [- admin]` | 400 | 400 | same |
| `scenario lifecycle #50 POST /api/v1/posts/bulk/delete [- admin]` | 200 | 200 | same |
| `scenario lifecycle #51 POST /api/v1/posts/bulk/delete [- admin]` | 200 | 200 | same |
| `scenario lifecycle #52 DELETE /api/v1/posts/{{d}} [- admin]` | 200 | 200 | same |
| `scenario lifecycle #53 DELETE /api/v1/posts/{{a}} [- admin]` | 200 | 200 | same |
| `scenario lifecycle #54 DELETE /api/v1/posts/{{a}} [- admin]` | 404 | 404 | same |
| `scenario lifecycle #55 GET /api/v1/posts/trash?limit=100 [- admin]` | 200 | 200 | same |
| `scenario lifecycle #56 POST /api/v1/posts/{{c}}/restore [- admin]` | 200 | 200 | same |
| `scenario lifecycle #57 POST /api/v1/posts/{{a}}/restore [- admin]` | 200 | 200 | same |
| `scenario lifecycle #58 POST /api/v1/posts/{{a}}/restore [- admin]` | 404 | 404 | same |
| `scenario lifecycle #59 POST /api/v1/posts [- admin]` | 201 | 201 | same |
| `scenario lifecycle #60 DELETE /api/v1/posts/{{b}} [- admin]` | 200 | 200 | same |
| `scenario lifecycle #61 DELETE /api/v1/posts/{{a}} [- admin]` | 200 | 200 | same |
| `scenario lifecycle #62 DELETE /api/v1/post-categories/{{cat_b}} [- admin]` | 200 | 200 | same |
| `scenario lifecycle #63 POST /api/v1/posts/{{a}}/restore [- admin]` | 409 | 409 | same |
| `scenario lifecycle #64 GET /api/v1/posts/{{a}} [- anon]` | 404 | 404 | same |

## Explanations

<!-- Everything above this heading is regenerated on every run; everything from it down is kept.
One bullet per explained diff: a backticked key, `*` matching anything, then why. Example:
- `GET /api/v1/posts* [*] $.data[*].views`: views are counted by the RL_VIEW binding now (D7).
-->
