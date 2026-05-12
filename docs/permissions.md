# Permissions, Roles, and Audit Actions

The reference catalogue for the API's RBAC system and audit log
vocabulary. The OpenAPI spec at `/docs` tells you **which** permission
each endpoint requires; this document tells you what permissions
**exist**, who has them by default, and what audit `action` strings
the API emits.

- [Permissions catalogue](#permissions-catalogue)
- [Default roles](#default-roles)
- [Permission → role matrix](#permission--role-matrix)
- [Audit action vocabulary](#audit-action-vocabulary)

---

## Permissions catalogue

53 permissions in total, grouped by resource. The seed
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
| `books:create` | Add new books |
| `books:update` | Edit book records |
| `books:delete` | Soft-delete + restore + list trash for books |
| `book-categories:create` | Create book categories |
| `book-categories:update` | Edit book categories |
| `book-categories:delete` | Soft-delete + restore + list trash for book categories |
| `academic-papers:create` | Add academic papers |
| `academic-papers:update` | Edit academic papers |
| `academic-papers:delete` | Soft-delete + restore + list trash for academic papers |
| `academic-paper-categories:create` | Create academic paper categories |
| `academic-paper-categories:update` | Edit academic paper categories |
| `academic-paper-categories:delete` | Soft-delete + restore + list trash for academic paper categories |
| `gallery:create` | Add gallery images |
| `gallery:update` | Edit gallery image metadata |
| `gallery:delete` | Soft-delete + restore + list trash for gallery images |
| `gallery-categories:create` | Create gallery categories |
| `gallery-categories:update` | Edit gallery categories |
| `gallery-categories:delete` | Soft-delete + restore + list trash for gallery categories |

### Media

| Permission | Action |
| --- | --- |
| `media:read` | List + read media records |
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

The seed creates four default roles. Re-running the seed is safe —
upserts only.

| Role | Description | Permission count |
| --- | --- | --- |
| `super-admin` | Full system access including roles, users, and languages. Reserved for the technical owner. | 53 (all) |
| `admin` | All content + users + forms + newsletter + media. Cannot modify roles or languages. | 47 |
| `editor` | All content types and media. No access to forms, users, roles, or system settings. | 29 |
| `moderator` | Reviews and responds to contact submissions, proxy visit requests, and the newsletter. Read-only on posts and contest. | 9 |

Translations for each role title / description exist in `ar`, `en`,
`fa` and are returned by `GET /roles`.

### Editing the default mapping

The seed mapping is just a starting state; the CMS can move
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
| `media:*` | ✓ | ✓ | ✓ | — |
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
| `PASSWORD_CHANGED` | `PATCH /auth/me/password` | Self-service |
| `USER_PASSWORD_RESET_BY_ADMIN` | `POST /users/:id/reset-password` | Admin-driven; the admin's id is in `user_id` |

### Users + roles

| Action | Trigger |
| --- | --- |
| `USER_CREATED` | `POST /users` |
| `USER_UPDATED` | `PATCH /users/:id` |
| `USER_DELETED` | `DELETE /users/:id` |
| `ROLE_ASSIGNED_TO_USER` | `POST /users/:id/roles` |
| `ROLE_REMOVED_FROM_USER` | `DELETE /users/:id/roles/:roleId` |
| `ROLE_CREATED` | `POST /roles` |
| `ROLE_UPDATED` | `PATCH /roles/:id` |
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
| `ACADEMIC_PAPER_CREATED` / `ACADEMIC_PAPER_UPDATED` / `ACADEMIC_PAPER_DELETED` / `ACADEMIC_PAPER_RESTORED` | Academic papers CRUD |
| `GALLERY_IMAGE_CREATED` / `GALLERY_IMAGE_UPDATED` / `GALLERY_IMAGE_DELETED` / `GALLERY_IMAGE_RESTORED` | Gallery images CRUD |

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
| `MEDIA_VARIANTS_REGENERATED` | `POST /media/:id/regenerate-variants` |
| `MEDIA_DELETED` | `DELETE /media/:id` |

### Newsletter

| Action | Trigger |
| --- | --- |
| `NEWSLETTER_SUBSCRIBED` | `POST /newsletter/subscribe` (new email) — `user_id` is null (public action) |
| `NEWSLETTER_RESUBSCRIBED` | `POST /newsletter/subscribe` reactivating a previously-deleted record — public action |
| `NEWSLETTER_UNSUBSCRIBED` | `POST /newsletter/unsubscribe` — public action |
| `NEWSLETTER_UNSUBSCRIBED_BY_ADMIN` | `POST /newsletter/subscribers/:id/unsubscribe` |
| `NEWSLETTER_RESUBSCRIBED_BY_ADMIN` | `POST /newsletter/subscribers/:id/resubscribe` |
| `NEWSLETTER_SUBSCRIBER_DELETED` | `DELETE /newsletter/subscribers/:id` |
| `NEWSLETTER_CAMPAIGN_CREATED` | `POST /newsletter/campaigns` |
| `NEWSLETTER_CAMPAIGN_UPDATED` | `PATCH /newsletter/campaigns/:id` |
| `NEWSLETTER_CAMPAIGN_SEND_QUEUED` | `POST /newsletter/campaigns/:id/send` |
| `NEWSLETTER_CAMPAIGN_CANCELLED` | `POST /newsletter/campaigns/:id/cancel` |
| `NEWSLETTER_CAMPAIGN_DELETED` | `DELETE /newsletter/campaigns/:id` |

### Forms

| Action | Trigger |
| --- | --- |
| `CONTACT_SUBMITTED` | `POST /forms/contact` — public action, `user_id` null |
| `CONTACT_UPDATED` | `PATCH /forms/contacts/:id` |
| `CONTACT_DELETED` | `DELETE /forms/contacts/:id` |
| `PROXY_VISIT_SUBMITTED` | `POST /forms/proxy-visit` — public action, `user_id` null |
| `PROXY_VISIT_UPDATED` | `PATCH /forms/proxy-visits/:id` |
| `PROXY_VISIT_DELETED` | `DELETE /forms/proxy-visits/:id` |

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
