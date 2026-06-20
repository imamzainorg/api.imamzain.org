-- ===========================================================================
-- 20260528150000_static_pages_and_stores
--
-- Two new content areas that replace JSON files previously shipped with the
-- public site.
--
-- 1. Static pages
--    Permanent, rarely-changing canonical content like the biography
--    sections currently in imamzain.json. One row per page, one translation
--    row per language. Slug lives on the translation so a single page can
--    have language-specific URLs (matches the post_translations pattern).
--    Frontend serves these via SSG/ISR for static-asset-grade performance.
--
-- 2. Stores
--    Physical sale / contact locations grouped by city. Each `stores` row
--    is a city; `store_translations` carries the localized city name.
--    Each city has one or more `store_locations` (sell-points) with
--    non-translatable contact info (phone, GPS) plus translatable name +
--    address rows in `store_location_translations`.
--
-- Both areas are additive — no existing tables touched.
-- Re-running is safe; every CREATE uses IF NOT EXISTS.
-- ===========================================================================

-- ── Static pages ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS static_pages (
  id            uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  display_order integer        NOT NULL DEFAULT 0,
  is_published  boolean        NOT NULL DEFAULT true,
  created_at    timestamptz(6) NOT NULL DEFAULT now(),
  updated_at    timestamptz(6) NOT NULL DEFAULT now(),
  deleted_at    timestamptz(6)
);

CREATE INDEX IF NOT EXISTS idx_static_pages_published
  ON static_pages (display_order, id)
  WHERE deleted_at IS NULL AND is_published = true;

CREATE TABLE IF NOT EXISTS static_page_translations (
  page_id    uuid     NOT NULL REFERENCES static_pages(id) ON DELETE CASCADE,
  lang       char(2)  NOT NULL REFERENCES languages(code) ON DELETE CASCADE,
  title      text     NOT NULL,
  slug       text     NOT NULL,
  body       text     NOT NULL,
  is_default boolean  NOT NULL DEFAULT false,
  PRIMARY KEY (page_id, lang),
  UNIQUE (lang, slug)
);

-- ── Stores ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS stores (
  id            uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  display_order integer        NOT NULL DEFAULT 0,
  created_at    timestamptz(6) NOT NULL DEFAULT now(),
  updated_at    timestamptz(6) NOT NULL DEFAULT now(),
  deleted_at    timestamptz(6)
);

CREATE TABLE IF NOT EXISTS store_translations (
  store_id  uuid     NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  lang      char(2)  NOT NULL REFERENCES languages(code) ON DELETE CASCADE,
  city_name text     NOT NULL,
  PRIMARY KEY (store_id, lang)
);

CREATE TABLE IF NOT EXISTS store_locations (
  id            uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id      uuid           NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  phone         text,
  gps_embed_url text,
  gps_link      text,
  display_order integer        NOT NULL DEFAULT 0,
  created_at    timestamptz(6) NOT NULL DEFAULT now(),
  updated_at    timestamptz(6) NOT NULL DEFAULT now(),
  deleted_at    timestamptz(6)
);

CREATE INDEX IF NOT EXISTS idx_store_locations_store
  ON store_locations (store_id);

CREATE TABLE IF NOT EXISTS store_location_translations (
  location_id uuid     NOT NULL REFERENCES store_locations(id) ON DELETE CASCADE,
  lang        char(2)  NOT NULL REFERENCES languages(code) ON DELETE CASCADE,
  name        text     NOT NULL,
  address     text     NOT NULL,
  PRIMARY KEY (location_id, lang)
);
