-- ===========================================================================
-- 20260608120000_audios
--
-- Audio lecture library, i18n + first-class speakers.
--
--   speakers              — one row per lecturer/خطيب (language-agnostic).
--   speaker_translations  — per-language name.
--   audios                — one row per recording (MP3 on R2) + optional PDF, a
--                           single language-agnostic slug, and analysis metadata
--                           (duration_seconds, size_mb, peaks). FK to speakers.
--   audio_translations    — per-language title.
--
-- `audio_url` is unique — it is the idempotency key for re-seeding/reconcile.
-- The audio `slug` is a single, language-agnostic canonical slug (nullable,
-- freed on soft-delete by suffixing, so the partial-unique index only covers
-- non-NULL slugs — same technique as the book/paper slug indexes).
--
-- Additive only — no existing table is touched. Re-running is safe (every
-- statement is guarded with IF NOT EXISTS or a DO-block constraint check).
-- ===========================================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ── speakers ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS speakers (
  id         uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  updated_at timestamptz(6) NOT NULL DEFAULT now(),
  deleted_at timestamptz(6)
);

CREATE TABLE IF NOT EXISTS speaker_translations (
  speaker_id uuid    NOT NULL,
  lang       char(2) NOT NULL,
  name       text    NOT NULL,
  is_default boolean NOT NULL DEFAULT false,
  PRIMARY KEY (speaker_id, lang)
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'speaker_translations_speaker_id_fkey') THEN
    ALTER TABLE speaker_translations
      ADD CONSTRAINT speaker_translations_speaker_id_fkey
      FOREIGN KEY (speaker_id) REFERENCES speakers(id) ON DELETE CASCADE ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'speaker_translations_lang_fkey') THEN
    ALTER TABLE speaker_translations
      ADD CONSTRAINT speaker_translations_lang_fkey
      FOREIGN KEY (lang) REFERENCES languages(code) ON DELETE CASCADE ON UPDATE NO ACTION;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_speaker_translations_name_trgm
  ON speaker_translations USING GIN (name gin_trgm_ops);

-- ── audios ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audios (
  id               uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  speaker_id       uuid,
  audio_url        text           NOT NULL,
  pdf_url          text,
  slug             text,
  duration_seconds integer,
  size_mb          double precision,
  peaks            jsonb,
  is_published     boolean        NOT NULL DEFAULT true,
  created_at       timestamptz(6) NOT NULL DEFAULT now(),
  updated_at       timestamptz(6) NOT NULL DEFAULT now(),
  deleted_at       timestamptz(6),
  added_by         uuid
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'audios_speaker_id_fkey') THEN
    -- ON DELETE NO ACTION (RESTRICT): a DB-level backstop for the service guard
    -- that refuses to delete a speaker while live audios still reference it.
    ALTER TABLE audios
      ADD CONSTRAINT audios_speaker_id_fkey
      FOREIGN KEY (speaker_id) REFERENCES speakers(id) ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'audios_added_by_fkey') THEN
    -- ON DELETE SET NULL: clear the audit pointer when the author is deleted,
    -- matching the books/gallery added_by convention (don't block user deletion).
    ALTER TABLE audios
      ADD CONSTRAINT audios_added_by_fkey
      FOREIGN KEY (added_by) REFERENCES users(id) ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;

-- audio_url unique — every recording maps to exactly one CDN object. This is
-- the idempotency key for re-seeding and reconcile (Prisma maps it to @unique).
CREATE UNIQUE INDEX IF NOT EXISTS uq_audios_audio_url ON audios (audio_url);

-- Partial-unique slug (single, language-agnostic canonical slug). WHERE slug IS
-- NOT NULL frees the slug on soft-delete via suffixing.
CREATE UNIQUE INDEX IF NOT EXISTS uq_audios_slug ON audios (slug) WHERE slug IS NOT NULL;

-- Publish + soft-delete composite for the admin and public list filters.
CREATE INDEX IF NOT EXISTS idx_audios_published ON audios (is_published, deleted_at);
CREATE INDEX IF NOT EXISTS idx_audios_speaker_id ON audios (speaker_id);
CREATE INDEX IF NOT EXISTS idx_audios_added_by ON audios (added_by);

CREATE TABLE IF NOT EXISTS audio_translations (
  audio_id   uuid    NOT NULL,
  lang       char(2) NOT NULL,
  title      text    NOT NULL,
  is_default boolean NOT NULL DEFAULT false,
  PRIMARY KEY (audio_id, lang)
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'audio_translations_audio_id_fkey') THEN
    ALTER TABLE audio_translations
      ADD CONSTRAINT audio_translations_audio_id_fkey
      FOREIGN KEY (audio_id) REFERENCES audios(id) ON DELETE CASCADE ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'audio_translations_lang_fkey') THEN
    ALTER TABLE audio_translations
      ADD CONSTRAINT audio_translations_lang_fkey
      FOREIGN KEY (lang) REFERENCES languages(code) ON DELETE CASCADE ON UPDATE NO ACTION;
  END IF;
END $$;

-- Trigram so GET /search and the ?search= list filter can use `%` against title.
CREATE INDEX IF NOT EXISTS idx_audio_translations_title_trgm
  ON audio_translations USING GIN (title gin_trgm_ops);
