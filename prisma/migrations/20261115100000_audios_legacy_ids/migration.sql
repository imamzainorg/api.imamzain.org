-- Additive: the website's old numeric audio ids, so its /media/audio?id=N share links keep resolving.
-- An array because two old rows (231 and 236) shared one mp3, which is one audio here.
-- Filled by prisma/seed-content.ts from the website's JSON.
ALTER TABLE audios ADD COLUMN IF NOT EXISTS legacy_ids integer[] NOT NULL DEFAULT '{}';
