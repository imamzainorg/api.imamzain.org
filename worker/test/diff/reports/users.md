# Diff report: users

Nest (DB copy A) vs the Worker (DB copy B; unported routes fall through to a Nest on B), on the scrubbed prod dump of 2026-10-04.
Regenerate with `npm run diff -- users` in `worker/`.

- Requests: 48 (1 write scenario)
- Same: 48
- Diffs: 0, unexplained: 0
- Routes skipped: 0

## Requests

| Request | A | B | Result |
|---|---|---|---|
| `GET /api/v1/users [ar anon]` | 401 | 401 | same |
| `GET /api/v1/users [ar admin]` | 200 | 200 | same |
| `GET /api/v1/users [en anon]` | 401 | 401 | same |
| `GET /api/v1/users [en admin]` | 200 | 200 | same |
| `GET /api/v1/users [- anon]` | 401 | 401 | same |
| `GET /api/v1/users [- admin]` | 200 | 200 | same |
| `GET /api/v1/users?page=2&limit=5 [- anon]` | 401 | 401 | same |
| `GET /api/v1/users?page=2&limit=5 [- admin]` | 200 | 200 | same |
| `GET /api/v1/users/71c77750-8f3c-4755-9d7e-a2d938533ac2 [ar anon]` | 401 | 401 | same |
| `GET /api/v1/users/71c77750-8f3c-4755-9d7e-a2d938533ac2 [ar admin]` | 200 | 200 | same |
| `GET /api/v1/users/71c77750-8f3c-4755-9d7e-a2d938533ac2 [en anon]` | 401 | 401 | same |
| `GET /api/v1/users/71c77750-8f3c-4755-9d7e-a2d938533ac2 [en admin]` | 200 | 200 | same |
| `GET /api/v1/users/71c77750-8f3c-4755-9d7e-a2d938533ac2 [- anon]` | 401 | 401 | same |
| `GET /api/v1/users/71c77750-8f3c-4755-9d7e-a2d938533ac2 [- admin]` | 200 | 200 | same |
| `GET /api/v1/users/00000000-0000-4000-8000-000000000000 [ar anon]` | 401 | 401 | same |
| `GET /api/v1/users/00000000-0000-4000-8000-000000000000 [ar admin]` | 404 | 404 | same |
| `GET /api/v1/users/00000000-0000-4000-8000-000000000000 [en anon]` | 401 | 401 | same |
| `GET /api/v1/users/00000000-0000-4000-8000-000000000000 [en admin]` | 404 | 404 | same |
| `GET /api/v1/users/00000000-0000-4000-8000-000000000000 [- anon]` | 401 | 401 | same |
| `GET /api/v1/users/00000000-0000-4000-8000-000000000000 [- admin]` | 404 | 404 | same |
| `GET /api/v1/users/trash [ar anon]` | 401 | 401 | same |
| `GET /api/v1/users/trash [ar admin]` | 200 | 200 | same |
| `GET /api/v1/users/trash [en anon]` | 401 | 401 | same |
| `GET /api/v1/users/trash [en admin]` | 200 | 200 | same |
| `GET /api/v1/users/trash [- anon]` | 401 | 401 | same |
| `GET /api/v1/users/trash [- admin]` | 200 | 200 | same |
| `GET /api/v1/users/trash?page=2&limit=5 [- anon]` | 401 | 401 | same |
| `GET /api/v1/users/trash?page=2&limit=5 [- admin]` | 200 | 200 | same |
| `scenario lifecycle #1 POST /api/v1/users [- admin]` | 201 | 201 | same |
| `scenario lifecycle #2 POST /api/v1/users [- admin]` | 409 | 409 | same |
| `scenario lifecycle #3 PATCH /api/v1/users/{{user}} [- admin]` | 200 | 200 | same |
| `scenario lifecycle #4 POST /api/v1/roles [- admin]` | 201 | 201 | same |
| `scenario lifecycle #5 POST /api/v1/users/{{user}}/roles [- admin]` | 201 | 201 | same |
| `scenario lifecycle #6 POST /api/v1/users/{{user}}/roles [- admin]` | 201 | 201 | same |
| `scenario lifecycle #7 GET /api/v1/users/{{user}} [- admin]` | 200 | 200 | same |
| `scenario lifecycle #8 DELETE /api/v1/roles/{{role}} [- admin]` | 409 | 409 | same |
| `scenario lifecycle #9 DELETE /api/v1/users/{{user}}/roles/{{role}} [- admin]` | 200 | 200 | same |
| `scenario lifecycle #10 DELETE /api/v1/users/{{user}}/roles/{{role}} [- admin]` | 404 | 404 | same |
| `scenario lifecycle #11 POST /api/v1/users/{{user}}/reset-password [- admin]` | 200 | 200 | same |
| `scenario lifecycle #12 DELETE /api/v1/users/{{user}} [- admin]` | 200 | 200 | same |
| `scenario lifecycle #13 GET /api/v1/users/{{user}} [- admin]` | 404 | 404 | same |
| `scenario lifecycle #14 GET /api/v1/users/trash?limit=100 [- admin]` | 200 | 200 | same |
| `scenario lifecycle #15 POST /api/v1/users [- admin]` | 201 | 201 | same |
| `scenario lifecycle #16 POST /api/v1/users/{{user}}/restore [- admin]` | 409 | 409 | same |
| `scenario lifecycle #17 DELETE /api/v1/users/{{taker}} [- admin]` | 200 | 200 | same |
| `scenario lifecycle #18 POST /api/v1/users/{{user}}/restore [- admin]` | 200 | 200 | same |
| `scenario lifecycle #19 POST /api/v1/users/{{user}}/restore [- admin]` | 404 | 404 | same |
| `scenario lifecycle #20 GET /api/v1/users?limit=100 [- admin]` | 200 | 200 | same |

## Explanations

<!-- Everything above this heading is regenerated on every run; everything from it down is kept.
One bullet per explained diff: a backticked key, `*` matching anything, then why. Example:
- `GET /api/v1/posts* [*] $.data[*].views`: views are counted by the RL_VIEW binding now (D7).
-->

Intentional fix (not visible in a sequential replay, covered by the `worker-only` test in `contract/users.test.ts`): the case-insensitive username check and the write that follows run in one transaction under `pg_advisory_xact_lock` on the lowercased name (create, rename, restore), so concurrent `Admin` / `admin` requests can no longer both succeed (REHAUL-FINDINGS-2026-09, `users.service.ts:145`).
