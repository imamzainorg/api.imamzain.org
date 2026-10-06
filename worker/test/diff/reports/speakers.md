# Diff report: speakers

Nest (DB copy A) vs the Worker (DB copy B; unported routes fall through to a Nest on B), on the scrubbed prod dump of 2026-10-04.
Regenerate with `npm run diff -- speakers` in `worker/`.

- Requests: 47 (1 write scenario)
- Same: 47
- Diffs: 0, unexplained: 0
- Routes skipped: 0

## Requests

| Request | A | B | Result |
|---|---|---|---|
| `GET /api/v1/speakers [ar anon]` | 200 | 200 | same |
| `GET /api/v1/speakers [ar admin]` | 200 | 200 | same |
| `GET /api/v1/speakers [en anon]` | 200 | 200 | same |
| `GET /api/v1/speakers [en admin]` | 200 | 200 | same |
| `GET /api/v1/speakers [- anon]` | 200 | 200 | same |
| `GET /api/v1/speakers [- admin]` | 200 | 200 | same |
| `GET /api/v1/speakers?page=2&limit=5 [- anon]` | 200 | 200 | same |
| `GET /api/v1/speakers?page=2&limit=5 [- admin]` | 200 | 200 | same |
| `GET /api/v1/speakers/002edd76-0ef2-4ae0-bdc5-077da7bdea28 [ar anon]` | 200 | 200 | same |
| `GET /api/v1/speakers/002edd76-0ef2-4ae0-bdc5-077da7bdea28 [ar admin]` | 200 | 200 | same |
| `GET /api/v1/speakers/002edd76-0ef2-4ae0-bdc5-077da7bdea28 [en anon]` | 200 | 200 | same |
| `GET /api/v1/speakers/002edd76-0ef2-4ae0-bdc5-077da7bdea28 [en admin]` | 200 | 200 | same |
| `GET /api/v1/speakers/002edd76-0ef2-4ae0-bdc5-077da7bdea28 [- anon]` | 200 | 200 | same |
| `GET /api/v1/speakers/002edd76-0ef2-4ae0-bdc5-077da7bdea28 [- admin]` | 200 | 200 | same |
| `GET /api/v1/speakers/05dd5e03-1aef-4384-ad3a-0694d535e80a [ar anon]` | 200 | 200 | same |
| `GET /api/v1/speakers/05dd5e03-1aef-4384-ad3a-0694d535e80a [ar admin]` | 200 | 200 | same |
| `GET /api/v1/speakers/05dd5e03-1aef-4384-ad3a-0694d535e80a [en anon]` | 200 | 200 | same |
| `GET /api/v1/speakers/05dd5e03-1aef-4384-ad3a-0694d535e80a [en admin]` | 200 | 200 | same |
| `GET /api/v1/speakers/05dd5e03-1aef-4384-ad3a-0694d535e80a [- anon]` | 200 | 200 | same |
| `GET /api/v1/speakers/05dd5e03-1aef-4384-ad3a-0694d535e80a [- admin]` | 200 | 200 | same |
| `GET /api/v1/speakers/00000000-0000-4000-8000-000000000000 [ar anon]` | 404 | 404 | same |
| `GET /api/v1/speakers/00000000-0000-4000-8000-000000000000 [ar admin]` | 404 | 404 | same |
| `GET /api/v1/speakers/00000000-0000-4000-8000-000000000000 [en anon]` | 404 | 404 | same |
| `GET /api/v1/speakers/00000000-0000-4000-8000-000000000000 [en admin]` | 404 | 404 | same |
| `GET /api/v1/speakers/00000000-0000-4000-8000-000000000000 [- anon]` | 404 | 404 | same |
| `GET /api/v1/speakers/00000000-0000-4000-8000-000000000000 [- admin]` | 404 | 404 | same |
| `GET /api/v1/speakers/trash [ar anon]` | 401 | 401 | same |
| `GET /api/v1/speakers/trash [ar admin]` | 200 | 200 | same |
| `GET /api/v1/speakers/trash [en anon]` | 401 | 401 | same |
| `GET /api/v1/speakers/trash [en admin]` | 200 | 200 | same |
| `GET /api/v1/speakers/trash [- anon]` | 401 | 401 | same |
| `GET /api/v1/speakers/trash [- admin]` | 200 | 200 | same |
| `GET /api/v1/speakers/trash?page=2&limit=5 [- anon]` | 401 | 401 | same |
| `GET /api/v1/speakers/trash?page=2&limit=5 [- admin]` | 200 | 200 | same |
| `scenario lifecycle #1 POST /api/v1/speakers [- admin]` | 201 | 201 | same |
| `scenario lifecycle #2 GET /api/v1/speakers/{{spk}} [en anon]` | 200 | 200 | same |
| `scenario lifecycle #3 GET /api/v1/speakers?search=diff [- anon]` | 200 | 200 | same |
| `scenario lifecycle #4 PATCH /api/v1/speakers/{{spk}} [- admin]` | 200 | 200 | same |
| `scenario lifecycle #5 POST /api/v1/speakers [- admin]` | 400 | 400 | same |
| `scenario lifecycle #6 POST /api/v1/speakers [- admin]` | 409 | 409 | same |
| `scenario lifecycle #7 PATCH /api/v1/speakers/{{spk}} [- admin]` | 400 | 400 | same |
| `scenario lifecycle #8 DELETE /api/v1/speakers/{{spk}} [- admin]` | 200 | 200 | same |
| `scenario lifecycle #9 GET /api/v1/speakers/{{spk}} [- anon]` | 404 | 404 | same |
| `scenario lifecycle #10 GET /api/v1/speakers/trash?limit=100 [- admin]` | 200 | 200 | same |
| `scenario lifecycle #11 POST /api/v1/speakers/{{spk}}/restore [- admin]` | 200 | 200 | same |
| `scenario lifecycle #12 GET /api/v1/speakers/{{spk}} [- anon]` | 200 | 200 | same |
| `scenario lifecycle #13 POST /api/v1/speakers/{{spk}}/restore [- admin]` | 404 | 404 | same |

## Explanations

<!-- Everything above this heading is regenerated on every run; everything from it down is kept.
One bullet per explained diff: a backticked key, `*` matching anything, then why. Example:
- `GET /api/v1/posts* [*] $.data[*].views`: views are counted by the RL_VIEW binding now (D7).
-->
