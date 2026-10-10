# Diff report: forms

Nest (DB copy A) vs the Worker (DB copy B; unported routes fall through to a Nest on B), on the scrubbed prod dump of 2026-10-04.
Regenerate with `npm run diff -- forms` in `worker/`.

- Requests: 52 (2 write scenarios)
- Same: 52
- Diffs: 0, unexplained: 0
- Routes skipped: 0

## Requests

| Request | A | B | Result |
|---|---|---|---|
| `GET /api/v1/forms/contacts [ar anon]` | 401 | 401 | same |
| `GET /api/v1/forms/contacts [ar admin]` | 200 | 200 | same |
| `GET /api/v1/forms/contacts [en anon]` | 401 | 401 | same |
| `GET /api/v1/forms/contacts [en admin]` | 200 | 200 | same |
| `GET /api/v1/forms/contacts [- anon]` | 401 | 401 | same |
| `GET /api/v1/forms/contacts [- admin]` | 200 | 200 | same |
| `GET /api/v1/forms/contacts?page=2&limit=5 [- anon]` | 401 | 401 | same |
| `GET /api/v1/forms/contacts?page=2&limit=5 [- admin]` | 200 | 200 | same |
| `GET /api/v1/forms/contacts/trash [ar anon]` | 401 | 401 | same |
| `GET /api/v1/forms/contacts/trash [ar admin]` | 200 | 200 | same |
| `GET /api/v1/forms/contacts/trash [en anon]` | 401 | 401 | same |
| `GET /api/v1/forms/contacts/trash [en admin]` | 200 | 200 | same |
| `GET /api/v1/forms/contacts/trash [- anon]` | 401 | 401 | same |
| `GET /api/v1/forms/contacts/trash [- admin]` | 200 | 200 | same |
| `GET /api/v1/forms/contacts/trash?page=2&limit=5 [- anon]` | 401 | 401 | same |
| `GET /api/v1/forms/contacts/trash?page=2&limit=5 [- admin]` | 200 | 200 | same |
| `GET /api/v1/forms/proxy-visits [ar anon]` | 401 | 401 | same |
| `GET /api/v1/forms/proxy-visits [ar admin]` | 200 | 200 | same |
| `GET /api/v1/forms/proxy-visits [en anon]` | 401 | 401 | same |
| `GET /api/v1/forms/proxy-visits [en admin]` | 200 | 200 | same |
| `GET /api/v1/forms/proxy-visits [- anon]` | 401 | 401 | same |
| `GET /api/v1/forms/proxy-visits [- admin]` | 200 | 200 | same |
| `GET /api/v1/forms/proxy-visits?page=2&limit=5 [- anon]` | 401 | 401 | same |
| `GET /api/v1/forms/proxy-visits?page=2&limit=5 [- admin]` | 200 | 200 | same |
| `GET /api/v1/forms/proxy-visits/trash [ar anon]` | 401 | 401 | same |
| `GET /api/v1/forms/proxy-visits/trash [ar admin]` | 200 | 200 | same |
| `GET /api/v1/forms/proxy-visits/trash [en anon]` | 401 | 401 | same |
| `GET /api/v1/forms/proxy-visits/trash [en admin]` | 200 | 200 | same |
| `GET /api/v1/forms/proxy-visits/trash [- anon]` | 401 | 401 | same |
| `GET /api/v1/forms/proxy-visits/trash [- admin]` | 200 | 200 | same |
| `GET /api/v1/forms/proxy-visits/trash?page=2&limit=5 [- anon]` | 401 | 401 | same |
| `GET /api/v1/forms/proxy-visits/trash?page=2&limit=5 [- admin]` | 200 | 200 | same |
| `scenario proxy-visit #1 POST /api/v1/forms/proxy-visit [- anon]` | 201 | 201 | same |
| `scenario proxy-visit #2 POST /api/v1/forms/proxy-visit [- anon]` | 400 | 400 | same |
| `scenario proxy-visit #3 PATCH /api/v1/forms/proxy-visits/{{v}} [- admin]` | 200 | 200 | same |
| `scenario proxy-visit #4 PATCH /api/v1/forms/proxy-visits/{{v}} [- admin]` | 200 | 200 | same |
| `scenario proxy-visit #5 PATCH /api/v1/forms/proxy-visits/{{v}} [- admin]` | 200 | 200 | same |
| `scenario proxy-visit #6 PATCH /api/v1/forms/proxy-visits/{{v}} [- admin]` | 400 | 400 | same |
| `scenario proxy-visit #7 GET /api/v1/forms/proxy-visits?status=REJECTED&limit=100 [- admin]` | 200 | 200 | same |
| `scenario proxy-visit #8 DELETE /api/v1/forms/proxy-visits/{{v}} [- admin]` | 200 | 200 | same |
| `scenario proxy-visit #9 PATCH /api/v1/forms/proxy-visits/{{v}} [- admin]` | 404 | 404 | same |
| `scenario proxy-visit #10 GET /api/v1/forms/proxy-visits/trash?limit=100 [- admin]` | 200 | 200 | same |
| `scenario proxy-visit #11 POST /api/v1/forms/proxy-visits/{{v}}/restore [- admin]` | 200 | 200 | same |
| `scenario proxy-visit #12 POST /api/v1/forms/proxy-visits/{{v}}/restore [- admin]` | 404 | 404 | same |
| `scenario contact #1 POST /api/v1/forms/contact [- anon]` | 201 | 201 | same |
| `scenario contact #2 POST /api/v1/forms/contact [- anon]` | 400 | 400 | same |
| `scenario contact #3 PATCH /api/v1/forms/contacts/{{s}} [- admin]` | 200 | 200 | same |
| `scenario contact #4 PATCH /api/v1/forms/contacts/{{s}} [- admin]` | 200 | 200 | same |
| `scenario contact #5 GET /api/v1/forms/contacts?status=SPAM&limit=100 [- admin]` | 200 | 200 | same |
| `scenario contact #6 DELETE /api/v1/forms/contacts/{{s}} [- admin]` | 200 | 200 | same |
| `scenario contact #7 GET /api/v1/forms/contacts/trash?limit=100 [- admin]` | 200 | 200 | same |
| `scenario contact #8 POST /api/v1/forms/contacts/{{s}}/restore [- admin]` | 200 | 200 | same |

## Explanations

<!-- Everything above this heading is regenerated on every run; everything from it down is kept.
One bullet per explained diff: a backticked key, `*` matching anything, then why. Example:
- `GET /api/v1/posts* [*] $.data[*].views`: views are counted by the RL_VIEW binding now (D7).
-->

Intentional fix (REHAUL-FINDINGS-2026-09, `forms.service.ts:107` / `:253`): the compare-and-set on a proxy-visit or contact PATCH matches the status that was read only when the PATCH changes the status. A notes-only edit no longer gets a spurious 409 from a concurrent status change. A status change still gets the 409, so a request is completed (and WhatsApp sent) exactly once. No black-box test can force the interleaving, so there is no `worker-only` test; the 409-free sequential paths are in `contract/forms.test.ts`.

The WhatsApp send goes through Twilio's REST API (`lib/whatsapp.ts`, unit-tested in `test/whatsapp.test.ts`); the harness has no Twilio credentials, so the COMPLETED steps above send nothing on either side.
