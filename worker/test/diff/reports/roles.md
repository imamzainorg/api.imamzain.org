# Diff report: roles

Nest (DB copy A) vs the Worker (DB copy B; unported routes fall through to a Nest on B), on the scrubbed prod dump of 2026-10-04.
Regenerate with `npm run diff -- roles` in `worker/`.

- Requests: 48 (1 write scenario)
- Same: 48
- Diffs: 0, unexplained: 0
- Routes skipped: 0

## Requests

| Request | A | B | Result |
|---|---|---|---|
| `GET /api/v1/roles [ar anon]` | 401 | 401 | same |
| `GET /api/v1/roles [ar admin]` | 200 | 200 | same |
| `GET /api/v1/roles [en anon]` | 401 | 401 | same |
| `GET /api/v1/roles [en admin]` | 200 | 200 | same |
| `GET /api/v1/roles [- anon]` | 401 | 401 | same |
| `GET /api/v1/roles [- admin]` | 200 | 200 | same |
| `GET /api/v1/roles?page=2&limit=5 [- anon]` | 401 | 401 | same |
| `GET /api/v1/roles?page=2&limit=5 [- admin]` | 200 | 200 | same |
| `GET /api/v1/roles/6e174dd4-fbd1-4a96-a152-548ea590b11b [ar anon]` | 401 | 401 | same |
| `GET /api/v1/roles/6e174dd4-fbd1-4a96-a152-548ea590b11b [ar admin]` | 200 | 200 | same |
| `GET /api/v1/roles/6e174dd4-fbd1-4a96-a152-548ea590b11b [en anon]` | 401 | 401 | same |
| `GET /api/v1/roles/6e174dd4-fbd1-4a96-a152-548ea590b11b [en admin]` | 200 | 200 | same |
| `GET /api/v1/roles/6e174dd4-fbd1-4a96-a152-548ea590b11b [- anon]` | 401 | 401 | same |
| `GET /api/v1/roles/6e174dd4-fbd1-4a96-a152-548ea590b11b [- admin]` | 200 | 200 | same |
| `GET /api/v1/roles/8ec64acb-4086-4a9f-a8ff-8ecaa92680cf [ar anon]` | 401 | 401 | same |
| `GET /api/v1/roles/8ec64acb-4086-4a9f-a8ff-8ecaa92680cf [ar admin]` | 200 | 200 | same |
| `GET /api/v1/roles/8ec64acb-4086-4a9f-a8ff-8ecaa92680cf [en anon]` | 401 | 401 | same |
| `GET /api/v1/roles/8ec64acb-4086-4a9f-a8ff-8ecaa92680cf [en admin]` | 200 | 200 | same |
| `GET /api/v1/roles/8ec64acb-4086-4a9f-a8ff-8ecaa92680cf [- anon]` | 401 | 401 | same |
| `GET /api/v1/roles/8ec64acb-4086-4a9f-a8ff-8ecaa92680cf [- admin]` | 200 | 200 | same |
| `GET /api/v1/roles/00000000-0000-4000-8000-000000000000 [ar anon]` | 401 | 401 | same |
| `GET /api/v1/roles/00000000-0000-4000-8000-000000000000 [ar admin]` | 404 | 404 | same |
| `GET /api/v1/roles/00000000-0000-4000-8000-000000000000 [en anon]` | 401 | 401 | same |
| `GET /api/v1/roles/00000000-0000-4000-8000-000000000000 [en admin]` | 404 | 404 | same |
| `GET /api/v1/roles/00000000-0000-4000-8000-000000000000 [- anon]` | 401 | 401 | same |
| `GET /api/v1/roles/00000000-0000-4000-8000-000000000000 [- admin]` | 404 | 404 | same |
| `GET /api/v1/roles/permissions [ar anon]` | 401 | 401 | same |
| `GET /api/v1/roles/permissions [ar admin]` | 200 | 200 | same |
| `GET /api/v1/roles/permissions [en anon]` | 401 | 401 | same |
| `GET /api/v1/roles/permissions [en admin]` | 200 | 200 | same |
| `GET /api/v1/roles/permissions [- anon]` | 401 | 401 | same |
| `GET /api/v1/roles/permissions [- admin]` | 200 | 200 | same |
| `GET /api/v1/roles/permissions?page=2&limit=5 [- anon]` | 401 | 401 | same |
| `GET /api/v1/roles/permissions?page=2&limit=5 [- admin]` | 200 | 200 | same |
| `scenario lifecycle #1 POST /api/v1/roles [- admin]` | 201 | 201 | same |
| `scenario lifecycle #2 GET /api/v1/roles/{{role}} [en admin]` | 200 | 200 | same |
| `scenario lifecycle #3 POST /api/v1/roles [- admin]` | 409 | 409 | same |
| `scenario lifecycle #4 POST /api/v1/roles [- admin]` | 409 | 409 | same |
| `scenario lifecycle #5 PATCH /api/v1/roles/{{role}} [- admin]` | 200 | 200 | same |
| `scenario lifecycle #6 GET /api/v1/roles/permissions?limit=1 [- admin]` | 200 | 200 | same |
| `scenario lifecycle #7 POST /api/v1/roles/{{role}}/permissions [- admin]` | 201 | 201 | same |
| `scenario lifecycle #8 POST /api/v1/roles/{{role}}/permissions [- admin]` | 201 | 201 | same |
| `scenario lifecycle #9 GET /api/v1/roles?limit=100 [- admin]` | 200 | 200 | same |
| `scenario lifecycle #10 DELETE /api/v1/roles/{{role}}/permissions/{{perm}} [- admin]` | 200 | 200 | same |
| `scenario lifecycle #11 DELETE /api/v1/roles/{{role}}/permissions/{{perm}} [- admin]` | 404 | 404 | same |
| `scenario lifecycle #12 DELETE /api/v1/roles/{{role}} [- admin]` | 200 | 200 | same |
| `scenario lifecycle #13 GET /api/v1/roles/{{role}} [- admin]` | 404 | 404 | same |
| `scenario lifecycle #14 DELETE /api/v1/roles/{{role}} [- admin]` | 404 | 404 | same |

## Explanations

<!-- Everything above this heading is regenerated on every run; everything from it down is kept.
One bullet per explained diff: a backticked key, `*` matching anything, then why. Example:
- `GET /api/v1/posts* [*] $.data[*].views`: views are counted by the RL_VIEW binding now (D7).
-->

Intentional fix (not visible in a sequential replay, covered by the `worker-only` test in `contract/roles.test.ts`): the case-insensitive role-name check and the write that follows run in one transaction under `pg_advisory_xact_lock` on the lowercased name (create, rename), so concurrent `Admin` / `admin` requests can no longer both succeed (REHAUL-FINDINGS-2026-09, `roles.service.ts:128`).

Not a diff, noted for the CMS: `GET /roles/permissions` pages by 20 by default, as Nest does (the controller's `limit ?? 100` never applies because the query DTO already defaults `limit` to 20). The CMS must pass `limit=100` to get every permission in one page.
