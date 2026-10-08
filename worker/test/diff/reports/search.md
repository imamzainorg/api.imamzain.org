# Diff report: search

Nest (DB copy A) vs the Worker (DB copy B; unported routes fall through to a Nest on B), on the scrubbed prod dump of 2026-10-04.
Regenerate with `npm run diff -- search` in `worker/`.

- Requests: 28 (1 write scenario)
- Same: 21
- Diffs: 14, unexplained: 0
- Routes skipped: 0

## Requests

| Request | A | B | Result |
|---|---|---|---|
| `GET /api/v1/search [ar anon]` | 400 | 400 | 2 diffs |
| `GET /api/v1/search [ar admin]` | 400 | 400 | 2 diffs |
| `GET /api/v1/search [en anon]` | 400 | 400 | 2 diffs |
| `GET /api/v1/search [en admin]` | 400 | 400 | 2 diffs |
| `GET /api/v1/search [- anon]` | 400 | 400 | 2 diffs |
| `GET /api/v1/search [- admin]` | 400 | 400 | 2 diffs |
| `scenario queries #1 GET /api/v1/search?q=%D8%A7%D9%84%D8%A5%D9%85%D8%A7%D9%85 [- anon]` | 200 | 200 | same |
| `scenario queries #2 GET /api/v1/search?q=%D8%A7%D9%84%D8%A5%D9%85%D8%A7%D9%85 [en anon]` | 200 | 200 | same |
| `scenario queries #3 GET /api/v1/search?q=%D8%B2%D9%8A%D9%86%20%D8%A7%D9%84%D8%B9%D8%A7%D8%A8%D8%AF%D9%8A%D9%86 [ar anon]` | 500 | 500 | same |
| `scenario queries #4 GET /api/v1/search?q=%D8%A7%D9%84%D8%B5%D8%AD%D9%8A%D9%81%D8%A9%20%D8%A7%D9%84%D8%B3%D8%AC%D8%A7%D8%AF%D9%8A%D8%A9 [ar anon]` | 200 | 200 | same |
| `scenario queries #5 GET /api/v1/search?q=%D8%A7%D9%84%D8%B5%D8%AD%D9%8A%D9%81%D8%A9%20%D8%A7%D9%84%D8%B3%D8%AC%D8%A7%D8%AF%D9%8A%D8%A9 [en anon]` | 200 | 200 | same |
| `scenario queries #6 GET /api/v1/search?q=%D8%AF%D8%B9%D8%A7%D8%A1 [fa anon]` | 200 | 200 | same |
| `scenario queries #7 GET /api/v1/search?q=%D8%B5%D9%84%D8%A7%D8%A9&limit=3 [- anon]` | 500 | 500 | same |
| `scenario queries #8 GET /api/v1/search?q=%D9%83%D8%AA%D8%A7%D8%A8&types=book,academic_paper [- anon]` | 200 | 200 | same |
| `scenario queries #9 GET /api/v1/search?q=%D9%85%D8%AD%D8%A7%D8%B6%D8%B1%D8%A9&types=audio&limit=50 [- anon]` | 200 | 200 | same |
| `scenario queries #10 GET /api/v1/search?q=imam [- anon]` | 200 | 200 | same |
| `scenario queries #11 GET /api/v1/search?q=imam&types=post&types=gallery_image [en anon]` | 200 | 200 | same |
| `scenario queries #12 GET /api/v1/search?q=%20%20%D8%A7%D9%84%D8%A5%D9%85%D8%A7%D9%85%20%20 [- anon]` | 200 | 200 | same |
| `scenario queries #13 GET /api/v1/search?q=zzzzzzqqq [- anon]` | 200 | 200 | same |
| `scenario queries #14 GET /api/v1/search?q=a [- anon]` | 400 | 400 | same |
| `scenario queries #15 GET /api/v1/search?q= [- anon]` | 400 | 400 | same |
| `scenario queries #16 GET /api/v1/search?q=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx [- anon]` | 400 | 400 | same |
| `scenario queries #17 GET /api/v1/search [- anon]` | 400 | 400 | 2 diffs |
| `scenario queries #18 GET /api/v1/search?q=%D8%A7%D9%84%D8%A5%D9%85%D8%A7%D9%85&types=video [- anon]` | 400 | 400 | same |
| `scenario queries #19 GET /api/v1/search?q=%D8%A7%D9%84%D8%A5%D9%85%D8%A7%D9%85&types=post,post [- anon]` | 400 | 400 | same |
| `scenario queries #20 GET /api/v1/search?q=%D8%A7%D9%84%D8%A5%D9%85%D8%A7%D9%85&limit=51 [- anon]` | 400 | 400 | same |
| `scenario queries #21 GET /api/v1/search?q=%D8%A7%D9%84%D8%A5%D9%85%D8%A7%D9%85&limit=0 [- anon]` | 400 | 400 | same |
| `scenario queries #22 GET /api/v1/search?q=%D8%A7%D9%84%D8%A5%D9%85%D8%A7%D9%85&unknown=1 [- anon]` | 400 | 400 | same |

## Diffs

| Key | A | B | Explained |
|---|---|---|---|
| `GET /api/v1/search [ar anon] $.errors.length` | `3` | `1` | yes |
| `GET /api/v1/search [ar anon] $.errors[0]` | `"q must be shorter than or equal to 200 characters"` | `"q must be a string"` | yes |
| `GET /api/v1/search [ar admin] $.errors.length` | `3` | `1` | yes |
| `GET /api/v1/search [ar admin] $.errors[0]` | `"q must be shorter than or equal to 200 characters"` | `"q must be a string"` | yes |
| `GET /api/v1/search [en anon] $.errors.length` | `3` | `1` | yes |
| `GET /api/v1/search [en anon] $.errors[0]` | `"q must be shorter than or equal to 200 characters"` | `"q must be a string"` | yes |
| `GET /api/v1/search [en admin] $.errors.length` | `3` | `1` | yes |
| `GET /api/v1/search [en admin] $.errors[0]` | `"q must be shorter than or equal to 200 characters"` | `"q must be a string"` | yes |
| `GET /api/v1/search [- anon] $.errors.length` | `3` | `1` | yes |
| `GET /api/v1/search [- anon] $.errors[0]` | `"q must be shorter than or equal to 200 characters"` | `"q must be a string"` | yes |
| `GET /api/v1/search [- admin] $.errors.length` | `3` | `1` | yes |
| `GET /api/v1/search [- admin] $.errors[0]` | `"q must be shorter than or equal to 200 characters"` | `"q must be a string"` | yes |
| `scenario queries #17 GET /api/v1/search [- anon] $.errors.length` | `3` | `1` | yes |
| `scenario queries #17 GET /api/v1/search [- anon] $.errors[0]` | `"q must be shorter than or equal to 200 characters"` | `"q must be a string"` | yes |

## Explanations

<!-- Everything above this heading is regenerated on every run; everything from it down is kept.
One bullet per explained diff: a backticked key, `*` matching anything, then why. Example:
- `GET /api/v1/posts* [*] $.data[*].views`: views are counted by the RL_VIEW binding now (D7).
-->

- `GET /api/v1/search [*] $.errors*`: with `q` missing the Worker lists only the type error; Nest also lists the length checks (known accepted difference, CONVENTIONS.md §4).
- `scenario queries #17 GET /api/v1/search [- anon] $.errors*`: the same, for a request with no `q`.
