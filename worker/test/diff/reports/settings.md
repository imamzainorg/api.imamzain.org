# Diff report: settings

Nest (DB copy A) vs the Worker (DB copy B; unported routes fall through to a Nest on B), on the scrubbed prod dump of 2026-10-04.
Regenerate with `npm run diff -- settings` in `worker/`.

- Requests: 45 (1 write scenario)
- Same: 45
- Diffs: 0, unexplained: 0
- Routes skipped: 0

## Requests

| Request | A | B | Result |
|---|---|---|---|
| `GET /api/v1/settings [ar anon]` | 401 | 401 | same |
| `GET /api/v1/settings [ar admin]` | 200 | 200 | same |
| `GET /api/v1/settings [en anon]` | 401 | 401 | same |
| `GET /api/v1/settings [en admin]` | 200 | 200 | same |
| `GET /api/v1/settings [- anon]` | 401 | 401 | same |
| `GET /api/v1/settings [- admin]` | 200 | 200 | same |
| `GET /api/v1/settings/contact_email [ar anon]` | 401 | 401 | same |
| `GET /api/v1/settings/contact_email [ar admin]` | 200 | 200 | same |
| `GET /api/v1/settings/contact_email [en anon]` | 401 | 401 | same |
| `GET /api/v1/settings/contact_email [en admin]` | 200 | 200 | same |
| `GET /api/v1/settings/contact_email [- anon]` | 401 | 401 | same |
| `GET /api/v1/settings/contact_email [- admin]` | 200 | 200 | same |
| `GET /api/v1/settings/default_language [ar anon]` | 401 | 401 | same |
| `GET /api/v1/settings/default_language [ar admin]` | 200 | 200 | same |
| `GET /api/v1/settings/default_language [en anon]` | 401 | 401 | same |
| `GET /api/v1/settings/default_language [en admin]` | 200 | 200 | same |
| `GET /api/v1/settings/default_language [- anon]` | 401 | 401 | same |
| `GET /api/v1/settings/default_language [- admin]` | 200 | 200 | same |
| `GET /api/v1/settings/does-not-exist [ar anon]` | 401 | 401 | same |
| `GET /api/v1/settings/does-not-exist [ar admin]` | 404 | 404 | same |
| `GET /api/v1/settings/does-not-exist [en anon]` | 401 | 401 | same |
| `GET /api/v1/settings/does-not-exist [en admin]` | 404 | 404 | same |
| `GET /api/v1/settings/does-not-exist [- anon]` | 401 | 401 | same |
| `GET /api/v1/settings/does-not-exist [- admin]` | 404 | 404 | same |
| `GET /api/v1/settings/public [ar anon]` | 200 | 200 | same |
| `GET /api/v1/settings/public [ar admin]` | 200 | 200 | same |
| `GET /api/v1/settings/public [en anon]` | 200 | 200 | same |
| `GET /api/v1/settings/public [en admin]` | 200 | 200 | same |
| `GET /api/v1/settings/public [- anon]` | 200 | 200 | same |
| `GET /api/v1/settings/public [- admin]` | 200 | 200 | same |
| `scenario lifecycle #1 PUT /api/v1/settings/diff_number [- admin]` | 200 | 200 | same |
| `scenario lifecycle #2 PUT /api/v1/settings/diff_number [- admin]` | 200 | 200 | same |
| `scenario lifecycle #3 PUT /api/v1/settings/diff_number [- admin]` | 409 | 409 | same |
| `scenario lifecycle #4 PUT /api/v1/settings/diff_number [- admin]` | 400 | 400 | same |
| `scenario lifecycle #5 PUT /api/v1/settings/diff_json [- admin]` | 200 | 200 | same |
| `scenario lifecycle #6 PUT /api/v1/settings/diff_json [- admin]` | 400 | 400 | same |
| `scenario lifecycle #7 PUT /api/v1/settings/diff_bool [- admin]` | 400 | 400 | same |
| `scenario lifecycle #8 PUT /api/v1/settings/diff_bool [- admin]` | 400 | 400 | same |
| `scenario lifecycle #9 GET /api/v1/settings/diff_number [- admin]` | 200 | 200 | same |
| `scenario lifecycle #10 GET /api/v1/settings/public [- anon]` | 200 | 200 | same |
| `scenario lifecycle #11 GET /api/v1/settings [- admin]` | 200 | 200 | same |
| `scenario lifecycle #12 DELETE /api/v1/settings/diff_number [- admin]` | 200 | 200 | same |
| `scenario lifecycle #13 DELETE /api/v1/settings/diff_number [- admin]` | 404 | 404 | same |
| `scenario lifecycle #14 GET /api/v1/settings/diff_number [- admin]` | 404 | 404 | same |
| `scenario lifecycle #15 GET /api/v1/settings/public [- anon]` | 200 | 200 | same |

## Explanations

<!-- Everything above this heading is regenerated on every run; everything from it down is kept.
One bullet per explained diff: a backticked key, `*` matching anything, then why. Example:
- `GET /api/v1/posts* [*] $.data[*].views`: views are counted by the RL_VIEW binding now (D7).
-->
