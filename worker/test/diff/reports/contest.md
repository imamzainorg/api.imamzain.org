# Diff report: contest

Nest (DB copy A) vs the Worker (DB copy B; unported routes fall through to a Nest on B), on the scrubbed prod dump of 2026-10-04.
Regenerate with `npm run diff -- contest` in `worker/`.

- Requests: 25 (1 write scenario)
- Same: 23
- Diffs: 2, unexplained: 0
- Routes skipped: 0

## Requests

| Request | A | B | Result |
|---|---|---|---|
| `GET /api/v1/forms/qutuf-sajjadiya-contest/attempts [ar anon]` | 401 | 401 | same |
| `GET /api/v1/forms/qutuf-sajjadiya-contest/attempts [ar admin]` | 200 | 200 | same |
| `GET /api/v1/forms/qutuf-sajjadiya-contest/attempts [en anon]` | 401 | 401 | same |
| `GET /api/v1/forms/qutuf-sajjadiya-contest/attempts [en admin]` | 200 | 200 | same |
| `GET /api/v1/forms/qutuf-sajjadiya-contest/attempts [- anon]` | 401 | 401 | same |
| `GET /api/v1/forms/qutuf-sajjadiya-contest/attempts [- admin]` | 200 | 200 | same |
| `GET /api/v1/forms/qutuf-sajjadiya-contest/attempts?page=2&limit=5 [- anon]` | 401 | 401 | same |
| `GET /api/v1/forms/qutuf-sajjadiya-contest/attempts?page=2&limit=5 [- admin]` | 200 | 200 | same |
| `GET /api/v1/forms/qutuf-sajjadiya-contest/questions [ar anon]` | 200 | 200 | same |
| `GET /api/v1/forms/qutuf-sajjadiya-contest/questions [ar admin]` | 200 | 200 | same |
| `GET /api/v1/forms/qutuf-sajjadiya-contest/questions [en anon]` | 200 | 200 | same |
| `GET /api/v1/forms/qutuf-sajjadiya-contest/questions [en admin]` | 200 | 200 | same |
| `GET /api/v1/forms/qutuf-sajjadiya-contest/questions [- anon]` | 200 | 200 | same |
| `GET /api/v1/forms/qutuf-sajjadiya-contest/questions [- admin]` | 200 | 200 | same |
| `scenario open-start-submit-close #1 POST /api/v1/forms/qutuf-sajjadiya-contest/start [- anon]` | 403 | 403 | same |
| `scenario open-start-submit-close #2 PUT /api/v1/settings/contest_open [- admin]` | 200 | 200 | same |
| `scenario open-start-submit-close #3 POST /api/v1/forms/qutuf-sajjadiya-contest/start [- anon]` | 201 | 201 | 1 diff |
| `scenario open-start-submit-close #4 POST /api/v1/forms/qutuf-sajjadiya-contest/start [- anon]` | 201 | 201 | 1 diff |
| `scenario open-start-submit-close #5 POST /api/v1/forms/qutuf-sajjadiya-contest/start [- anon]` | 400 | 400 | same |
| `scenario open-start-submit-close #6 GET /api/v1/forms/qutuf-sajjadiya-contest/questions [- anon]` | 200 | 200 | same |
| `scenario open-start-submit-close #7 POST /api/v1/forms/qutuf-sajjadiya-contest/submit [- anon]` | 409 | 409 | same |
| `scenario open-start-submit-close #8 POST /api/v1/forms/qutuf-sajjadiya-contest/submit [- anon]` | 401 | 401 | same |
| `scenario open-start-submit-close #9 GET /api/v1/forms/qutuf-sajjadiya-contest/attempts?submitted=false&limit=5 [- admin]` | 200 | 200 | same |
| `scenario open-start-submit-close #10 PUT /api/v1/settings/contest_open [- admin]` | 200 | 200 | same |
| `scenario open-start-submit-close #11 POST /api/v1/forms/qutuf-sajjadiya-contest/submit [- anon]` | 403 | 403 | same |

## Diffs

| Key | A | B | Explained |
|---|---|---|---|
| `scenario open-start-submit-close #3 POST /api/v1/forms/qutuf-sajjadiya-contest/start [- anon] $.data.attempt_token` | `"4478a0c68d02555690cb083502e66dbc9ba364f022b955c2b1d0c21bf3678c89"` | `"8b556d5951eb032aad53e2ea517db16ff43c730c77424e5496405bc791066bd1"` | yes |
| `scenario open-start-submit-close #4 POST /api/v1/forms/qutuf-sajjadiya-contest/start [- anon] $.data.attempt_token` | `"4478a0c68d02555690cb083502e66dbc9ba364f022b955c2b1d0c21bf3678c89"` | `"8b556d5951eb032aad53e2ea517db16ff43c730c77424e5496405bc791066bd1"` | yes |

## Explanations

<!-- Everything above this heading is regenerated on every run; everything from it down is kept.
One bullet per explained diff: a backticked key, `*` matching anything, then why. Example:
- `GET /api/v1/posts* [*] $.data[*].views`: views are counted by the RL_VIEW binding now (D7).
-->
- `scenario open-start-submit-close * $.data.attempt_token`: the HMAC of the attempt id, which differs between A and B. `contract/contest.test.ts` checks on both targets that the token is HKDF(JWT_SECRET, contest-attempt/v1)-HMAC of the id, so attempts started on Nest submit on the Worker and back.

Intentional fix (`worker-only` test in `contract/contest.test.ts`): `attempt_token: null` counts as absent. Nest's `@IsOptional` let the null through and hashing it threw (500).

Not ported: the in-process question caches (D8: no caches); the questions are read per request. CONTEST_THROTTLE_PER_IP can't move the limit: /start and /submit use the fixed RL_60 binding (60 per IP per 60 s, Nest's default being 60 per 15 min).
