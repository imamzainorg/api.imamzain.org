# Permissions, Roles, and Audit Actions

The reference catalogue for the API's RBAC system and audit log
vocabulary. The OpenAPI spec at `/docs` tells you **which** permission
each endpoint requires; this document tells you what permissions
**exist**, who has them by default, and what audit `action` strings
the API emits.

- [Permissions catalogue](#permissions-catalogue)
- [Default roles](#default-roles)
- [Permission → role matrix](#permission--role-matrix)
- [Privilege envelope and the last-administrator guard](#privilege-envelope-and-the-last-administrator-guard)
- [Forced password change (`must_change_password`)](#forced-password-change-must_change_password)
- [Audit action vocabulary](#audit-action-vocabulary)

---

## Permissions catalogue

68 permissions in total, grouped by resource. The seed
(`prisma/seed.ts`) is the authoritative source.

### Content

| Permission | Action |
| --- | --- |
| `posts:read` | List / read drafts and unpublished posts (admin) |
| `posts:create` | Create new posts |
| `posts:update` | Edit, publish / unpublish, bulk-publish posts |
| `posts:delete` | Soft-delete, restore, bulk-delete posts |
| `post-categories:create` | Create post categories |
| `post-categories:update` | Edit post categories |
| `post-categories:delete` | Soft-delete + restore + list trash for post categories |
| `books:read` | List / read drafts and unpublished books (admin) |
| `books:create` | Add new books |
| `books:update` | Edit book records |
| `books:delete` | Soft-delete + restore + list trash for books |
| `book-categories:create` | Create book categories |
| `book-categories:update` | Edit book categories |
| `book-categories:delete` | Soft-delete + restore + list trash for book categories |
| `academic-papers:read` | List / read drafts and unpublished academic papers (admin) |
| `academic-papers:create` | Add academic papers |
| `academic-papers:update` | Edit academic papers |
| `academic-papers:delete` | Soft-delete + restore + list trash for academic papers |
| `academic-paper-categories:create` | Create academic paper categories |
| `academic-paper-categories:update` | Edit academic paper categories |
| `academic-paper-categories:delete` | Soft-delete + restore + list trash for academic paper categories |
| `gallery:read` | List / read drafts and unpublished gallery images (admin) |
| `gallery:create` | Add gallery images |
| `gallery:update` | Edit gallery image metadata |
| `gallery:delete` | Soft-delete + restore + list trash for gallery images |
| `gallery-categories:create` | Create gallery categories |
| `gallery-categories:update` | Edit gallery categories |
| `gallery-categories:delete` | Soft-delete + restore + list trash for gallery categories |
| `static-pages:read` | List static pages incl. drafts (admin) + open a draft by id |
| `static-pages:create` | Create static pages |
| `static-pages:update` | Edit + publish / unpublish static pages |
| `static-pages:delete` | Soft-delete + restore + list trash for static pages |
| `audios:read` | List audios incl. drafts (admin) + open a draft by id |
| `audios:create` | Create audios + speakers + request a pre-signed R2 upload URL |
| `audios:update` | Edit + publish / unpublish audios; edit speakers |
| `audios:delete` | Soft-delete + restore + list trash for audios **and speakers** |

> **Speakers** are part of the audio domain and reuse the `audios:*`
> permissions — there is no separate `speakers:*` set. Public speaker reads
> (`GET /speakers`, `GET /speakers/:id`) need no auth.

### Stores

A `store` is a city (translated `city_name`); each city has one or more
`store_locations` (sale-points). All store + location management is gated by a
single permission set.

Public list / detail need no permission. There is no `stores:read` — matching
the category resources, the only admin-read surface (trash) is gated by
`stores:delete`.

| Permission | Action |
| --- | --- |
| `stores:create` | Create a store (with optional nested locations) |
| `stores:update` | Edit a store + add / edit its sale-points |
| `stores:delete` | Soft-delete + restore stores and sale-points + list trash |

### Media

| Permission | Action |
| --- | --- |
| `media:read` | List + read media records, including `GET /media/:id/references` (what posts/books/static-pages/gallery items hold a reference to this file) |
| `media:create` | Request upload URL + confirm upload |
| `media:update` | Edit metadata + regenerate variants |
| `media:delete` | Hard-delete media (removes R2 file too) |

### Forms

| Permission | Action |
| --- | --- |
| `forms:read` | List contact + proxy visit submissions |
| `forms:update` | Update status on submissions (also triggers WhatsApp on proxy visit COMPLETED) |
| `forms:delete` | Soft-delete submissions |

### Newsletter

| Permission | Action |
| --- | --- |
| `newsletter:read` | List subscribers + campaigns |
| `newsletter:update` | Admin un/resubscribe + create/edit/send/cancel campaigns |
| `newsletter:delete` | Soft-delete subscribers + hard-delete draft/cancelled campaigns |

### Daily hadiths

| Permission | Action |
| --- | --- |
| `daily-hadiths:read` | List + read hadiths |
| `daily-hadiths:create` | Add a new hadith |
| `daily-hadiths:update` | Edit a hadith, including scheduling/unscheduling its display date |
| `daily-hadiths:delete` | Soft-delete a hadith |

### Dashboard, audit, contest, settings

| Permission | Action |
| --- | --- |
| `dashboard:read` | `GET /dashboard/stats` |
| `audit-logs:read` | List + read audit log entries |
| `contest:read` | List contest attempts |
| `settings:read` | List admin settings + read by key |
| `settings:update` | PUT a setting (upsert) |
| `settings:delete` | DELETE a setting |

### System (super-admin / IT only)

| Permission | Action |
| --- | --- |
| `languages:read` | List all languages including inactive |
| `languages:create` | Add new languages |
| `languages:update` | Edit language metadata |
| `languages:delete` | Soft-delete languages |
| `users:read` | List + read admin user accounts |
| `users:create` | Create admin users |
| `users:update` | Edit users + admin password reset + role assignments |
| `users:delete` | Soft-delete users |
| `roles:read` | List roles + permissions |
| `roles:create` | Create new roles |
| `roles:update` | Edit role names + assign/remove permissions |
| `roles:delete` | Delete roles (only if unassigned from users) |

---

## Default roles

The seed creates four default roles. Re-running the seed is safe and
**create-only for role grants**: a role that does not exist yet gets its
permissions, and a permission that does not exist yet is granted to the
roles that list it — but a grant an admin removed is **never re-added**.
The seed used to re-grant everything it lists on every run, silently
undoing removals made through `DELETE /roles/:id/permissions/:permissionId`
(and the last-administrator guard is no help against that). Grants the seed
does make on an existing role are audit-logged
(`PERMISSION_ASSIGNED_TO_ROLE`, `changes.by = "seed"`), and it logs any
grant it deliberately left removed. To force the old behaviour once, run
the seed with `SEED_RESET_ROLE_GRANTS=true`.

| Role | Description | Permission count |
| --- | --- | --- |
| `super-admin` | Full system access including roles, users, and languages. Reserved for the technical owner. | 68 (all) |
| `admin` | All content + users + forms + newsletter + media. Cannot modify roles or languages. | 62 |
| `editor` | All content types (incl. static pages, stores, audios), media, and daily hadiths. No access to forms, users, roles, or system settings. | 45 |
| `moderator` | Reviews and responds to contact submissions, proxy visit requests, and the newsletter. Read-only on posts and contest. | 9 |

Translations for each role title / description exist in `ar`, `en`,
`fa` and are returned by `GET /roles`.

### Editing the default mapping

The seed mapping is just a starting state — it never overrides what
admins do afterwards; the CMS can move
permissions between roles at runtime through `POST/DELETE
/roles/:id/permissions` (requires `roles:update`). Custom roles can be
created via `POST /roles`.

---

## Permission → role matrix

A quick lookup table for "which roles can do X by default". Use this
to plan the CMS UI — show / hide buttons based on whether the
logged-in user's role would have a permission. (At runtime, always
check the JWT's `permissions[]` array, not the role name.)

Legend: ✓ = has by default, — = does not.

| Permission | super-admin | admin | editor | moderator |
| --- | :-: | :-: | :-: | :-: |
| `posts:read` | ✓ | ✓ | ✓ | ✓ |
| `posts:create` | ✓ | ✓ | ✓ | — |
| `posts:update` | ✓ | ✓ | ✓ | — |
| `posts:delete` | ✓ | ✓ | ✓ | — |
| `post-categories:*` | ✓ | ✓ | ✓ | — |
| `books:*` | ✓ | ✓ | ✓ | — |
| `book-categories:*` | ✓ | ✓ | ✓ | — |
| `academic-papers:*` | ✓ | ✓ | ✓ | — |
| `academic-paper-categories:*` | ✓ | ✓ | ✓ | — |
| `gallery:*` | ✓ | ✓ | ✓ | — |
| `gallery-categories:*` | ✓ | ✓ | ✓ | — |
| `static-pages:*` | ✓ | ✓ | ✓ | — |
| `stores:*` (create/update/delete) | ✓ | ✓ | ✓ | — |
| `audios:*` | ✓ | ✓ | ✓ | — |
| `media:*` | ✓ | ✓ | ✓ | — |
| `daily-hadiths:*` | ✓ | ✓ | ✓ | — |
| `forms:read` | ✓ | ✓ | — | ✓ |
| `forms:update` | ✓ | ✓ | — | ✓ |
| `forms:delete` | ✓ | ✓ | — | ✓ |
| `newsletter:read` | ✓ | ✓ | — | ✓ |
| `newsletter:update` | ✓ | ✓ | — | ✓ |
| `newsletter:delete` | ✓ | ✓ | — | ✓ |
| `dashboard:read` | ✓ | ✓ | ✓ | ✓ |
| `audit-logs:read` | ✓ | ✓ | — | — |
| `contest:read` | ✓ | ✓ | — | ✓ |
| `settings:read` | ✓ | ✓ | — | — |
| `settings:update` | ✓ | ✓ | — | — |
| `settings:delete` | ✓ | ✓ | — | — |
| `users:*` | ✓ | ✓ | — | — |
| `roles:read` | ✓ | ✓ | — | — |
| `roles:create` | ✓ | — | — | — |
| `roles:update` | ✓ | — | — | — |
| `roles:delete` | ✓ | — | — | — |
| `languages:read` | ✓ | ✓ | — | — |
| `languages:create` | ✓ | — | — | — |
| `languages:update` | ✓ | — | — | — |
| `languages:delete` | ✓ | — | — | — |

---

## Privilege envelope and the last-administrator guard

Holding `users:update` / `users:delete` / `roles:update` is not enough on
its own to act on *any* account or role. Two invariants are enforced by
the API on top of the permission check:

**Privilege envelope (403).** An actor may only manage a subject whose
permissions are all within the actor's own. Concretely:

| Route | Refused with 403 when… |
| --- | --- |
| `PATCH /users/:id`, `DELETE /users/:id`, `POST /users/:id/reset-password` | the target user holds any permission the caller does not |
| `POST /users/:id/roles`, `DELETE /users/:id/roles/:roleId` | the role grants any permission the caller does not hold |
| `POST /roles/:id/permissions`, `DELETE /roles/:id/permissions/:permissionId` | the caller does not hold the permission being granted / revoked |
| `DELETE /users/:id` | the target is the caller's own account |

Equal sets pass — two `admin` accounts can manage each other — only a
strict superset is refused. A super-admin holds everything, so nothing
changes for them. In the default seed this means an `admin` (62
permissions) can no longer reset a `super-admin`'s password, rename or
delete that account.

**Last administrator (409).** At least one active user must always hold
*every* permission in the system, otherwise nobody could ever grant a
permission again (the envelope rule means you can only grant what you
hold). `DELETE /users/:id`, `DELETE /users/:id/roles/:roleId` and
`DELETE /roles/:id/permissions/:permissionId` return
`409 This change would leave no active user holding every permission…`
when the change would remove the last such account. The check is
evaluated in the same transaction as the write.

---

## Forced password change (`must_change_password`)

`POST /users/:id/reset-password` (permission `users:update`) now flags the
target account `must_change_password: true`. The flag is cleared only when
the user changes their own password via `PATCH /auth/me/password`, and that
change is rejected (`400 PASSWORD_MUST_DIFFER`) while flagged if
`newPassword` equals `currentPassword` — otherwise the flag could be cleared
without actually replacing the admin-chosen password. The flag is returned
on `POST /auth/login` (`data.user.must_change_password`) and `GET /auth/me`
(`data.must_change_password`).

**Enforcement is gated by an environment variable, off by default.** With
`ENFORCE_PASSWORD_CHANGE_AFTER_RESET` unset (or anything other than the
literal `true`), the flag is informational only — nothing is blocked. Once
set to `true`, a flagged account gets `403 PASSWORD_CHANGE_REQUIRED` on
every authenticated route **except** `GET /auth/me`, `PATCH /auth/me/password`,
`POST /auth/logout` and `POST /auth/refresh` (which is unauthenticated
anyway). This is a request-path gate, not a new permission — it applies
regardless of which permissions the flagged account holds. Turn it on only
after the CMS ships a change-password redirect on `PASSWORD_CHANGE_REQUIRED`.

---

## Audit action vocabulary

Every write operation records an `audit_logs` row with an
`action` string. The CMS reads these via `GET /audit-logs` (filterable
by `action`, `resource_type`, `resource_id`, `user_id`, date range) to
power activity feeds.

Action strings are stable — these are part of the API contract. New
actions may be added, but the meaning of an existing string won't
change.

### Auth

| Action | Trigger | Notes |
| --- | --- | --- |
| `USER_LOGIN` | `POST /auth/login` succeeds | Includes `ip_address` + `user_agent` |
| `USER_LOGIN_FAILED` | `POST /auth/login` fails | `user_id` is null (`resource_id` is the account when the username exists). `changes.reason` is `bad_password`, `unknown_username` or `locked`, with `failed_count` and `locked_until`. The attempted username is deliberately never stored — it is often a mistyped password |
| `PASSWORD_CHANGED` | `PATCH /auth/me/password` | Self-service; clears `must_change_password` |
| `USER_PASSWORD_RESET_BY_ADMIN` | `POST /users/:id/reset-password` | Admin-driven; the admin's id is in `user_id`; sets `must_change_password: true` on the target |
| `USER_LOGOUT` | `POST /auth/logout` with a `refresh_token` | `changes.revoked_tokens` — ends that token's whole session (family), not just the one row |
| `USER_LOGOUT_ALL` | `POST /auth/logout` with no body | `changes.revoked_tokens` — ends every session of the caller |
| `REFRESH_TOKEN_REUSE_DETECTED` | `POST /auth/refresh` presented with an already-rotated token, outside the reuse-grace window | `changes.family_id`, `changes.revoked_tokens`, `changes.rotated_seconds_ago`; `revoked_tokens: 0` means the session was already over (a stale device), not necessarily an attack |

### Users + roles

| Action | Trigger |
| --- | --- |
| `USER_CREATED` | `POST /users` |
| `USER_UPDATED` | `PATCH /users/:id` — a username rename adds `changes.username = { before, after }` |
| `USER_DELETED` | `DELETE /users/:id` |
| `USER_RESTORED` | `POST /users/:id/restore` |
| `ROLE_ASSIGNED_TO_USER` | `POST /users/:id/roles` |
| `ROLE_REMOVED_FROM_USER` | `DELETE /users/:id/roles/:roleId` |
| `ROLE_CREATED` | `POST /roles` |
| `ROLE_UPDATED` | `PATCH /roles/:id` — a name rename adds `changes.name = { before, after }` |
| `ROLE_DELETED` | `DELETE /roles/:id` |
| `PERMISSION_ASSIGNED_TO_ROLE` | `POST /roles/:id/permissions` |
| `PERMISSION_REMOVED_FROM_ROLE` | `DELETE /roles/:id/permissions/:permissionId` |

### Content

| Action | Trigger |
| --- | --- |
| `POST_CREATED` | `POST /posts` |
| `POST_UPDATED` | `PATCH /posts/:id` |
| `POST_PUBLISHED` | `PATCH /posts/:id/publish { is_published: true }` or scheduled cron auto-publish (`changes.scheduled === true`) |
| `POST_UNPUBLISHED` | `PATCH /posts/:id/publish { is_published: false }` |
| `POST_DELETED` | `DELETE /posts/:id` or `POST /posts/bulk/delete` (`changes.bulk === true` for bulk) |
| `POST_RESTORED` | `POST /posts/:id/restore` |
| `BOOK_CREATED` / `BOOK_UPDATED` / `BOOK_DELETED` / `BOOK_RESTORED` | Books CRUD |
| `BOOK_PUBLISHED` / `BOOK_UNPUBLISHED` | `PATCH /books/:id/publish` |
| `ACADEMIC_PAPER_CREATED` / `ACADEMIC_PAPER_UPDATED` / `ACADEMIC_PAPER_DELETED` / `ACADEMIC_PAPER_RESTORED` | Academic papers CRUD |
| `ACADEMIC_PAPER_PUBLISHED` / `ACADEMIC_PAPER_UNPUBLISHED` | `PATCH /academic-papers/:id/publish` |
| `GALLERY_IMAGE_CREATED` / `GALLERY_IMAGE_UPDATED` / `GALLERY_IMAGE_DELETED` / `GALLERY_IMAGE_RESTORED` | Gallery images CRUD |
| `GALLERY_IMAGE_PUBLISHED` / `GALLERY_IMAGE_UNPUBLISHED` | `PATCH /gallery/:id/publish` |
| `STATIC_PAGE_CREATED` / `STATIC_PAGE_UPDATED` / `STATIC_PAGE_DELETED` / `STATIC_PAGE_RESTORED` | Static pages CRUD |
| `STATIC_PAGE_PUBLISHED` / `STATIC_PAGE_UNPUBLISHED` | `PATCH /static-pages/:id/publish` |
| `AUDIO_CREATED` / `AUDIO_UPDATED` / `AUDIO_DELETED` / `AUDIO_RESTORED` | Audios CRUD |
| `AUDIO_PUBLISHED` / `AUDIO_UNPUBLISHED` | `PATCH /audios/:id/publish` |
| `SPEAKER_CREATED` / `SPEAKER_UPDATED` / `SPEAKER_DELETED` / `SPEAKER_RESTORED` | Speakers CRUD |

### Stores

| Action | Trigger |
| --- | --- |
| `STORE_CREATED` / `STORE_UPDATED` / `STORE_DELETED` / `STORE_RESTORED` | Store (city) CRUD |
| `STORE_LOCATION_CREATED` / `STORE_LOCATION_UPDATED` / `STORE_LOCATION_DELETED` | Sale-point CRUD via `/stores/:id/locations*` |

### Categories

Four category resources emit parallel sets:

- `POST_CATEGORY_CREATED` / `POST_CATEGORY_UPDATED` / `POST_CATEGORY_RESTORED` / `POST_CATEGORY_DELETED`
- `BOOK_CATEGORY_CREATED` / `BOOK_CATEGORY_UPDATED` / `BOOK_CATEGORY_RESTORED` / `BOOK_CATEGORY_DELETED`
- `ACADEMIC_PAPER_CATEGORY_CREATED` / `…_UPDATED` / `…_RESTORED` / `…_DELETED`
- `GALLERY_CATEGORY_CREATED` / `…_UPDATED` / `…_RESTORED` / `…_DELETED`

### Media

| Action | Trigger |
| --- | --- |
| `MEDIA_CREATED` | `POST /media/confirm` |
| `MEDIA_UPDATED` | `PATCH /media/:id` |
| `MEDIA_VARIANTS_REGENERATED` | `POST /media/:id/regenerate-variants` — `changes` now also records `variants_status` |
| `MEDIA_DELETED` | `DELETE /media/:id` |

### Hadiths

| Action | Trigger |
| --- | --- |
| `DAILY_HADITH_CREATED` | `POST /daily-hadiths` |
| `DAILY_HADITH_UPDATED` | `PATCH /daily-hadiths/:id` |
| `DAILY_HADITH_DELETED` | `DELETE /daily-hadiths/:id` |
| `DAILY_HADITH_RESTORED` | `POST /daily-hadiths/:id/restore` |

The YouTube sync (`youtube-sync.service.ts`) does **not** emit audit
log rows. It's a system action driven by cron, not a user action;
sync success and failure show up in application logs only. If you
need to investigate why a video is or isn't present, check the
`youtube_videos.last_synced_at` column.

### Newsletter

| Action | Trigger |
| --- | --- |
| `NEWSLETTER_SUBSCRIBE_REQUESTED` | `POST /newsletter/subscribe` for an address not seen before (a pending row is created and a confirmation e-mail queued) — `user_id` is null (public action) |
| `NEWSLETTER_SUBSCRIBED` | `POST /newsletter/confirm` — the first confirmation of an address — public action |
| `NEWSLETTER_RESUBSCRIBED` | `POST /newsletter/confirm` — an address that had been confirmed before (unsubscribed or deleted, now back) — public action |
| `NEWSLETTER_UNSUBSCRIBED` | `POST /newsletter/unsubscribe` — public action |
| `NEWSLETTER_UNSUBSCRIBED_BY_ADMIN` | `POST /newsletter/subscribers/:id/unsubscribe` |
| `NEWSLETTER_RESUBSCRIBED_BY_ADMIN` | `POST /newsletter/subscribers/:id/resubscribe` |
| `NEWSLETTER_SUBSCRIBER_DELETED` | `DELETE /newsletter/subscribers/:id` |
| `NEWSLETTER_SUBSCRIBER_RESTORED` | `POST /newsletter/subscribers/:id/restore` — `changes.is_active` says whether the subscriber is active again (an explicit opt-out survives a restore) |
| `NEWSLETTER_CAMPAIGN_CREATED` | `POST /newsletter/campaigns` |
| `NEWSLETTER_CAMPAIGN_UPDATED` | `PATCH /newsletter/campaigns/:id` |
| `NEWSLETTER_CAMPAIGN_SEND_QUEUED` | `POST /newsletter/campaigns/:id/send` |
| `NEWSLETTER_CAMPAIGN_CANCELLED` | `POST /newsletter/campaigns/:id/cancel` |
| `NEWSLETTER_CAMPAIGN_RETRIED` | `POST /newsletter/campaigns/:id/retry` — `changes.requeued` is how many recipients went back in the queue |
| `NEWSLETTER_CAMPAIGN_COMPLETED` | Written by the sender (`user_id` null) when a campaign finishes as `sent` or `failed`; `changes` carry the final counts |
| `NEWSLETTER_CAMPAIGN_DELETED` | `DELETE /newsletter/campaigns/:id` |

### Forms

| Action | Trigger |
| --- | --- |
| `CONTACT_SUBMITTED` | `POST /forms/contact` — public action, `user_id` null |
| `CONTACT_UPDATED` | `PATCH /forms/contacts/:id` |
| `CONTACT_DELETED` | `DELETE /forms/contacts/:id` |
| `CONTACT_RESTORED` | `POST /forms/contacts/:id/restore` |
| `PROXY_VISIT_SUBMITTED` | `POST /forms/proxy-visit` — public action, `user_id` null |
| `PROXY_VISIT_UPDATED` | `PATCH /forms/proxy-visits/:id` |
| `PROXY_VISIT_DELETED` | `DELETE /forms/proxy-visits/:id` |
| `PROXY_VISIT_RESTORED` | `POST /forms/proxy-visits/:id/restore` |

### System

| Action | Trigger |
| --- | --- |
| `LANGUAGE_CREATED` / `LANGUAGE_UPDATED` / `LANGUAGE_DELETED` | Languages CRUD |
| `SETTING_CREATED` / `SETTING_UPDATED` | `PUT /settings/:key` (first write vs. subsequent) |
| `SETTING_DELETED` | `DELETE /settings/:key` |

### Reading the `changes` field

Every audit row carries a `changes` JSON column with at least:

```jsonc
{ "method": "POST", "path": "/api/v1/posts" }
```

Some actions carry additional context:

- Scheduled publish: `{ scheduled: true, by: "cron" }`
- Bulk operations: `{ bulk: true, ... }`
- Publish toggle: `{ ..., is_published: true | false }`
- Campaign send: `{ ..., recipient_count: 247 }`
- Setting upsert: `{ ..., key, type }`

When the front-end renders an activity feed, parse `changes` for these
markers to distinguish e.g. "auto-published by cron" from "published
by editor", or "bulk deleted" from "deleted one-off".
