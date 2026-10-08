# Diff report: feeds

Nest (DB copy A) vs the Worker (DB copy B; unported routes fall through to a Nest on B), on the scrubbed prod dump of 2026-10-04.
Regenerate with `npm run diff -- feeds` in `worker/`.

- Requests: 18 (0 write scenarios)
- Same: 11
- Diffs: 13, unexplained: 0
- Routes skipped: 0

## Requests

| Request | A | B | Result |
|---|---|---|---|
| `GET /api/v1/homepage [ar anon]` | 200 | 200 | 2 diffs |
| `GET /api/v1/homepage [ar admin]` | 200 | 200 | 2 diffs |
| `GET /api/v1/homepage [en anon]` | 200 | 200 | 2 diffs |
| `GET /api/v1/homepage [en admin]` | 200 | 200 | 2 diffs |
| `GET /api/v1/homepage [- anon]` | 200 | 200 | 2 diffs |
| `GET /api/v1/homepage [- admin]` | 200 | 200 | 2 diffs |
| `GET /api/v1/rss/posts.xml [ar anon]` | 200 | 200 | 1 diff |
| `GET /api/v1/rss/posts.xml [ar admin]` | 200 | 200 | same |
| `GET /api/v1/rss/posts.xml [en anon]` | 200 | 200 | same |
| `GET /api/v1/rss/posts.xml [en admin]` | 200 | 200 | same |
| `GET /api/v1/rss/posts.xml [- anon]` | 200 | 200 | same |
| `GET /api/v1/rss/posts.xml [- admin]` | 200 | 200 | same |
| `GET /api/v1/sitemap.xml [ar anon]` | 200 | 200 | same |
| `GET /api/v1/sitemap.xml [ar admin]` | 200 | 200 | same |
| `GET /api/v1/sitemap.xml [en anon]` | 200 | 200 | same |
| `GET /api/v1/sitemap.xml [en admin]` | 200 | 200 | same |
| `GET /api/v1/sitemap.xml [- anon]` | 200 | 200 | same |
| `GET /api/v1/sitemap.xml [- admin]` | 200 | 200 | same |

## Diffs

| Key | A | B | Explained |
|---|---|---|---|
| `GET /api/v1/homepage [ar anon] $.data.hadith_of_day.id` | `"0086afb5-fc51-4021-9308-8807f5a9a3f6"` | `"e2a50c8b-57c0-464e-a7cf-5a41773e923b"` | yes |
| `GET /api/v1/homepage [ar anon] $.data.hadith_of_day.content` | `"قُتِلَ ابْنُ رَسُولِ اللَّهِ جائِعاً، قُتِلَ ابْنُ رَسُولِ اللَّهِ عَطْشاناً."` | `"فَإِنَّ الدُّنْيا بَعْدَكَ مُظْلِمَةٌ، وَالآخِرَةَ بِنُورِكَ مُشْرِقَةٌ."` | yes |
| `GET /api/v1/homepage [ar admin] $.data.hadith_of_day.id` | `"0086afb5-fc51-4021-9308-8807f5a9a3f6"` | `"e2a50c8b-57c0-464e-a7cf-5a41773e923b"` | yes |
| `GET /api/v1/homepage [ar admin] $.data.hadith_of_day.content` | `"قُتِلَ ابْنُ رَسُولِ اللَّهِ جائِعاً، قُتِلَ ابْنُ رَسُولِ اللَّهِ عَطْشاناً."` | `"فَإِنَّ الدُّنْيا بَعْدَكَ مُظْلِمَةٌ، وَالآخِرَةَ بِنُورِكَ مُشْرِقَةٌ."` | yes |
| `GET /api/v1/homepage [en anon] $.data.hadith_of_day.id` | `"0086afb5-fc51-4021-9308-8807f5a9a3f6"` | `"e2a50c8b-57c0-464e-a7cf-5a41773e923b"` | yes |
| `GET /api/v1/homepage [en anon] $.data.hadith_of_day.content` | `"قُتِلَ ابْنُ رَسُولِ اللَّهِ جائِعاً، قُتِلَ ابْنُ رَسُولِ اللَّهِ عَطْشاناً."` | `"فَإِنَّ الدُّنْيا بَعْدَكَ مُظْلِمَةٌ، وَالآخِرَةَ بِنُورِكَ مُشْرِقَةٌ."` | yes |
| `GET /api/v1/homepage [en admin] $.data.hadith_of_day.id` | `"0086afb5-fc51-4021-9308-8807f5a9a3f6"` | `"e2a50c8b-57c0-464e-a7cf-5a41773e923b"` | yes |
| `GET /api/v1/homepage [en admin] $.data.hadith_of_day.content` | `"قُتِلَ ابْنُ رَسُولِ اللَّهِ جائِعاً، قُتِلَ ابْنُ رَسُولِ اللَّهِ عَطْشاناً."` | `"فَإِنَّ الدُّنْيا بَعْدَكَ مُظْلِمَةٌ، وَالآخِرَةَ بِنُورِكَ مُشْرِقَةٌ."` | yes |
| `GET /api/v1/homepage [- anon] $.data.hadith_of_day.id` | `"0086afb5-fc51-4021-9308-8807f5a9a3f6"` | `"e2a50c8b-57c0-464e-a7cf-5a41773e923b"` | yes |
| `GET /api/v1/homepage [- anon] $.data.hadith_of_day.content` | `"قُتِلَ ابْنُ رَسُولِ اللَّهِ جائِعاً، قُتِلَ ابْنُ رَسُولِ اللَّهِ عَطْشاناً."` | `"فَإِنَّ الدُّنْيا بَعْدَكَ مُظْلِمَةٌ، وَالآخِرَةَ بِنُورِكَ مُشْرِقَةٌ."` | yes |
| `GET /api/v1/homepage [- admin] $.data.hadith_of_day.id` | `"0086afb5-fc51-4021-9308-8807f5a9a3f6"` | `"e2a50c8b-57c0-464e-a7cf-5a41773e923b"` | yes |
| `GET /api/v1/homepage [- admin] $.data.hadith_of_day.content` | `"قُتِلَ ابْنُ رَسُولِ اللَّهِ جائِعاً، قُتِلَ ابْنُ رَسُولِ اللَّهِ عَطْشاناً."` | `"فَإِنَّ الدُّنْيا بَعْدَكَ مُظْلِمَةٌ، وَالآخِرَةَ بِنُورِكَ مُشْرِقَةٌ."` | yes |
| `GET /api/v1/rss/posts.xml [ar anon] body line 7` | `"    <lastBuildDate>Wed, 07 Oct 2026 10:15:34 GMT</lastBuildDate>"` | `"    <lastBuildDate>Wed, 07 Oct 2026 10:15:35 GMT</lastBuildDate>"` | yes |

## Explanations

<!-- Everything above this heading is regenerated on every run; everything from it down is kept.
One bullet per explained diff: a backticked key, `*` matching anything, then why. Example:
- `GET /api/v1/posts* [*] $.data[*].views`: views are counted by the RL_VIEW binding now (D7).
-->

- `GET /api/v1/homepage [*] $.data.hadith_of_day.id`: no hadith is scheduled for the run's date in the dump, so `/daily-hadiths/today` draws at random from the unscheduled pool and locks it for the day, on each side independently (the same explanation as `daily-hadiths.md`).
- `GET /api/v1/homepage [*] $.data.hadith_of_day.content`: the content of the hadith above.
- `GET /api/v1/rss/posts.xml [*] body line 7`: `lastBuildDate` is the time of the response, so the two targets (a second apart) differ.

Intentional fix (not visible in this dump, covered by the `worker-only` test in `contract/feeds.test.ts`): the homepage's `news`, `publications` and `gallery.categories` leave out an item whose only translation is in a retired language, instead of returning it with `title`/`name: null` as Nest does (REHAUL-FINDINGS-2026-09, `feeds/homepage.service.ts:96`). The filter is in the query, so the blocks stay full (4 / 10 items). The dump has no such item.
