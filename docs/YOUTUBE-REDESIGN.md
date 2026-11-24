# YouTube content: redesign proposal

Status: proposal, 2026-11-10. Nothing here is built. No schema, migration or code changes yet.
Scope: how ImamZain.org stores, groups, shows and syncs the foundation's YouTube videos once the website
reads from the API instead of `imamzain.org/src/data/youtube.json`. Conferences and festivals are being
modelled separately as `events`; this proposal assumes videos can link to an event and stops there.

Short version:

- Today's `youtube.json` is a hand-copied, partial and inconsistent subset of the channel (109 of ~368
  videos). The API's mirror tables hold the channel faithfully but have no curation layer: nothing on the
  site could be built from them as they are.
- The channel itself is loosely organised. A third of its public items sit in no playlist, a quarter of
  everything public is 3- to 12-hour live relays from the Karbala shrines, and some series exist only as
  unlisted videos.
- **Recommendation (option B):** keep the YouTube mirror as a raw, sync-owned copy, and add a small
  editorial layer on top of it. That layer is *video entries* (slug, publish state, summary, speaker, kind)
  and *collections* (programme, du'a commentary, season, event), edited in the CMS. New uploads arrive as
  drafts, and a collection can follow a YouTube playlist so routine uploads need no CMS work.
- Section 8 lists the 14 questions the owner needs to answer before schema work starts.

---

## 1. What the website shows today

Source: `imamzain.org/src/data/youtube.json` (126 KB), read at build time through `dataFetcher`. Readers:

| File | What it does with the data |
|---|---|
| `src/app/page.tsx` (`homePlaylists`) | Homepage "المرئيات" block: the **first 7 groups in JSON order** with `displayLocation === "both"`, and only each group's **first video**. Clicking opens a modal YouTube embed. |
| `src/app/_components/videos.tsx` | Renders those 7 tiles (title, date string as-is, thumbnail). |
| `src/app/media/videos/page.tsx` | `/media/videos`: opens on the newest video across all groups, then shows the browser. |
| `src/app/media/videos/[slug]/page.tsx` | `/media/videos/{slug}`: static params = every video slug plus each group's "slug". Resolves a video first, then a group. Builds metadata. |
| `_components/videos-browser.tsx` | Player, an episode carousel for the current group, "الفيديوهات العامة" (one newest video per group, 12 at a time), and "البرامج والسلاسل" (groups with more than 1 video). Client-side search over title and `desc`. |
| `_components/episodes-list.tsx` | Episode carousel, sorted **oldest first by the parsed date string**. |
| `_components/sidebar.tsx` | First 6 multi-video groups plus static social links. |
| `_components/video-player.tsx` | `youtube.com/embed/{url}`, title, date string, share button. |
| `src/lib/youtube.ts` | `parseArabicDate` (two of the four date formats), `getGroupSlug` (= first video's slug), flatten/dedupe helpers. |

### Shape and what each field really does

Group (19 in the file):

| Field | Present | Use on the site | Notes |
|---|---|---|---|
| `id` | 19 | React key, dedupe | Hand-numbered 1–19. The array is ordered 19→1, and that order *is* the homepage order. |
| `title` | 19 | Breadcrumb, series cards, sidebar | Often differs from the YouTube playlist title. |
| `url` | 19 | **Never read** | A mix of playlist URLs, plain video URLs, bare video IDs and truncated IDs (`PLeOoNvezNzZ0`), so it can't be used to map groups to playlists. |
| `displayLocation` | 19 | Filters the homepage (`both`) and gallery (`internal`/`both`) | **Always `both`**, so the field has no effect today. |
| `categories` | 3 | **Never read** | `["general"]` on the three single-video groups. |
| `videos` | 19 | Everything | 6 groups (11–16) hold a single video: standalone videos wrapped as "groups" so they can appear at all. |

Video (109 entries, 108 unique YouTube IDs):

| Field | Use on the site | Problems found |
|---|---|---|
| `title` | Everywhere | Fine. |
| `url` | The bare 11-char YouTube ID, used for the embed | One is truncated (`MKnohtN8`, group 2), so its embed is broken. |
| `slug` | The only routing key: `/media/videos/{slug}` | Unique, Latin transliteration. These **109 URLs are live and indexed**, so they must keep working. |
| `date` | Shown raw; parsed for sorting | **Four formats**: ISO (20), `dd‏/mm‏/yyyy` with hidden RLM marks (most), Arabic month names (`31 آب، 2024`, `8 ابريل، 2024`: 37 entries the parser **can't read**, so they sort as epoch 0), and empty (14). These are mostly *the date someone added the video to the site* (all 20 Risalat al-Huquq episodes are `2026-10-18`; all 15 Makarim al-Akhlaq are `31 آب، 2024`), not YouTube publish dates. Because episode order comes from these dates, ties and failed parses fall back to JSON order. |
| `desc` | **Never rendered on the page.** Only used for client search and as the `<meta description>` / OG description | It is **HTML** (`<h2>`, `<p>`, emoji, hashtags), so raw HTML ends up in meta tags. 22 are empty. All 20 Risalat al-Huquq entries still contain the unfilled template placeholder `{{نص_الحق}}`. |
| `thumbnail` | Every card and OG image | **Series artwork, not per-episode thumbnails.** All episodes in a group share one image (20 × `rsalat-alhqoq-imamzain-youtube.jpg`, 15 × `مكارم الاخلاق.png`), so episode carousels show N identical tiles. Two schemes: 37 are site-relative `general/...` (served from the website's `/public`), 72 are `cdn.imamzain.org/thumbnails/...` with Arabic names and spaces. |
| `categories` | **Never read** | 3 entries. |

Other defects:
- Duplicate: `XAPZ6Bt3gwM` appears twice in group 1 under two titles and two slugs.
- The site's groups are partial copies of YouTube playlists: "ثلاثون درساً" has 6 of 18, "مجالس عزاء" 5 of 15, "الملتقى الثاني البقيع" 4 of 5 (plus one video from elsewhere). Nobody updates them when the channel changes.
- A group's URL is its first video's slug, so a "series" page and that episode's page share one URL.

---

## 2. What the API has today

`prisma/schema.prisma`: a faithful mirror and nothing more.

```
youtube_videos         video_id (unique), title, description, thumbnail_url, channel_id, channel_title,
                       published_at, duration (ISO 8601), view_count, like_count, last_synced_at
youtube_playlists      playlist_id (unique), title, description, thumbnail_url, item_count, channel_id,
                       published_at, last_synced_at
youtube_playlist_items (playlist_id, video_id) PK, position          -- cascades from both sides
```

Sync (`worker/src/jobs/youtube-sync.ts`, cron every 6 h, ~10–20 quota units): the newest 50 uploads, every
channel playlist (≤ 50) with ≤ 200 items each, hydrated through `videos.list`. Playlist joins are replaced
on each run, and vanished rows are pruned with a 25 % safety cap.

Endpoints (`worker/src/features/youtube`, all public, read-only): `GET /youtube/videos`,
`GET /youtube/playlists`, `GET /youtube/playlists/:playlistId/videos`. The homepage feed
(`features/feeds/homepage.ts`) takes the newest 7 mirror rows from the foundation's channel.

### What has no place in the DB

| Website need | In the mirror? |
|---|---|
| Site slug per video (the 109 live URLs) | **No** |
| Hide or show a video on the site; draft/publish | **No.** Every mirrored row is public on the API. |
| Curated groups that differ from YouTube playlists (subsets, standalone items, cross-playlist) | **No** |
| Group kind (programme, series, season, event) | **No** |
| Group slug, cover art, order, featured, homepage placement (`displayLocation`) | **No** |
| Episode order chosen by an editor | Only YouTube's `position` |
| Site-written summary (the HTML `desc`) | **No.** Only YouTube's own description. |
| Custom/series thumbnail | **No.** Only YouTube's per-video thumbnail. |
| Speaker/presenter | **No.** `speakers` exists for audios but isn't linked. |
| Link to an event | **No** (`events` doesn't exist yet) |
| Shorts vs. long-form vs. live replay | **No.** Only `duration`, and nothing marks live broadcasts. |
| Unlisted videos (the 14 Abu Hamza episodes, see §3) | **No.** The sync only discovers public uploads and playlist items. |
| CMS editing of any of the above | **No write endpoints** |

Two live problems with the current mirror, even before any redesign:
1. **The homepage feed would surface Karbala live relays and shorts.** "Newest 7 uploads" on this channel
   are often 8-hour shrine broadcasts (see §3).
2. **Prune cascades.** Anything editorial later attached to `youtube_videos` by FK would be deleted with
   it when a video goes private. The editorial layer must not cascade from the mirror.

---

## 3. What the channel actually looks like

Public pages of `@imamzainorg` (channel `UCGccH_OeEhhWGUE1xeIsxeA`), read 2026-11-10: ~2 k subscribers,
**354 items** in the header. Listed:

| Tab | Items | What they are |
|---|---|---|
| Videos | 281 | Long-form: 54 under 3 min, 98 of 3–20 min, 117 of 20–60 min, 12 over 1 h |
| Shorts | 19 | Mostly the "بصائر للناس" clip series (several presenters) plus Risalat al-Huquq clips |
| Live | 53 | **32 are relays from the Imam Hussain shrine** ("Karbala live", 1–12 h each). Most of the other 21 are relays "من العتبتين المقدستين" or untitled "البث المباشر". Few, if any, are the foundation's own events. |

**25 playlists**, by what they are:

| Kind | Playlists (YouTube item count) |
|---|---|
| **Programmes**: produced, episodic studio series | ويجازي بالجليل (12) · خير شهر (10) · الشهر الطهور (29, typed as a *podcast*) · سيرة زين العباد (7) · من رحيق السجاد (10) · برنامج محطات مع دعاء عرفة (10) · برنامج مع الغدير (4) · فيض الطفوف (8, typed as a *course*) · نفحات تربوية واجتماعية (4) · مفهوم المنهج التربوي والاجتماعي (4) · في رحاب العطاء السجادي (2) · لمحات من رسالة الحقوق (1) |
| **Text readings/commentaries** (one text, many parts) | رسالة الحقوق (20) · دعاء مكارم الاخلاق (15) · ثلاثون درساً من دعاء أبي حمزة الثمالي (18) · ادعية الايام (7) |
| **Seasons**: majalis by occasion or year | شهر محرم الحرام / العشرة السجادية (10) · مجالس شهر محرم الحرام (6) · مجالس العزاء 1448 هـ (16, *course*) · مجالس عزاء (15) · المجلس الرمضاني 1446 (4) |
| **Events**: conferences, forums | جلسات المؤتمر العلمي الدولي الاول (14) · الملتقى الثاني البقيع: الهوية والتاريخ (5) · الملتقى التشاوري (2) |
| **Relays** | البث المباشر (7, Karbala) |

Findings that shape the design:
- **114 of 353 public items are in no playlist**, 49 of them long-form. They include whole informal series:
  "نفائس" (Sheikh Maan al-Sahlani), Sheikh Hussein al-Asadi's Hajj talks (4+), "نفحات رمضانية", the
  "يوم المناجاة" talks, single majalis, the Sahla mosque documentary, the Tal Afar evening, the book-discussion
  session and institutional clips.
- **The "~15 videos not on the channel" are 14 + 1.** The 14 are the Abu Hamza commentary episodes of 1439 AH
  (4) and 1440 AH (10). **They are on the channel but unlisted**: oEmbed resolves them to @imamzainorg,
  yet they appear in no public tab or playlist. The remaining one is the truncated ID `MKnohtN8`, a typo
  in the JSON.
- **Duplicate uploads.** Risalat al-Huquq exists twice: 20 new uploads in the playlist ("رسالة الحقوق للإمام
  زين العابدين (عليه السلام) | حق …") and 12 older ones outside it ("رسالة الحقوق - حق …").
- Durations: roughly 50 long-form videos under 3 min are vertical-style clips uploaded as normal videos, so
  "short" can't be inferred from duration alone.
- The site today shows 94 of the channel's 281 long-form videos, and none of the shorts or live items.

---

## 4. Design principles

1. **YouTube is the host, the site is the library.** Store YouTube facts (title, publish date, duration,
   thumbnail, availability) by syncing them; store editorial facts (slug, grouping, order, summary, speaker,
   event, visibility) in the CMS. Never mix the two in one column.
2. **Nothing appears on the site unless someone meant it to**, but routine uploads to a known series need
   zero CMS work.
3. **Group by what a visitor looks for** (a programme, a du'a, a season of majalis, an event, a speaker), not
   by however the YouTube playlists happen to be cut.
4. **Kinds are not groups.** Short / long / live replay is a property of a video, used for layout (vertical
   rail, hide relays), not a collection.
5. **Keep every live URL.** The 109 `/media/videos/{slug}` URLs keep resolving.
6. Plain text or markdown for site-written copy. No HTML in the data, and nothing raw in meta tags.

---

## 5. Options

### Option A: Mirror plus overlay columns (YouTube playlists *are* the site's groups)

Add editorial columns directly to the mirror: `youtube_videos.slug / is_hidden / summary / speaker_id`,
and `youtube_playlists.slug / kind / is_shown / sort_order / cover_media_id / event_id`. The site's series
are exactly the YouTube playlists marked `is_shown`, ordered by YouTube position. Organisation happens on
YouTube: to fix a group, fix the playlist.

- \+ Smallest change: no new tables, the CMS gets a few toggles, and the sync stays as it is.
- \+ One source of truth; the YouTube channel and the site never disagree.
- − The site inherits the channel's mess until someone tidies YouTube (114 orphans, unlisted series,
  duplicate uploads), and the team has to keep doing that.
- − Can't show a curated subset, a standalone video, or a group mixing two playlists.
- − Editorial columns sit on rows the sync upserts and prunes. A video going private deletes its slug and
  summary, which breaks its URL.
- − One playlist = one group: no video in two groups (e.g. a Muharram majlis that is also an event session).

### Option B: Editorial layer over a raw mirror (**recommended**)

Keep the three mirror tables exactly as the sync owns them. Add (names indicative):

```
videos                    -- one row per video the site knows about; never cascades from the mirror
  id, youtube_video_id (unique, plain text, NOT an FK-cascade), slug (unique),
  kind: long | short | live_replay        (from sync, overridable)
  status: inbox | published | hidden      (inbox = arrived from sync, not yet reviewed)
  title_override?, summary? (markdown), cover_media_id? (else YouTube thumbnail),
  speaker_id? -> speakers, event_id? -> events, published_at_override?,
  is_featured, created_at/updated_at/deleted_at, added_by
video_collections
  id, slug (unique), kind: programme | commentary | season | event | topic,
  title/description (translations, like other entities), cover_media_id?, speaker_id?, event_id?,
  source_playlist_id?  -- YouTube playlist this collection follows (auto-adds new items)
  order_mode: manual | playlist | date_asc | date_desc,
  sort_order, is_published, show_on_homepage, created_at/...
video_collection_items
  collection_id, video_id, position, label? ("الحلقة ٣", "الليلة السابعة")
  -- a video can sit in several collections
```

Sync, extended:
- Also fetch the channel's auto-playlists that split uploads by format: `UULF…` (long-form), `UUSH…`
  (shorts), `UULV…` (live). This is how `kind` gets set without guessing. *These are undocumented; verify
  them in a spike, and fall back to `liveStreamingDetails` plus a `/shorts/{id}` probe if they fail.*
- Fetch any `videos.youtube_video_id` the mirror lacks by ID. That brings in **unlisted** videos the editor
  added by URL (the Abu Hamza series).
- On a new upload: create a `videos` row with `status = inbox`. If it is in a playlist that a collection
  follows, either auto-publish it into that collection (default for programmes) or leave it in the inbox
  (see Q1).
- On vanish (private or deleted): mark the `videos` row unavailable and stop serving it. Never delete
  editorial rows. The slug can 301 to its collection.
- Live relays: `kind = live_replay`, stay in the inbox (never auto-published) unless an editor says so.

- \+ The site's structure is the foundation's own: programmes, du'a commentaries, Muharram seasons and events,
  regardless of how YouTube is cut. Orphan series ("نفائس", the Hajj talks) become collections without
  touching YouTube.
- \+ Following a playlist keeps routine work at zero for well-run series. The inbox catches everything else,
  so relays never leak onto the homepage.
- \+ Clean links to `speakers` (shared with audios) and `events`.
- \+ Editorial data survives YouTube changes, and the URLs stay stable.
- − Three new tables, a CMS inbox, and collection editors. That is about the size of the gallery/audios
  features already in the API.
- − Two places to organise (YouTube and the CMS) unless the team agrees which one leads (Q3).

### Option C: CMS-owned catalogue, YouTube as a dumb host

Drop the playlist mirror. Editors add each video in the CMS by pasting a URL. The API fetches its metadata
once, then a light job refreshes duration, thumbnail and availability. Collections are as in B.

- \+ Simplest mental model: only what an editor added exists. No inbox, no relays, no sync of playlists.
- \+ The smallest sync (one `videos.list` per 50 known IDs).
- − Every upload is manual CMS work. "Latest videos" is only as fresh as the editors.
- − The ~260 channel videos not on the site today need a one-off bulk import anyway.
- − Throws away a working, already-hardened sync.

### Comparison

| | A: overlay | **B: editorial layer** | C: CMS-owned |
|---|---|---|---|
| New tables | 0 (columns) | 3 | 2–3 (and drops 2) |
| Who organises | YouTube | CMS, with YouTube playlists as an optional feed | CMS |
| Work per routine upload | Tidy the playlist on YouTube | None if in a followed playlist; otherwise one inbox click | Paste the URL, fill the form |
| Subsets / standalones / multi-group | No | Yes | Yes |
| Unlisted videos | No | Yes (by ID) | Yes |
| Relays and shorts kept off pages | Manual hide | By kind and inbox | Never added |
| Survives a video going private | Loses editorial data | Yes | Yes |
| Speakers / events links | On the playlist only | Video and collection | Video and collection |

---

## 6. Recommended design in detail (option B)

### 6.1 Collections the current content maps to

The first CMS pass will roughly look like this (to be confirmed by the owner):

| Collection (kind) | Source |
|---|---|
| رسالة الحقوق (commentary) | Playlist, 20 items; hide the 12 old duplicate uploads |
| دعاء مكارم الأخلاق (commentary) | Playlist, 15 |
| شرح دعاء أبي حمزة الثمالي (commentary): one collection with three editions (1439, 1440, ثلاثون درساً), or three collections | 14 unlisted videos added by ID, plus the 18-item playlist |
| ويجازي بالجليل, خير شهر, الشهر الطهور, سيرة زين العباد, من رحيق السجاد, محطات مع دعاء عرفة, مع الغدير, فيض الطفوف, نفحات…, مفهوم المنهج…, نفائس, بصائر للناس (shorts), الحج مع الشيخ حسين الأسدي (programme) | Playlists where they exist; the last three are built from orphans |
| محرم ١٤٤٧, محرم ١٤٤٨, مجالس العزاء (المناسبات), المجلس الرمضاني ١٤٤٦ (season) | Playlists |
| المؤتمر العلمي الدولي الأول, الملتقى الثاني البقيع, الملتقى التشاوري, الأمسية الفكرية في تلعفر (event, linked to `events`) | Playlists and orphans |
| Standalone videos (documentary, visits, single talks) | No collection; listed under "all videos" |
| Karbala relays | Hidden (kind `live_replay`, never published) |

### 6.2 What the website shows where

| Place | Content |
|---|---|
| Homepage "المرئيات" | Featured videos first, then the newest **published long-form** videos (never shorts or relays). One tile per collection, as today, so a 20-episode drop doesn't fill the block. |
| `/media/videos` (hub) | Hero: the latest featured video. Rows: **البرامج** · **شروح الأدعية والرسائل** · **المجالس والمناسبات** · **المؤتمرات والفعاليات** · **مقاطع قصيرة** (a vertical rail of shorts) · then "كل الفيديوهات" with filters (kind, collection, speaker, year) and **server-side search** (title, summary, speaker). |
| `/media/videos/series/{slug}` *(new)* | Collection page: cover, description, speaker, episodes in the collection's order, and a link to its event. |
| `/media/videos/{slug}` (kept) | Watch page: player, title, **real publish date** (from YouTube unless overridden), speaker link, the summary rendered as text, prev/next within the primary collection, related videos. Meta description = plain-text summary, else the trimmed YouTube description. |
| Event page *(events work)* | Embeds the event's collection. |
| Speaker page | Their videos alongside their audios. |
| Shorts | Rail only; each opens in a vertical modal. No separate page unless wanted. |

URL continuity: import all 108 unique existing slugs into `videos.slug`. Old "group URLs" were the first
episode's slug, so they keep resolving as that episode's page, which now links to the series. No redirects
are needed. Slugs for newly synced videos are generated (transliteration, as the books/posts slugs are)
and editable while in the inbox.

### 6.3 What the CMS edits

- **Inbox**: new uploads, with thumbnail, kind, duration and the YouTube playlist they came from. Actions:
  publish (pick a collection), hide, or edit and publish.
- **Video**: slug, title override, summary (markdown), speaker, event, cover override, featured, status,
  and collections with episode labels. YouTube fields are read-only and visibly marked as synced.
- **Collection**: kind, titles/description, cover, speaker, event, followed playlist, order mode
  (drag-and-drop when manual), homepage flag, published flag.
- **Add by URL**: for unlisted or other-channel videos. A fetch by ID creates the mirror row and the
  `videos` row together.
- No editing of anything YouTube owns, and no write calls to YouTube (the API key stays read-only).

### 6.4 Sync and freshness

Same 6-hour cron and guard, plus:
- The format auto-playlists (`UULF`/`UUSH`/`UULV`) or a fallback for `kind`.
- ID-based refresh of every known `videos.youtube_video_id`, which covers unlisted videos (≤ 8 calls for
  ~400 videos).
- Inbox creation and followed-playlist placement in the same transaction as the upsert.
- Prune → mark unavailable on the editorial side; the mirror row can still be deleted.
- Quota stays well under 100 units per run.
- Optional later: a CMS "sync now" button, rate-limited by the existing freshness guard.

### 6.5 Migration path (for the later implementation sessions)

1. Additive migration: the new tables, plus `kind`/live columns on the mirror if needed.
2. Sync extension and a backfill: every mirrored video gets a `videos` row with `status = inbox`. The 108
   JSON IDs become `published` with their JSON slugs; the 14 unlisted episodes are fetched by ID.
3. A seed script maps the 19 JSON groups to collections (the mapping in §6.1), keeping JSON titles where
   the owner prefers them. Old `desc` HTML is converted to markdown, or dropped where it is template text.
4. API read endpoints (videos, collections, hub feed); then CMS endpoints; then the website switch.
5. The existing `/youtube/*` endpoints stay until nothing reads them (contract rule), then retire.

---

## 7. Content clean-ups on YouTube (owner, independent of the build)

- Decide on the 12 old Risalat al-Huquq uploads (unlist or delete), now that a 20-part playlist exists.
- Make the Abu Hamza 1439/1440 episodes public, or keep them unlisted and add them on the site only.
- Consider removing the Karbala relay playlist from the channel's public shelf, or at least keeping relays
  out of the foundation's own playlists.
- Create playlists for "نفائس", "بصائر للناس" and the Hajj talks if YouTube should mirror the site's
  programmes. Optional under B.
- Fix the `{{نص_الحق}}` template text before any description is migrated.

---

## 8. Questions for the owner

1. **Approval:** should new uploads appear on the site automatically, or only after an editor publishes
   them? (B can do either per collection; default proposal: auto for followed programme playlists, inbox
   for everything else.)
2. **Live relays:** should the Karbala shrine broadcasts appear on the site at all? Are any live streams
   the foundation's own (events) that should be kept?
3. **Where series are organised:** will the team keep YouTube playlists tidy (then collections follow them),
   or is the CMS the place that organises and YouTube just hosts?
4. **Collection kinds:** are programme / du'a & text commentary / season (majalis) / event / topic the right
   sections? Any missing (e.g. "documentaries", "institutional news")?
5. **Abu Hamza:** one collection with three editions (1439, 1440, ثلاثون درساً) or three separate collections?
   And should the unlisted episodes become public on YouTube?
6. **Shorts:** show them on the site? Only as a rail on the videos hub, or also on the homepage?
7. **Thumbnails:** keep the custom series artwork (one image per series), use YouTube's per-episode
   thumbnails, or artwork on series cards and YouTube thumbnails on episodes (proposal)?
8. **Descriptions:** who writes the site summaries? Is the YouTube description good enough as the default?
   What should replace `{{نص_الحق}}`: the text of each right, perhaps linked to a Risalat al-Huquq page?
9. **Speakers:** link videos (and collections) to the existing speakers list shared with audios? Many
   presenters appear (Sheikh Hussein al-Asadi, Sheikh Maan al-Sahlani, Sheikh Farhan al-Saadi, Sheikh Jaafar
   al-Waili, …).
10. **Events:** is a conference's video set exactly one collection linked to the event, or should individual
    videos also link to an event (e.g. a Muharram majlis that was part of a festival)?
11. **Old duplicates and orphans:** hide the 12 old Risalat al-Huquq uploads on the site? Should the ~49
    orphan long-form videos be reviewed one by one, or published in bulk as standalones?
12. **Homepage:** newest uploads, editor-featured, or featured first and then newest (proposal)?
13. **Episode order:** follow the YouTube playlist position, publish date, or manual order per collection
    (proposal: per-collection choice, default playlist position)?
14. **Languages:** video and collection text Arabic-only, or translatable like posts and books?

---

### Appendix: JSON group → YouTube playlist

| JSON id | JSON title | YouTube playlist | JSON / YouTube items |
|---|---|---|---|
| 19 | رسالة الحقوق | `PLce_GVMLUUXs` رسالة الحقوق | 20 / 20 |
| 18 | شرح دعاء ابي حمزة 1439 | none public (unlisted videos) | 4 / – |
| 17 | شرح دعاء ابي حمزة 1440 | none public (unlisted videos) | 10 / – |
| 16, 15, 14, 13, 12, 11 | single videos | none (14: no playlist; 15: episode 3 of فيض الطفوف) | 1 each |
| 10 | ثلاثون درساً من دعاء أبي حمزة | `PLi1h0SEPzOA5H9j…` | 6 / 18 |
| 1 | الملتقى الثاني البقيع | `PLi1h0SEPzOA7_e_…` | 5 entries, 4 unique (1 duplicated) / 5 |
| 2 | العشرة السجادية ١٤٤٧ | `PLi1h0SEPzOA6grh…` | 10 (1 broken id) / 10 |
| 3 | مجالس عزاء ١٤٤٧ | `PLi1h0SEPzOA7qCK…` مجالس عزاء | 5 / 15 |
| 4 | مجالس شهر محرم ١٤٤٧ | `PLi1h0SEPzOA5FgG…` | 6 / 6 |
| 5 | **The YouTube team owns it**, as with everything about how videos are organised: playlists, listing state, order and descriptions. The site shows only what the channel exposes publicly (uploads and playlists). Choosing unlisted videos through the CMS is a possible later feature, not part of this build. |
| 6 | مفهوم المنهج التربوي | `PLi1h0SEPzOA7Q9g…` | 4 / 4 |
| 7 | نفحات تربوية واجتماعية | `PLi1h0SEPzOA79nt…` | 4 / 4 |
| 8 | من دعاء مكارم الاخلاق | `PLi1h0SEPzOA6oG2…` | 15 / 15 |
| 9 | الملتقى التشاوري الاول | `PLi1h0SEPzOA6AnH…` | 2 / 2 |

Not on the site at all: فيض الطفوف (7 of 8), مجالس العزاء 1448, في رحاب العطاء السجادي, لمحات من رسالة الحقوق,
المجلس الرمضاني 1446, المؤتمر العلمي الدولي الأول (14), مع الغدير, محطات مع دعاء عرفة, ادعية الايام, من رحيق
السجاد, خير شهر, الشهر الطهور (29), سيرة زين العباد, all shorts, all live.

---

## 9. Decisions (owner, 2026-11-23)

These replace the defaults above wherever the two differ.

| # | Decision |
|---|---|
| 1 | One CMS switch, **auto-publish new uploads**. On: every new upload goes live. Off: new uploads wait for an editor. In both modes an editor can hide any video, publish a waiting one, mark videos as featured and set the order of featured videos and of series on the hub. |
| 2 | **No live content on the site.** Live and live-replay items are never served, and neither is the "البث المباشر" playlist, until the owner says otherwise. |
| 3 | **The team keeps YouTube playlists tidy, so a series is a YouTube playlist.** No series are built in the CMS. Videos that are in no playlist show as standalone videos. The CMS can still hide a whole playlist. |
| 4 | Sections: programmes / du'a and text commentaries / majalis by occasion / conferences and events. Each playlist is assigned to one section in the CMS. |
| 5 | **Open.** Re-asked in plainer terms: see the note below. |
| 6 | **Shorts: the owner decides after seeing them.** The API marks each video's kind. The website PR shows the shorts rail on its preview for approval. |
| 7 | Thumbnails come from YouTube: each video's own, and the playlist's for a series. No custom artwork. |
| 8 | Descriptions come from YouTube, with no CMS override. 20 YouTube descriptions still contain `{{نص_الحق}}`; the team fixes them on YouTube. |
| 9 | Videos and series link to the shared speakers list. |
| 10 | **Deferred.** The owner wants to see it first. The `events` model doesn't exist yet, so event links wait for it; conference playlists show under "conferences and events" meanwhile. |
| 11 | Hide the old Risalat al-Huquq uploads, including the 2024 playlist `PLi1h0SEPzOA56vCK9FeWmRGJBlLkIIg4o` (10 items). Videos that are in no playlist are published in bulk. |
| 12 | Homepage: featured videos first, then the newest long-form videos, one tile per series. Never shorts or live. |
| 13 | Episode order is the YouTube playlist order. No CMS override. |
| 14 | Arabic only. |

Consequence of 5: the 14 unlisted Abu Hamza episodes of 1439 and 1440 leave the site, unless the team adds them
to a public playlist; the site follows a playlist even when some of its videos are unlisted. Their old URLs,
and any other old slug that no longer resolves, redirect to `/media/videos`.

Ops finding, 2026-11-23: the YouTube sync has not run since 2026-10-19, because `YOUTUBE_CHANNEL_ID` was
never set on the Worker. The channel is `UCGccH_OeEhhWGUE1xeIsxeA`.
