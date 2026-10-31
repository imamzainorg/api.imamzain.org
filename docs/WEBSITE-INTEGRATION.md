# Website integration: moving imamzain.org from JSON to the API

Status as of 2026-10-26. Written for whoever moves the website (`imamzain.org`) off `src/data/*.json`
and onto `api.imamzain.org`. Everything below was checked against the live API on that date.

## 1. Where things stand

- The API is a Hono app on Cloudflare Workers (Worker name `imamzain-api`), live at
  `https://api.imamzain.org/api/v1`. The old NestJS host is gone.
- On 2026-10-25 the production database was synced to the website JSON, record by record: every row
  in `books`, `posts`, `gallery`, `research`, `journals`, `student`, `imamzain` (static pages),
  `store-locations` and `AudioItemAnalyzed` is in the DB with matching fields. Exceptions are listed
  in section 6.
- From the moment a page reads from the API, **the CMS is the source of truth for that content.**
  Don't edit the matching JSON afterwards; delete it once its pages are switched.

## 2. Contract basics

**Base URL:** `https://api.imamzain.org/api/v1`

**Success envelope:**
```json
{ "message": "Posts fetched", "data": { ... }, "success": true, "timestamp": "..." }
```
Some endpoints add a top-level `meta` (e.g. `/daily-hadiths/today`).

**Lists:**
```json
"data": { "items": [ ... ], "pagination": { "page": 1, "limit": 20, "total": 89, "pages": 5 } }
```
`?page=` starts at 1, `?limit=` defaults to 20, **max 100**. To load a whole collection at build time,
page until `page === pagination.pages`. Gallery is 819 rows (9 pages of 100), papers 1258 (13 pages).

**Errors:**
```json
{ "success": false, "code": "NOT_FOUND", "error": "Book not found", "timestamp": "...", "path": "...", "requestId": "..." }
```
Branch on `code`, never on the text.

**Language:** send `Accept-Language: ar`. Every translatable record carries:
- `translation`: the one resolved for the requested language (falls back to the default, which is
  Arabic);
- `<entity>_translations`: **all** languages. Journals' Persian titles are in
  `academic_paper_translations` with `lang: "fa"`, so no second request is needed.

**Caching:** public GETs send `Cache-Control: public, max-age=60, s-maxage=300`, an `ETag` and
`Vary: Accept-Language, Origin`.

**CORS:** `https://imamzain.org` is allowed (with credentials).

**Server-side fetch from the website's Worker:** a `fetch()` from a Worker on the `imamzain.org` zone
to `api.imamzain.org` does **not** reach the API Worker (same-zone fetches skip Worker routes). Use the
existing service binding `API` (`env.API.fetch(...)`, see `wrangler.jsonc`), as `worker/` already does
for forms. Fetches during `next build` run in Node and can use the public URL.

**Media:** `media.url` is a `https://cdn.imamzain.org/...` URL. `media_variants` is empty for seeded
media, so keep the custom Cloudflare image loader.

**View counters:** `POST /<entity>/:id/view` exists for books, posts, gallery, academic-papers and
audios. Call it from the browser.

## 2b. Book PDFs: who may download (`pdf_access`)

Some books are visible everywhere but their PDF may only be downloaded in the mobile app. Every book response
(list, detail, by-slug, and each entry of a series' `parts[]`) carries two fields:

| Case | Website (no key) | Mobile app (sends `X-App-Key`) |
|---|---|---|
| `public` PDF | `pdf_access: "public"`, `pdf_url: "…"` | same |
| `app` PDF | `pdf_access: "app"`, **`pdf_url: null`** | `pdf_access: "app"`, `pdf_url: "…"` |
| no PDF | `pdf_access: null`, `pdf_url: null` | same |

Website button states, from `pdf_access` alone:

- `"public"`: an active download button (`pdf_url`).
- `"app"`: a grey, disabled button ("available in the app"; it can link to the store).
- `null`: no button, as before.

Rules:

- The website must **never** send `X-App-Key`, and the key must never appear in the website's repo or pages.
- A request that carries a valid key gets `Cache-Control: private` and every public response varies on
  `X-App-Key`, so a shared cache cannot hand an app-only link to the website.
- This is a soft gate: the key ships inside the app, and the file sits on the public CDN. It keeps the link
  off the website and out of casual reach; it is not DRM. If it ever has to be enforced, the contract stays and
  the link becomes a short-lived signed URL behind the same check.
- The CMS (admin endpoints) always sees the real `pdf_url` and `pdf_access`, and sets it with `pdf_access`
  (`"public"` | `"app"`) on `POST /books` and `PATCH /books/:id`.
- The worker secret is `APP_CLIENT_KEY`; unset means nobody is the app.

## 3. Endpoint map (website feature → API)

| Website today | API |
|---|---|
| `posts.json` (news list, `news/[slug]`, archives, home) | `GET /posts` (`category_id`, `search`, `featured`, `sort=newest\|views`); `GET /posts/by-slug/:slug` (adds `translation.body`, `post_attachments[].media`, SEO fields, `reading_time_minutes`). Categories: `GET /post-categories` |
| `books.json` (library, publications, `library/books/[bookSlug]`, `publications/[slug]`) | `GET /books` (`category_id`, `search`, `is_publication`); `GET /books/by-slug/:slug`; `GET /books/:id`. Categories: `GET /book-categories` |
| `gallery.json` (media/images, home slider, gallery index) | `GET /gallery` (`category_id`, `tags`, `locations`); `GET /gallery/:id`. Categories: `GET /gallery-categories` |
| `research.json`, `journals.json`, `student.json` (scientific platform) | `GET /academic-papers` (`category_id`, `search`); `GET /academic-papers/:id` (adds `abstract`). Categories: `GET /academic-paper-categories` (5: conference, journals, bachelor, master, PhD) |
| `AudioItemAnalyzed.json` (media/audio, `/api/audio-peaks/[id]`) | `GET /audios` (`speaker_id`, `search`); `GET /audios/:id` (adds `peaks`, 300 points); `GET /speakers` (`audio_count`) |
| `imamzain.json` (his-life pages) | `GET /static-pages`; `GET /static-pages/by-slug/:slug` (adds `translation.body`) |
| `store-locations.json` | `GET /stores` (cities with `store_locations[]`) |
| `hadiths.json` (top bar, home) | `GET /daily-hadiths/today` (by sistani.org's Hijri date); `GET /daily-hadiths/hijri-date` |
| `youtube.json` | `GET /youtube/videos`, `GET /youtube/playlists`, `GET /youtube/playlists/:playlistId/videos`. **See section 6: not a replacement yet.** |
| home page aggregate | `GET /homepage` (hadith, latest news, publications, videos, gallery slider + categories) |
| site search | `GET /search?q=` (posts, books, papers, gallery, audios) |
| contact, proxy visit, newsletter | already go through the API via `worker/` |
| `imamzain-legacy/` (al-Sahifa, Risalat al-Huquq), contests | stay in the repo; no API equivalent by design |

## 4. Shape notes that will bite

- **Books list hides series volumes.** `GET /books` returns 95 top-level books, not 138: each multi-part
  series is one parent with `parts_count`. The parent's detail has `parts[]` (each with `slug`,
  `part_number`, `pages`, `pdf_url`, `media`). Every volume still resolves by its own slug, and its
  detail has `parent`.
- **Series parents have `slug: null`** (the 9 synthesized parents). `/homepage` falls back to the id as
  the slug. Decide how a parent is addressed (by id, or ask for parent slugs; see section 7).
- **The 16 website book slugs with capitals or parentheses** (e.g.
  `Visiting-Imam-al-Sajjad-(peace-be-upon-him)`) are stored as-is, so existing URLs keep working.
- **List responses drop heavy fields:** post `body`, paper `abstract`, audio `peaks`. Fetch the detail
  for those.
- **`published_at` can be null:** one post has no date. `sort=newest` currently lists it first.
- **`published_year` is free text** (`" 2026 م"`, `"1958م"`), copied verbatim from the JSON.
- **Gallery categories differ from the JSON for 13 images** (#295 to #307): the DB says «مجالس», the JSON
  says «مناسبات». The DB value is deliberate.
- **Dates** (`published_at`, `taken_at`) are UTC midnight of the calendar date. Format them in UTC, or
  `Asia/Baghdad` shows the same day.

## 5. Recommended rendering split

Run the site as a real Next app on Workers (OpenNext, `@opennextjs/cloudflare`) instead of
`output: "export"`, so each route can choose its own mode:

| Mode | Routes |
|---|---|
| Fully static | `his-life`, `library/[collectionSlug]/...` (al-Sahifa, Risalat al-Huquq), about, services, visitation, links, contests, applications |
| ISR (static, refreshed) | `/`, `news`, `news/[slug]`, `news/archives`, `publications`, `publications/[slug]`, `library`, `library/books/[bookSlug]`, `media/images`, `media/audio`, `research/scientific-platform`, `services/stores`, `sitemap` |
| Client-side fetch | daily hadith, Hijri date, view counters |

- Unknown slugs on ISR routes must render on demand (`dynamicParams = true`), not 404.
- Tag fetches by content type (`posts`, `post:<slug>`, `books`, ...).
- Until on-demand revalidation exists (section 7), use a time-based `revalidate` (e.g. 300 s).

Open questions to settle in the spike:
- Does the OpenNext build fit the Worker size limit on the current Workers plan?
- Which incremental cache and tag cache to use (R2 + D1 or Durable Object)?
- Do the redirects in `public/_redirects` and the `worker/` routes carry over cleanly?

## 6. Data the API does not have yet

These pages must keep reading JSON (or drop the feature) until the API gains the fields:

| Website feature | Missing in API |
|---|---|
| `media/videos` and `media/videos/[slug]`, home video section | everything curated: per-video `slug`, custom `thumbnail`, curated title and HTML `desc`, `displayLocation`, `categories`, the website's own playlist grouping, 14 Abu Hamza videos from another channel |
| library `Conferences` filter, book cards' `otherNames` | no columns (68 and 91 books use them) |
| books' secondary category (4 books), `parts` on 2 standalone books | no columns |
| conference papers' `section` / `topic` badges and search, `part`, `authorDescription` | no columns |
| `hadiths.json` (32 old hadiths) | replaced on purpose by 360 Hijri-dated hadiths; use `/daily-hadiths/today` |
| books' and posts' legacy `views` | reset to 0 on purpose |

## 7. API-side work this depends on (not done yet)

1. **On-demand revalidation:** the API Worker calls the website when content is published, updated or
   deleted. Proposed contract:
   - Route: `POST /api/revalidate` on the website, reached through a service binding from
     `imamzain-api` to `imamzain-org`.
   - Header: `x-revalidate-secret: <shared secret>`.
   - Body: `{ "tags": ["posts", "post:<slug>"] }`.

   The website side handles it with `revalidateTag()`. Build the receiving end against this contract;
   the API side is pending.
2. **Schema additions for section 6:** YouTube curation, book `other_names` and conferences, research
   section, topic, volume and affiliation.
3. **Slugs for series parents**, if parents get their own pages.
4. **`sort=newest` should put null `published_at` last.**
