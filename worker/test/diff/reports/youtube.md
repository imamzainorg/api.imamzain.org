# Diff report: youtube

Nest (DB copy A) vs the Worker (DB copy B; unported routes fall through to a Nest on B), on the scrubbed prod dump of 2026-10-04.
Regenerate with `npm run diff -- youtube` in `worker/`.

- Requests: 43 (1 write scenario)
- Same: 42
- Diffs: 2, unexplained: 2
- Routes skipped: 0

## Requests

| Request | A | B | Result |
|---|---|---|---|
| `GET /api/v1/youtube/playlists [ar anon]` | 200 | 200 | same |
| `GET /api/v1/youtube/playlists [ar admin]` | 200 | 200 | same |
| `GET /api/v1/youtube/playlists [en anon]` | 200 | 200 | same |
| `GET /api/v1/youtube/playlists [en admin]` | 200 | 200 | same |
| `GET /api/v1/youtube/playlists [- anon]` | 200 | 200 | same |
| `GET /api/v1/youtube/playlists [- admin]` | 200 | 200 | same |
| `GET /api/v1/youtube/playlists?page=2&limit=5 [- anon]` | 200 | 200 | same |
| `GET /api/v1/youtube/playlists?page=2&limit=5 [- admin]` | 200 | 200 | same |
| `GET /api/v1/youtube/playlists/PLi1h0SEPzOA4eJ7VLBem5p4OIwRxkrJgK/videos [ar anon]` | 200 | 200 | same |
| `GET /api/v1/youtube/playlists/PLi1h0SEPzOA4eJ7VLBem5p4OIwRxkrJgK/videos [ar admin]` | 200 | 200 | same |
| `GET /api/v1/youtube/playlists/PLi1h0SEPzOA4eJ7VLBem5p4OIwRxkrJgK/videos [en anon]` | 200 | 200 | same |
| `GET /api/v1/youtube/playlists/PLi1h0SEPzOA4eJ7VLBem5p4OIwRxkrJgK/videos [en admin]` | 200 | 200 | same |
| `GET /api/v1/youtube/playlists/PLi1h0SEPzOA4eJ7VLBem5p4OIwRxkrJgK/videos [- anon]` | 200 | 200 | same |
| `GET /api/v1/youtube/playlists/PLi1h0SEPzOA4eJ7VLBem5p4OIwRxkrJgK/videos [- admin]` | 200 | 200 | same |
| `GET /api/v1/youtube/playlists/PLi1h0SEPzOA56vCK9FeWmRGJBlLkIIg4o/videos [ar anon]` | 200 | 200 | same |
| `GET /api/v1/youtube/playlists/PLi1h0SEPzOA56vCK9FeWmRGJBlLkIIg4o/videos [ar admin]` | 200 | 200 | same |
| `GET /api/v1/youtube/playlists/PLi1h0SEPzOA56vCK9FeWmRGJBlLkIIg4o/videos [en anon]` | 200 | 200 | same |
| `GET /api/v1/youtube/playlists/PLi1h0SEPzOA56vCK9FeWmRGJBlLkIIg4o/videos [en admin]` | 200 | 200 | same |
| `GET /api/v1/youtube/playlists/PLi1h0SEPzOA56vCK9FeWmRGJBlLkIIg4o/videos [- anon]` | 200 | 200 | same |
| `GET /api/v1/youtube/playlists/PLi1h0SEPzOA56vCK9FeWmRGJBlLkIIg4o/videos [- admin]` | 200 | 200 | same |
| `GET /api/v1/youtube/playlists/does-not-exist/videos [ar anon]` | 404 | 404 | same |
| `GET /api/v1/youtube/playlists/does-not-exist/videos [ar admin]` | 404 | 404 | same |
| `GET /api/v1/youtube/playlists/does-not-exist/videos [en anon]` | 404 | 404 | same |
| `GET /api/v1/youtube/playlists/does-not-exist/videos [en admin]` | 404 | 404 | same |
| `GET /api/v1/youtube/playlists/does-not-exist/videos [- anon]` | 404 | 404 | same |
| `GET /api/v1/youtube/playlists/does-not-exist/videos [- admin]` | 404 | 404 | same |
| `GET /api/v1/youtube/videos [ar anon]` | 200 | 200 | same |
| `GET /api/v1/youtube/videos [ar admin]` | 200 | 200 | same |
| `GET /api/v1/youtube/videos [en anon]` | 200 | 200 | same |
| `GET /api/v1/youtube/videos [en admin]` | 200 | 200 | same |
| `GET /api/v1/youtube/videos [- anon]` | 200 | 200 | same |
| `GET /api/v1/youtube/videos [- admin]` | 200 | 200 | same |
| `GET /api/v1/youtube/videos?page=2&limit=5 [- anon]` | 200 | 200 | same |
| `GET /api/v1/youtube/videos?page=2&limit=5 [- admin]` | 200 | 200 | same |
| `scenario bounds #1 GET /api/v1/youtube/videos?page=2&limit=100 [- anon]` | 200 | 200 | same |
| `scenario bounds #2 GET /api/v1/youtube/videos?page=9999 [- anon]` | 200 | 200 | same |
| `scenario bounds #3 GET /api/v1/youtube/videos?limit=0 [- anon]` | 400 | 400 | same |
| `scenario bounds #4 GET /api/v1/youtube/videos?limit=101 [- anon]` | 400 | 400 | same |
| `scenario bounds #5 GET /api/v1/youtube/videos?page=abc [- anon]` | 400 | 400 | 2 diffs |
| `scenario bounds #6 GET /api/v1/youtube/playlists?page=2&limit=7 [- anon]` | 200 | 200 | same |
| `scenario bounds #7 GET /api/v1/youtube/playlists?limit=0.5 [- anon]` | 400 | 400 | same |
| `scenario bounds #8 GET /api/v1/youtube/playlists/does-not-exist/videos [- anon]` | 404 | 404 | same |
| `scenario bounds #9 GET /api/v1/youtube/playlists/does-not-exist/videos?limit=500 [- anon]` | 400 | 400 | same |

## Diffs

| Key | A | B | Explained |
|---|---|---|---|
| `scenario bounds #5 GET /api/v1/youtube/videos?page=abc [- anon] $.errors.length` | `2` | `1` | **no** |
| `scenario bounds #5 GET /api/v1/youtube/videos?page=abc [- anon] $.errors[0]` | `"page must not be less than 1"` | `"page must be a number conforming to the specified constraints"` | **no** |

## Explanations

<!-- Everything above this heading is regenerated on every run; everything from it down is kept.
One bullet per explained diff: a backticked key, `*` matching anything, then why. Example:
- `GET /api/v1/posts* [*] $.data[*].views`: views are counted by the RL_VIEW binding now (D7).
-->

- `scenario bounds #5 GET /api/v1/youtube/videos?page=abc [- anon] $.errors*`: a value of the wrong JSON type lists only the type error on the Worker; Nest also lists the other constraints of that field (known accepted difference, CONVENTIONS.md §4).
