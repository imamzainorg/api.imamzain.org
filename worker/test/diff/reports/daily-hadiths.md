# Diff report: daily-hadiths

Nest (DB copy A) vs the Worker (DB copy B; unported routes fall through to a Nest on B), on the scrubbed prod dump of 2026-10-04.
Regenerate with `npm run diff -- daily-hadiths` in `worker/`.

- Requests: 82 (1 write scenario)
- Same: 76
- Diffs: 12, unexplained: 0
- Routes skipped: 0

## Requests

| Request | A | B | Result |
|---|---|---|---|
| `GET /api/v1/daily-hadiths [ar anon]` | 200 | 200 | same |
| `GET /api/v1/daily-hadiths [ar admin]` | 200 | 200 | same |
| `GET /api/v1/daily-hadiths [en anon]` | 200 | 200 | same |
| `GET /api/v1/daily-hadiths [en admin]` | 200 | 200 | same |
| `GET /api/v1/daily-hadiths [- anon]` | 200 | 200 | same |
| `GET /api/v1/daily-hadiths [- admin]` | 200 | 200 | same |
| `GET /api/v1/daily-hadiths?page=2&limit=5 [- anon]` | 200 | 200 | same |
| `GET /api/v1/daily-hadiths?page=2&limit=5 [- admin]` | 200 | 200 | same |
| `GET /api/v1/daily-hadiths/admin [ar anon]` | 401 | 401 | same |
| `GET /api/v1/daily-hadiths/admin [ar admin]` | 200 | 200 | same |
| `GET /api/v1/daily-hadiths/admin [en anon]` | 401 | 401 | same |
| `GET /api/v1/daily-hadiths/admin [en admin]` | 200 | 200 | same |
| `GET /api/v1/daily-hadiths/admin [- anon]` | 401 | 401 | same |
| `GET /api/v1/daily-hadiths/admin [- admin]` | 200 | 200 | same |
| `GET /api/v1/daily-hadiths/admin?page=2&limit=5 [- anon]` | 401 | 401 | same |
| `GET /api/v1/daily-hadiths/admin?page=2&limit=5 [- admin]` | 200 | 200 | same |
| `GET /api/v1/daily-hadiths/admin/0086afb5-fc51-4021-9308-8807f5a9a3f6 [ar anon]` | 401 | 401 | same |
| `GET /api/v1/daily-hadiths/admin/0086afb5-fc51-4021-9308-8807f5a9a3f6 [ar admin]` | 200 | 200 | same |
| `GET /api/v1/daily-hadiths/admin/0086afb5-fc51-4021-9308-8807f5a9a3f6 [en anon]` | 401 | 401 | same |
| `GET /api/v1/daily-hadiths/admin/0086afb5-fc51-4021-9308-8807f5a9a3f6 [en admin]` | 200 | 200 | same |
| `GET /api/v1/daily-hadiths/admin/0086afb5-fc51-4021-9308-8807f5a9a3f6 [- anon]` | 401 | 401 | same |
| `GET /api/v1/daily-hadiths/admin/0086afb5-fc51-4021-9308-8807f5a9a3f6 [- admin]` | 200 | 200 | same |
| `GET /api/v1/daily-hadiths/admin/02aaa0ce-54b1-422d-b348-db4b25df62ee [ar anon]` | 401 | 401 | same |
| `GET /api/v1/daily-hadiths/admin/02aaa0ce-54b1-422d-b348-db4b25df62ee [ar admin]` | 200 | 200 | same |
| `GET /api/v1/daily-hadiths/admin/02aaa0ce-54b1-422d-b348-db4b25df62ee [en anon]` | 401 | 401 | same |
| `GET /api/v1/daily-hadiths/admin/02aaa0ce-54b1-422d-b348-db4b25df62ee [en admin]` | 200 | 200 | same |
| `GET /api/v1/daily-hadiths/admin/02aaa0ce-54b1-422d-b348-db4b25df62ee [- anon]` | 401 | 401 | same |
| `GET /api/v1/daily-hadiths/admin/02aaa0ce-54b1-422d-b348-db4b25df62ee [- admin]` | 200 | 200 | same |
| `GET /api/v1/daily-hadiths/admin/00000000-0000-4000-8000-000000000000 [ar anon]` | 401 | 401 | same |
| `GET /api/v1/daily-hadiths/admin/00000000-0000-4000-8000-000000000000 [ar admin]` | 404 | 404 | same |
| `GET /api/v1/daily-hadiths/admin/00000000-0000-4000-8000-000000000000 [en anon]` | 401 | 401 | same |
| `GET /api/v1/daily-hadiths/admin/00000000-0000-4000-8000-000000000000 [en admin]` | 404 | 404 | same |
| `GET /api/v1/daily-hadiths/admin/00000000-0000-4000-8000-000000000000 [- anon]` | 401 | 401 | same |
| `GET /api/v1/daily-hadiths/admin/00000000-0000-4000-8000-000000000000 [- admin]` | 404 | 404 | same |
| `GET /api/v1/daily-hadiths/today [ar anon]` | 200 | 200 | 2 diffs |
| `GET /api/v1/daily-hadiths/today [ar admin]` | 200 | 200 | 2 diffs |
| `GET /api/v1/daily-hadiths/today [en anon]` | 200 | 200 | 2 diffs |
| `GET /api/v1/daily-hadiths/today [en admin]` | 200 | 200 | 2 diffs |
| `GET /api/v1/daily-hadiths/today [- anon]` | 200 | 200 | 2 diffs |
| `GET /api/v1/daily-hadiths/today [- admin]` | 200 | 200 | 2 diffs |
| `GET /api/v1/daily-hadiths/trash [ar anon]` | 401 | 401 | same |
| `GET /api/v1/daily-hadiths/trash [ar admin]` | 200 | 200 | same |
| `GET /api/v1/daily-hadiths/trash [en anon]` | 401 | 401 | same |
| `GET /api/v1/daily-hadiths/trash [en admin]` | 200 | 200 | same |
| `GET /api/v1/daily-hadiths/trash [- anon]` | 401 | 401 | same |
| `GET /api/v1/daily-hadiths/trash [- admin]` | 200 | 200 | same |
| `GET /api/v1/daily-hadiths/trash?page=2&limit=5 [- anon]` | 401 | 401 | same |
| `GET /api/v1/daily-hadiths/trash?page=2&limit=5 [- admin]` | 200 | 200 | same |
| `scenario lifecycle #1 POST /api/v1/daily-hadiths [- admin]` | 201 | 201 | same |
| `scenario lifecycle #2 POST /api/v1/daily-hadiths [- admin]` | 201 | 201 | same |
| `scenario lifecycle #3 POST /api/v1/daily-hadiths [- admin]` | 409 | 409 | same |
| `scenario lifecycle #4 POST /api/v1/daily-hadiths [- admin]` | 400 | 400 | same |
| `scenario lifecycle #5 POST /api/v1/daily-hadiths [- admin]` | 400 | 400 | same |
| `scenario lifecycle #6 POST /api/v1/daily-hadiths [- admin]` | 400 | 400 | same |
| `scenario lifecycle #7 POST /api/v1/daily-hadiths [- admin]` | 400 | 400 | same |
| `scenario lifecycle #8 PATCH /api/v1/daily-hadiths/{{a}} [- admin]` | 200 | 200 | same |
| `scenario lifecycle #9 PATCH /api/v1/daily-hadiths/{{b}} [- admin]` | 409 | 409 | same |
| `scenario lifecycle #10 PATCH /api/v1/daily-hadiths/{{b}} [- admin]` | 200 | 200 | same |
| `scenario lifecycle #11 PATCH /api/v1/daily-hadiths/{{b}} [- admin]` | 400 | 400 | same |
| `scenario lifecycle #12 PATCH /api/v1/daily-hadiths/00000000-0000-4000-8000-000000000000 [- admin]` | 404 | 404 | same |
| `scenario lifecycle #13 GET /api/v1/daily-hadiths?date=2999-05-15 [en anon]` | 200 | 200 | same |
| `scenario lifecycle #14 GET /api/v1/daily-hadiths?from=2999-05-01&to=2999-05-31 [- anon]` | 200 | 200 | same |
| `scenario lifecycle #15 GET /api/v1/daily-hadiths?date=2999-05-15&from=2999-05-01&to=2999-05-31 [- anon]` | 400 | 400 | same |
| `scenario lifecycle #16 GET /api/v1/daily-hadiths?from=2999-05-01 [- anon]` | 400 | 400 | same |
| `scenario lifecycle #17 GET /api/v1/daily-hadiths?from=2999-06-01&to=2999-05-01 [- anon]` | 400 | 400 | same |
| `scenario lifecycle #18 GET /api/v1/daily-hadiths?date=2999-02-30 [- anon]` | 400 | 400 | same |
| `scenario lifecycle #19 GET /api/v1/daily-hadiths/admin/{{a}} [fa admin]` | 200 | 200 | same |
| `scenario lifecycle #20 GET /api/v1/daily-hadiths/admin?limit=100 [- admin]` | 200 | 200 | same |
| `scenario lifecycle #21 PATCH /api/v1/daily-hadiths/{{b}} [- admin]` | 200 | 200 | same |
| `scenario lifecycle #22 DELETE /api/v1/daily-hadiths/{{a}} [- admin]` | 200 | 200 | same |
| `scenario lifecycle #23 DELETE /api/v1/daily-hadiths/{{a}} [- admin]` | 404 | 404 | same |
| `scenario lifecycle #24 POST /api/v1/daily-hadiths [- admin]` | 201 | 201 | same |
| `scenario lifecycle #25 GET /api/v1/daily-hadiths/trash?limit=100 [- admin]` | 200 | 200 | same |
| `scenario lifecycle #26 POST /api/v1/daily-hadiths/{{a}}/restore [- admin]` | 200 | 200 | same |
| `scenario lifecycle #27 POST /api/v1/daily-hadiths/{{a}}/restore [- admin]` | 404 | 404 | same |
| `scenario lifecycle #28 DELETE /api/v1/daily-hadiths/{{c}} [- admin]` | 200 | 200 | same |
| `scenario lifecycle #29 DELETE /api/v1/daily-hadiths/{{b}} [- admin]` | 200 | 200 | same |
| `scenario lifecycle #30 POST /api/v1/daily-hadiths/{{b}}/restore [- admin]` | 200 | 200 | same |
| `scenario lifecycle #31 POST /api/v1/daily-hadiths/{{c}}/restore [- admin]` | 200 | 200 | same |
| `scenario lifecycle #32 DELETE /api/v1/daily-hadiths/{{a}} [- admin]` | 200 | 200 | same |
| `scenario lifecycle #33 DELETE /api/v1/daily-hadiths/{{b}} [- admin]` | 200 | 200 | same |
| `scenario lifecycle #34 DELETE /api/v1/daily-hadiths/{{c}} [- admin]` | 200 | 200 | same |

## Diffs

| Key | A | B | Explained |
|---|---|---|---|
| `GET /api/v1/daily-hadiths/today [ar anon] $.data.id` | `"c961d562-c321-4ee9-aaf6-c219645a3dd6"` | `"9c0ac863-6213-4909-abc2-e5148ac84668"` | yes |
| `GET /api/v1/daily-hadiths/today [ar anon] $.data.content` | `"مَنْ قَطَرَتْ عَيْناهُ فِيناً قَطْرَةً، وَدَمَعَتْ عَيْناهُ فِيناً دَمْعَةً، بَوَّأَهُ اللَّهُ بِها فِي الجَنَّةِ غُ...` | `"الْعَصَبِيَّةُ الَّتِي يَأْثَمُ عَلَيْهَا صَاحِبُهَا: أَنْ يَرَى الرَّجُلُ شِرَارَ قَوْمِهِ خَيْرًا مِنْ خِيَارِ قَو...` | yes |
| `GET /api/v1/daily-hadiths/today [ar admin] $.data.id` | `"c961d562-c321-4ee9-aaf6-c219645a3dd6"` | `"9c0ac863-6213-4909-abc2-e5148ac84668"` | yes |
| `GET /api/v1/daily-hadiths/today [ar admin] $.data.content` | `"مَنْ قَطَرَتْ عَيْناهُ فِيناً قَطْرَةً، وَدَمَعَتْ عَيْناهُ فِيناً دَمْعَةً، بَوَّأَهُ اللَّهُ بِها فِي الجَنَّةِ غُ...` | `"الْعَصَبِيَّةُ الَّتِي يَأْثَمُ عَلَيْهَا صَاحِبُهَا: أَنْ يَرَى الرَّجُلُ شِرَارَ قَوْمِهِ خَيْرًا مِنْ خِيَارِ قَو...` | yes |
| `GET /api/v1/daily-hadiths/today [en anon] $.data.id` | `"c961d562-c321-4ee9-aaf6-c219645a3dd6"` | `"9c0ac863-6213-4909-abc2-e5148ac84668"` | yes |
| `GET /api/v1/daily-hadiths/today [en anon] $.data.content` | `"مَنْ قَطَرَتْ عَيْناهُ فِيناً قَطْرَةً، وَدَمَعَتْ عَيْناهُ فِيناً دَمْعَةً، بَوَّأَهُ اللَّهُ بِها فِي الجَنَّةِ غُ...` | `"الْعَصَبِيَّةُ الَّتِي يَأْثَمُ عَلَيْهَا صَاحِبُهَا: أَنْ يَرَى الرَّجُلُ شِرَارَ قَوْمِهِ خَيْرًا مِنْ خِيَارِ قَو...` | yes |
| `GET /api/v1/daily-hadiths/today [en admin] $.data.id` | `"c961d562-c321-4ee9-aaf6-c219645a3dd6"` | `"9c0ac863-6213-4909-abc2-e5148ac84668"` | yes |
| `GET /api/v1/daily-hadiths/today [en admin] $.data.content` | `"مَنْ قَطَرَتْ عَيْناهُ فِيناً قَطْرَةً، وَدَمَعَتْ عَيْناهُ فِيناً دَمْعَةً، بَوَّأَهُ اللَّهُ بِها فِي الجَنَّةِ غُ...` | `"الْعَصَبِيَّةُ الَّتِي يَأْثَمُ عَلَيْهَا صَاحِبُهَا: أَنْ يَرَى الرَّجُلُ شِرَارَ قَوْمِهِ خَيْرًا مِنْ خِيَارِ قَو...` | yes |
| `GET /api/v1/daily-hadiths/today [- anon] $.data.id` | `"c961d562-c321-4ee9-aaf6-c219645a3dd6"` | `"9c0ac863-6213-4909-abc2-e5148ac84668"` | yes |
| `GET /api/v1/daily-hadiths/today [- anon] $.data.content` | `"مَنْ قَطَرَتْ عَيْناهُ فِيناً قَطْرَةً، وَدَمَعَتْ عَيْناهُ فِيناً دَمْعَةً، بَوَّأَهُ اللَّهُ بِها فِي الجَنَّةِ غُ...` | `"الْعَصَبِيَّةُ الَّتِي يَأْثَمُ عَلَيْهَا صَاحِبُهَا: أَنْ يَرَى الرَّجُلُ شِرَارَ قَوْمِهِ خَيْرًا مِنْ خِيَارِ قَو...` | yes |
| `GET /api/v1/daily-hadiths/today [- admin] $.data.id` | `"c961d562-c321-4ee9-aaf6-c219645a3dd6"` | `"9c0ac863-6213-4909-abc2-e5148ac84668"` | yes |
| `GET /api/v1/daily-hadiths/today [- admin] $.data.content` | `"مَنْ قَطَرَتْ عَيْناهُ فِيناً قَطْرَةً، وَدَمَعَتْ عَيْناهُ فِيناً دَمْعَةً، بَوَّأَهُ اللَّهُ بِها فِي الجَنَّةِ غُ...` | `"الْعَصَبِيَّةُ الَّتِي يَأْثَمُ عَلَيْهَا صَاحِبُهَا: أَنْ يَرَى الرَّجُلُ شِرَارَ قَوْمِهِ خَيْرًا مِنْ خِيَارِ قَو...` | yes |

## Explanations

<!-- Everything above this heading is regenerated on every run; everything from it down is kept.
One bullet per explained diff: a backticked key, `*` matching anything, then why. Example:
- `GET /api/v1/posts* [*] $.data[*].views`: views are counted by the RL_VIEW binding now (D7).
-->

- `GET /api/v1/daily-hadiths/today [*] $.data.id`: no hadith is scheduled for the run's date in the dump, so `/today` draws at random from the unscheduled pool and locks it for the day, on each side independently. Both picks are valid members of the same pool; the scheduled, locked, empty-pool and release rules are covered by the contract tests, which pass on both targets.
- `GET /api/v1/daily-hadiths/today [*] $.data.content`: the content of the hadith above.
