/**
 * Shared helpers for the Prisma operational scripts (seed-content, seed-diagnose,
 * upload-missing-r2, reconcile-audios). Pure utilities + shared JSON row types —
 * no top-level side effects beyond resolving DATA_DIR.
 */

import { PrismaClient } from '@prisma/client';
import * as path from 'path';
import * as fs from 'fs';

// ── Data directory ────────────────────────────────────────────────────────────

/**
 * Repo root, anchored from prisma/lib/ with a fixed two-level hop so the
 * resolution stays correct regardless of where callers live.
 */
const REPO_ROOT = path.resolve(__dirname, '..', '..');

/** Default: the legacy site checked out as a sibling of this repo. */
const DEFAULT_DATA_DIR = path.join(REPO_ROOT, '..', 'imamzain.org', 'src', 'data');

/** Directory holding the legacy JSON exports. Override with SEED_DATA_DIR. */
export const DATA_DIR = process.env.SEED_DATA_DIR ?? DEFAULT_DATA_DIR;

/** Exit early with a clear message if the seed data directory is missing. */
export function assertDataDir(): void {
  if (fs.existsSync(DATA_DIR)) return;
  console.error(
    `Seed data directory not found: ${DATA_DIR}\n` +
      `Expected the legacy site checked out as a sibling of this repo\n` +
      `(../imamzain.org/src/data), or set SEED_DATA_DIR to the directory\n` +
      `containing the legacy JSON exports.`,
  );
  process.exit(1);
}

export function loadJson<T>(file: string): T {
  const fullPath = path.join(DATA_DIR, file);
  return JSON.parse(fs.readFileSync(fullPath, 'utf-8')) as T;
}

// ── URL / file helpers ────────────────────────────────────────────────────────

export function extractFilename(url: string): string {
  const decoded = decodeURIComponent(url.split('?')[0]);
  return decoded.split('/').pop() || 'unknown';
}

export function detectMimeType(url: string): string {
  const ext = url.split('?')[0].split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
    gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
    pdf: 'application/pdf',
  };
  return map[ext] ?? 'application/octet-stream';
}

export function normalizeUrl(url: string): string {
  if (!url || !url.trim()) return '';
  const u = url.trim();
  if (u.startsWith('http')) return u;
  if (u.startsWith('//')) return `https:${u}`;
  if (u.startsWith('/')) return `https://cdn.imamzain.org${u}`;
  return `https://cdn.imamzain.org/${u}`;
}

export function safeParseDate(dateStr: string | null | undefined): Date | null {
  if (!dateStr) return null;
  const cleaned = dateStr.trim().replace(/\s+/g, '');
  const d = new Date(cleaned);
  return isNaN(d.getTime()) ? null : d;
}

// ── Shared JSON row types (legacy exports) ────────────────────────────────────

export type BookJson = {
  id: number; slug: string; title: string; author?: string;
  printHouse?: string; printDate?: string;
  language?: string | string[]; pages?: number;
  parts?: number; views?: number; image?: string; pdf?: string;
  series?: string | null; partNumber?: number | null; totalParts?: number | null;
  category?: string | string[];
};

export type PostJson = {
  id: number; slug: string; image?: string; title: string;
  summary?: string; content: string; views?: number;
  date?: string; last_update?: string; category?: string;
  attachments?: { id: number; path: string }[];
};

export type GalleryJson = {
  id: number; name?: string; description?: string; date?: string;
  tags?: string[]; url: string; location?: string;
  photographer?: string; category?: string;
};

export type ResearchJson = {
  id: string; slug?: string; title: string; abstract?: string;
  author?: string; publishedYear?: string; pdfUrl?: string; conference?: string;
};

export type JournalJson = {
  id: string;
  translations?: { languageid: number; title: string; authors?: string[]; publicationVenue?: string; pagenam?: number }[];
  publishedYear?: string; pdfUrl?: string;
};

export type StudentJson = {
  id: string;
  translations?: { languageid: number; title: string; authors?: string[]; publicationVenue?: string; category?: string; pagenam?: number }[];
  publishedYear?: string; pdfUrl?: string;
};

export type HadithJson = { id: number; content: string };

export type StaticPageJson = { title: string; slug: string; content: string };

export type StoreJson = {
  city: string;
  sellpoints: {
    id: number;
    name: string;
    location: string;
    phone?: string;
    gps?: string;
    gpsLink?: string;
  }[];
};

export type AudioJson = {
  id: number;
  title: string;
  speaker: string;
  audio: string; // mp3 CDN url -> audio_url
  pdf?: string; // -> pdf_url (absent in the current export)
  durationSeconds?: number; // -> duration_seconds
  sizeMB?: number; // -> size_mb
  peaks?: number[]; // 300 floats -> peaks (jsonb)
};

// ── Speakers ──────────────────────────────────────────────────────────────────

/**
 * Find or create a speaker by its Arabic name. Caches within a run so the same
 * lecturer across many audios resolves to one row. Exact-name match only —
 * near-duplicate spellings produce distinct speakers an admin can merge later.
 */
export async function getOrCreateSpeaker(
  prisma: PrismaClient,
  cache: Map<string, string>,
  rawName: string | null | undefined,
): Promise<string | null> {
  const name = rawName?.trim();
  if (!name) return null;
  const cached = cache.get(name);
  if (cached) return cached;

  const existing = await prisma.speaker_translations.findFirst({
    where: { lang: 'ar', name, speakers: { deleted_at: null } },
    select: { speaker_id: true },
  });
  if (existing) {
    cache.set(name, existing.speaker_id);
    return existing.speaker_id;
  }

  const speaker = await prisma.speakers.create({
    data: { speaker_translations: { create: { lang: 'ar', name, is_default: true } } },
  });
  cache.set(name, speaker.id);
  return speaker.id;
}
