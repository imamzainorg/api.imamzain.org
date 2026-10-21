# ImamZain API

The official REST API behind [imamzain.org](https://imamzain.org) — the public
digital platform of the **Imam Zayn al-Abidin (as) Foundation**. It serves the
foundation's Islamic content, digital library, media gallery, audio library, and
public forms to the website, and powers the admin CMS that manages them.

## What it does

- **Multilingual content delivery** — posts, pages, books, academic papers,
  gallery items and settings are served in the visitor's language (via
  `Accept-Language`), with automatic fallback to the default translation.
- **Digital library & publications** — books and research papers with
  per-translation metadata, slugs, and downloadable files.
- **Media & audio** — image gallery with responsive WebP variants and an audio
  recitations library.
- **Public forms** — contact, proxy-visitation (نيابة الزيارة) requests, and a
  double opt-in newsletter.
- **Editorial workflow** — role-based admin access, scheduled publishing,
  per-translation SEO fields, trash & restore, bulk operations, and a full audit
  log of every write.
- **Discovery** — cross-resource search over posts, books, papers and gallery
  captions, plus a public sitemap and RSS feed.

## Scope & architecture

- Runs as a [Hono](https://hono.dev) application on **Cloudflare Workers**.
- **PostgreSQL** (Supabase) accessed through Cloudflare Hyperdrive, with
  **Prisma** as the ORM.
- **JWT** authentication with bcrypt hashing, refresh-token rotation, and
  fine-grained RBAC.
- **Cloudflare R2** for file storage, **Cloudflare Images** for responsive
  variants, **Cloudflare Email** for transactional mail, and **Cron Triggers**
  for background jobs (scheduled publishing, newsletter/notification digests).
- Request and response shapes are defined once as Zod schemas and exposed as an
  OpenAPI specification.

This service replaced the foundation's earlier NestJS/Express API in October 2026
(see [`api.imamzain.org-DEPRECATED`](https://github.com/imamzainorg/api.imamzain.org-DEPRECATED)).
