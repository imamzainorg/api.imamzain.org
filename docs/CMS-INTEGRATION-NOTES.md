# CMS & Main-Site Integration Notes

What the CMS frontend (`cms.imamzain.org`) and the public main site need to
know about the recent API changes. Read alongside the live OpenAPI spec at
`/docs` (or `/openapi.json`).

---

## 1. Schema migration to apply first

Before running the API against production, apply:

```
prisma/migrations/20260510120000_cms_extensions/migration.sql
```

The migration adds three tables (none of the CMS code paths break before
applying — they just don't have anywhere to write):

| Table | Purpose |
| --- | --- |
| `newsletter_campaigns` | Editor-composed broadcasts to active subscribers |
| `newsletter_campaign_recipients` | Per-subscriber delivery tracking |
| `media_variants` | Pre-generated WebP sizes per uploaded image |

Apply with:

```bash
psql "$DIRECT_URL" -f prisma/migrations/20260510120000_cms_extensions/migration.sql
npm run prisma:pull
npm run prisma:generate
```

The generated client gains the new typed models on step 3. The migration is
idempotent — re-running is a no-op.

---

## 2. Media variants — public-site impact

### What changed

`POST /media/confirm` now triggers a synchronous sharp pipeline that:

- Reads the original out of R2.
- Generates WebP variants at standard widths: **320, 768, 1280, 1920 px**.
- Skips widths that would up-scale (a 480 px source returns at most one
  variant, the 320 px one).
- Uploads each to `media/variants/<media_id>/w<width>.webp`.
- Inserts `media_variants` rows for each successful one.

Generation happens during the upload request (typically 1–3 s for normal
CMS uploads using `Promise.all` parallelism). Failures are isolated — the
media row still succeeds and the editor can call
`POST /media/:id/regenerate-variants` later.

### New response shape

Every endpoint that returns a media object — `confirmUpload`, `findOne`,
`findAll`, `regenerateVariants` — now includes a `variants[]` array:

```jsonc
{
  "id": "9c8d…",
  "url": "https://cdn.imamzain.org/media/9c8d-photo.jpg",
  "filename": "photo.jpg",
  "alt_text": "صورة توضيحية",
  "mime_type": "image/jpeg",
  "file_size": 482103,
  "width": 2400,
  "height": 1800,
  "variants": [
    { "width": 320,  "url": "https://cdn.imamzain.org/media/variants/9c8d/w320.webp",  "file_size": 18432, "format": "webp" },
    { "width": 768,  "url": "https://cdn.imamzain.org/media/variants/9c8d/w768.webp",  "file_size": 64210, "format": "webp" },
    { "width": 1280, "url": "https://cdn.imamzain.org/media/variants/9c8d/w1280.webp", "file_size": 142933, "format": "webp" },
    { "width": 1920, "url": "https://cdn.imamzain.org/media/variants/9c8d/w1920.webp", "file_size": 268431, "format": "webp" }
  ]
}
```

### Public site — recommended usage

Use `<img srcset>` with the variants array. Fall back to the original `url`
when no variant of the right size exists:

```tsx
function ResponsiveImage({ media, sizes = "100vw", className }: Props) {
  const variants = media.variants ?? [];
  if (variants.length === 0) {
    return <img src={media.url} alt={media.alt_text ?? ""} className={className} loading="lazy" />;
  }
  const srcSet = variants.map(v => `${v.url} ${v.width}w`).join(", ");
  // Pick the largest variant <= the layout size as the fallback src.
  const largest = variants[variants.length - 1].url;
  return (
    <img
      src={largest}
      srcSet={srcSet}
      sizes={sizes}
      alt={media.alt_text ?? ""}
      className={className}
      loading="lazy"
      decoding="async"
    />
  );
}
```

### CMS — recommended usage

- After `POST /media/confirm`, the response already contains `variants`.
  No follow-up call needed.
- If `variants` is empty (sharp failed mid-upload — e.g. corrupt image,
  timeout), surface a "Regenerate variants" button on the media detail
  page that calls `POST /media/:id/regenerate-variants`.
- Don't show the per-variant sizes in the editor UI — they're an
  implementation detail. Only show the original.

### What you DON'T need to do

- No client-side resizing.
- No `?w=…` query parameters.
- No Cloudflare Image Resizing transforms.

---

## 3. HTML sanitisation on `posts.translations[].body`

### What changed

The API now sanitises the `body` field on `POST /posts` and
`PATCH /posts/:id` server-side before storing it. The allowlist mirrors the
Tiptap StarterKit schema (`p`, `h1-6`, `ul / ol / li`, `blockquote`,
`pre / code`, `strong / em / u / s / sub / sup / mark`, `a`, `img`,
`table` family, `span`, `div`).

URL schemes are restricted: `http`, `https`, `mailto`, `tel` for `href`;
`http`, `https`, `data` for `<img src>`. `style` attributes are stripped.
Inline event handlers (`onclick`, etc.) are stripped. `target="_blank"`
links automatically gain `rel="noopener noreferrer"`.

The body field also enforces a 200 KB UTF-8 byte cap (matches the CMS's
`MAX_BODY_BYTES`).

### CMS — what you should still do

Keep the existing client-side `sanitizeEditorHtml` and `byteLength` checks
in the editor. The server-side pass is **defence-in-depth** — it does not
replace the client-side editor schema, which still gives users feedback as
they type.

### Public site — what you should know

You can render `post.translation.body` via `dangerouslySetInnerHTML` (or
the framework equivalent) without further sanitisation. It's been through:

1. Tiptap's parser (CMS editor).
2. The CMS's URL/event-handler regex strip (`sanitizeEditorHtml`).
3. The API's `sanitize-html` allowlist (server-side).

If you want to keep your renderer paranoid (good practice), `sanitize-html`
or DOMPurify on the server-rendered output is fine. It just won't find
anything to remove on normal data.

### Stored data note

Posts created **before** this change were stored without server-side
sanitisation. The data is fine if the only content source has been the
CMS, but if you want to backfill: write a one-shot script that loads each
`post_translations.body`, runs it through `sanitizeEditorHtml`, and
updates if it differs. The CMS team can run this against staging first.

---

## 4. Newsletter campaigns (table only — endpoints not yet implemented)

### What's in the migration

Two tables — `newsletter_campaigns` and `newsletter_campaign_recipients` —
ready for a campaign-sending feature. **No API endpoints exist yet.**

### Suggested workflow when endpoints are added (Option B from the design discussion)

1. Editor publishes a post / book / contest.
2. CMS prompts: *"Send a newsletter about this? [Compose]"*.
3. CMS calls `POST /newsletter/campaigns` with a draft `subject` /
   `body_html` (pre-filled from a template) and an optional
   `source_resource_type` / `source_resource_id` linking back to the
   triggering content.
4. Editor reviews / edits / hits send.
5. CMS calls `POST /newsletter/campaigns/:id/send` (immediate) or
   `POST /newsletter/campaigns/:id/schedule` (with `scheduled_at`).
6. The API enqueues `newsletter_campaign_recipients` rows for every active
   subscriber and processes them in batches.

### Why per-recipient rows

`newsletter_campaign_recipients` lets the sender:

- Resume a partially-sent batch after a crash without double-sending.
- Track per-recipient `sent_at` / `failed_at` / `error_message`.
- Render an editor-facing "247/250 delivered, 3 bounced" report.

### SMTP capacity caveat

The current SMTP path (`info@imamzain.org` via Hostinger) has per-account
sending limits, typically ~100/hr or ~300/day. As long as the active
subscriber count stays in the low hundreds, batching with sleeps is
sufficient. If the list grows, migrate to Resend / Brevo / Mailgun keeping
`info@imamzain.org` as the From — none of the campaign code needs to
change beyond swapping the transport.

This caveat is recorded inline in the SQL migration's header comment for
future maintainers.

---

## 5. Recap of what changed in this round

| # | Area | Change | CMS impact | Main-site impact |
| --- | --- | --- | --- | --- |
| 9 | Newsletter campaigns | SQL only; tables added | None yet | None |
| 20 | Posts body | Server-side sanitisation + 200 KB byte cap | None — keeps client cleanup; just don't lift the cap | Free render of body without further sanitisation |
| 24 | Image variants | Sharp-generated WebP sizes on upload | Read `variants[]` from media responses; expose Regenerate button | Use `<img srcset>` from `variants[]` |

---

## 6. Open follow-ups (not in this round)

- Newsletter **campaign send** endpoints — only the schema is in.
- Variant URL exposure on **already-uploaded** media (run `regenerate-variants` on each).
- `meta_title` / `meta_description` / `og_image_id` fields on posts (Tier 1, separate task).
- Site settings table (Tier 1, separate task).
- Trash + restore endpoints (Tier 1, separate task).
- Tags many-to-many (deferred — structural decision).
