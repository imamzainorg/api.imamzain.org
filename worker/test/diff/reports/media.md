# Diff report: media

Nest (DB copy A) vs the Worker (DB copy B; unported routes fall through to a Nest on B), on the scrubbed prod dump of 2026-10-04.
Regenerate with `npm run diff -- media` in `worker/`.

- Requests: 53 (1 write scenario)
- Same: 51
- Diffs: 2, unexplained: 0
- Routes skipped: 0

## Requests

| Request | A | B | Result |
|---|---|---|---|
| `GET /api/v1/media [ar anon]` | 401 | 401 | same |
| `GET /api/v1/media [ar admin]` | 200 | 200 | same |
| `GET /api/v1/media [en anon]` | 401 | 401 | same |
| `GET /api/v1/media [en admin]` | 200 | 200 | same |
| `GET /api/v1/media [- anon]` | 401 | 401 | same |
| `GET /api/v1/media [- admin]` | 200 | 200 | same |
| `GET /api/v1/media?page=2&limit=5 [- anon]` | 401 | 401 | same |
| `GET /api/v1/media?page=2&limit=5 [- admin]` | 200 | 200 | same |
| `GET /api/v1/media/001953d9-3dbb-47ac-ab83-207fa89c839c [ar anon]` | 401 | 401 | same |
| `GET /api/v1/media/001953d9-3dbb-47ac-ab83-207fa89c839c [ar admin]` | 200 | 200 | same |
| `GET /api/v1/media/001953d9-3dbb-47ac-ab83-207fa89c839c [en anon]` | 401 | 401 | same |
| `GET /api/v1/media/001953d9-3dbb-47ac-ab83-207fa89c839c [en admin]` | 200 | 200 | same |
| `GET /api/v1/media/001953d9-3dbb-47ac-ab83-207fa89c839c [- anon]` | 401 | 401 | same |
| `GET /api/v1/media/001953d9-3dbb-47ac-ab83-207fa89c839c [- admin]` | 200 | 200 | same |
| `GET /api/v1/media/00cb1d26-3d1d-4eba-837c-749efed00269 [ar anon]` | 401 | 401 | same |
| `GET /api/v1/media/00cb1d26-3d1d-4eba-837c-749efed00269 [ar admin]` | 200 | 200 | same |
| `GET /api/v1/media/00cb1d26-3d1d-4eba-837c-749efed00269 [en anon]` | 401 | 401 | same |
| `GET /api/v1/media/00cb1d26-3d1d-4eba-837c-749efed00269 [en admin]` | 200 | 200 | same |
| `GET /api/v1/media/00cb1d26-3d1d-4eba-837c-749efed00269 [- anon]` | 401 | 401 | same |
| `GET /api/v1/media/00cb1d26-3d1d-4eba-837c-749efed00269 [- admin]` | 200 | 200 | same |
| `GET /api/v1/media/00000000-0000-4000-8000-000000000000 [ar anon]` | 401 | 401 | same |
| `GET /api/v1/media/00000000-0000-4000-8000-000000000000 [ar admin]` | 404 | 404 | same |
| `GET /api/v1/media/00000000-0000-4000-8000-000000000000 [en anon]` | 401 | 401 | same |
| `GET /api/v1/media/00000000-0000-4000-8000-000000000000 [en admin]` | 404 | 404 | same |
| `GET /api/v1/media/00000000-0000-4000-8000-000000000000 [- anon]` | 401 | 401 | same |
| `GET /api/v1/media/00000000-0000-4000-8000-000000000000 [- admin]` | 404 | 404 | same |
| `GET /api/v1/media/001953d9-3dbb-47ac-ab83-207fa89c839c/references [ar anon]` | 401 | 401 | same |
| `GET /api/v1/media/001953d9-3dbb-47ac-ab83-207fa89c839c/references [ar admin]` | 200 | 200 | same |
| `GET /api/v1/media/001953d9-3dbb-47ac-ab83-207fa89c839c/references [en anon]` | 401 | 401 | same |
| `GET /api/v1/media/001953d9-3dbb-47ac-ab83-207fa89c839c/references [en admin]` | 200 | 200 | same |
| `GET /api/v1/media/001953d9-3dbb-47ac-ab83-207fa89c839c/references [- anon]` | 401 | 401 | same |
| `GET /api/v1/media/001953d9-3dbb-47ac-ab83-207fa89c839c/references [- admin]` | 200 | 200 | same |
| `GET /api/v1/media/00cb1d26-3d1d-4eba-837c-749efed00269/references [ar anon]` | 401 | 401 | same |
| `GET /api/v1/media/00cb1d26-3d1d-4eba-837c-749efed00269/references [ar admin]` | 200 | 200 | same |
| `GET /api/v1/media/00cb1d26-3d1d-4eba-837c-749efed00269/references [en anon]` | 401 | 401 | same |
| `GET /api/v1/media/00cb1d26-3d1d-4eba-837c-749efed00269/references [en admin]` | 200 | 200 | same |
| `GET /api/v1/media/00cb1d26-3d1d-4eba-837c-749efed00269/references [- anon]` | 401 | 401 | same |
| `GET /api/v1/media/00cb1d26-3d1d-4eba-837c-749efed00269/references [- admin]` | 200 | 200 | same |
| `GET /api/v1/media/00000000-0000-4000-8000-000000000000/references [ar anon]` | 401 | 401 | same |
| `GET /api/v1/media/00000000-0000-4000-8000-000000000000/references [ar admin]` | 404 | 404 | same |
| `GET /api/v1/media/00000000-0000-4000-8000-000000000000/references [en anon]` | 401 | 401 | same |
| `GET /api/v1/media/00000000-0000-4000-8000-000000000000/references [en admin]` | 404 | 404 | same |
| `GET /api/v1/media/00000000-0000-4000-8000-000000000000/references [- anon]` | 401 | 401 | same |
| `GET /api/v1/media/00000000-0000-4000-8000-000000000000/references [- admin]` | 404 | 404 | same |
| `scenario upload-and-edit #1 POST /api/v1/media/upload-url [- admin]` | 201 | 201 | 1 diff |
| `scenario upload-and-edit #2 POST /api/v1/media/upload-url [- admin]` | 400 | 400 | same |
| `scenario upload-and-edit #3 POST /api/v1/media/confirm [- admin]` | 400 | 400 | same |
| `scenario upload-and-edit #4 POST /api/v1/media/confirm [- admin]` | 400 | 400 | same |
| `scenario upload-and-edit #5 GET /api/v1/media?limit=1 [- admin]` | 200 | 200 | same |
| `scenario upload-and-edit #6 PATCH /api/v1/media/{{media}} [- admin]` | 200 | 200 | same |
| `scenario upload-and-edit #7 GET /api/v1/media/{{media}}/references [- admin]` | 200 | 200 | same |
| `scenario upload-and-edit #8 GET /api/v1/media?search=diff alt [- admin]` | 200 | 200 | same |
| `scenario upload-and-edit #9 POST /api/v1/books/upload-url [- admin]` | 201 | 201 | 1 diff |

## Diffs

| Key | A | B | Explained |
|---|---|---|---|
| `scenario upload-and-edit #1 POST /api/v1/media/upload-url [- admin] $.data.uploadUrl` | `"https://imamzain-media.harness-account.r2.cloudflarestorage.com/media/originals/80682649-e85c-499f-a6ee-309e74b0db83...` | `"https://imamzain-media.harness-account.r2.cloudflarestorage.com/media/originals/3db0bb80-b9b1-4247-9254-19615a31c3d8...` | yes |
| `scenario upload-and-edit #9 POST /api/v1/books/upload-url [- admin] $.data.uploadUrl` | `"https://imamzain-media.harness-account.r2.cloudflarestorage.com/books/pdf/599c2db0-cd63-4614-a47e-ca62d2b1226f/book....` | `"https://imamzain-media.harness-account.r2.cloudflarestorage.com/books/pdf/7c20b7a0-eb2e-4e76-bed7-d1f3367ed3ab/book....` | yes |

## Explanations

<!-- Everything above this heading is regenerated on every run; everything from it down is kept.
One bullet per explained diff: a backticked key, `*` matching anything, then why. Example:
- `GET /api/v1/posts* [*] $.data[*].views`: views are counted by the RL_VIEW binding now (D7).
-->
- `scenario upload-and-edit * $.data.uploadUrl`: the key carries a fresh uuid, and X-Amz-Date / X-Amz-Signature change per call. Same host (virtual-hosted bucket), path, X-Amz-Expires=900, credential scope and X-Amz-SignedHeaders=content-type;host on both (checked by `contract/media.test.ts`). aws4fetch leaves out the AWS SDK's extra query parameters (`x-id=PutObject`, `X-Amz-Content-Sha256=UNSIGNED-PAYLOAD`, and the SDK v3 default `x-amz-checksum-crc32=AAAAAA==` + `x-amz-sdk-checksum-algorithm=CRC32`, a checksum of an empty body); none is signed and R2 requires none.

Intentional fixes (`worker-only` storage tests in `contract/media.test.ts`; REHAUL-FINDINGS-2026-09):
- `media.service.ts:163`: confirm compares the sniffed format with the stored Content-Type and refuses (and deletes) a mislabelled file, instead of storing the label as `mime_type`.
- `media.service.ts:162`: an empty upload is the clean 400 "not a JPEG, PNG, GIF or WebP image", not a 500.
- `image-variant.service.ts:313`: a sanitised original's new `file_size` is reported only when the row was updated.

Platform differences (Phase 2 table: sharp → Images binding):
- Image headers (format, displayed size, animation, EXIF / XMP / IPTC, CMYK) are parsed from the bytes (`lib/image-header.ts`, unit-tested against what sharp's `metadata()` reported for the same files) instead of sharp. A non-raster legacy original (SVG …) reads as `UNREADABLE` rather than `NON_RASTER`.
- Variants come from `env.IMAGES` (`fit: 'scale-down'`, WebP q82), which applies the EXIF orientation itself. Inputs over 20 MB fail in the binding, so such an image keeps only its original (D12).
- The metadata-free original is Cloudflare's re-encode. Its JPEG output keeps an EXIF copyright tag when there is one; such a copy fails the "no metadata left" check and the original is left untouched, as Nest does whenever its check fails.
- Dropped: the p-limit(2) gate on variant work (one isolate per request; nothing to share).

Also ported here, on the presigning added by this group: `POST /audios/upload-url`, `POST /books/upload-url` and `POST /academic-papers/upload-url` (tested in `contract/media.test.ts`).
