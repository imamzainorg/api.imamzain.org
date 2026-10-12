// Nest source: YoutubeSyncService (src/youtube/youtube-sync.service.ts). Mirrors the channel's videos and
// playlists into local tables; /youtube/* and /homepage read only those. ~10–20 quota units per sync.
import type { PrismaClient } from '../generated/prisma/client';
import type { AppBindings } from '../lib/types';

const YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3';
// The key goes in a header, never the URL: a query-string key ends up in every log that records the URL.
const YOUTUBE_API_KEY_HEADER = 'x-goog-api-key';
const SYNC_TIMEOUT_MS = 30_000;
/** A sync that landed more recently than this makes the next one skip (a retried or repeated tick). */
const SYNC_MIN_INTERVAL_MS = 5 * 60 * 60 * 1000 + 30 * 60 * 1000;
const MAX_RECENT_UPLOADS = 50;
const MAX_PLAYLISTS_PER_CHANNEL = 50;
const MAX_VIDEOS_PER_PLAYLIST = 200;
/** Untouched rows re-checked by id per sync before anything is pruned (1 quota unit per 50). */
const MAX_PRUNE_CHECKS_PER_SYNC = 2_000;
// If one run wants to remove more than a quarter of the mirror (and more than a handful of rows),
// something upstream is off: skip and warn rather than empty the homepage.
const PRUNE_MAX_SHARE = 0.25;
const PRUNE_ALWAYS_ALLOWED = 10;

type Thumbnails = { high?: { url: string }; medium?: { url: string }; default?: { url: string } };

type YouTubeApiVideo = {
  id: string;
  snippet: { title: string; description?: string; thumbnails?: Thumbnails; channelId: string; channelTitle?: string; publishedAt: string };
  contentDetails?: { duration?: string };
  statistics?: { viewCount?: string; likeCount?: string };
};

type YouTubePlaylistItem = {
  snippet: { resourceId: { videoId: string }; position: number };
};

type YouTubeApiPlaylist = {
  id: string;
  snippet: { title: string; description?: string; thumbnails?: Thumbnails; channelId: string; publishedAt?: string };
  contentDetails?: { itemCount?: number };
};

type SyncEnv = Pick<AppBindings, 'YOUTUBE_API_KEY' | 'YOUTUBE_CHANNEL_ID'>;

/** The guarded entry point: skips while the last sync is still fresh. Never throws. */
export async function runGuardedSync(db: PrismaClient, env: SyncEnv): Promise<{ videos: number; playlists: number } | null> {
  try {
    const latest = await db.youtube_videos.findFirst({ orderBy: { last_synced_at: 'desc' }, select: { last_synced_at: true } });
    if (latest?.last_synced_at && Date.now() - latest.last_synced_at.getTime() < SYNC_MIN_INTERVAL_MS) {
      console.log('YouTube sync (cron) skipped — a recent sync is still fresh');
      return null;
    }
    return await sync(db, env);
  } catch (err) {
    console.error(`YouTube guarded sync (cron) failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

async function sync(db: PrismaClient, env: SyncEnv): Promise<{ videos: number; playlists: number } | null> {
  const apiKey = env.YOUTUBE_API_KEY;
  const channelId = env.YOUTUBE_CHANNEL_ID;
  if (!apiKey || !channelId) {
    console.warn('YouTube sync skipped — YOUTUBE_API_KEY or YOUTUBE_CHANNEL_ID not set');
    return null;
  }

  try {
    console.log('YouTube sync starting (trigger=cron)');
    // Every row this run writes gets last_synced_at >= this instant, so older means "this run never saw it".
    const syncStartedAt = new Date();

    const uploadsPlaylistId = await resolveUploadsPlaylistId(channelId, apiKey);
    if (!uploadsPlaylistId) {
      console.warn(`Channel ${channelId} not found or has no uploads playlist`);
      return null;
    }

    const recentUploadItems = await fetchPlaylistItems(uploadsPlaylistId, apiKey, MAX_RECENT_UPLOADS);
    const playlists = await fetchChannelPlaylists(channelId, apiKey);

    const playlistItemsByPlaylist = new Map<string, YouTubePlaylistItem[]>();
    for (const pl of playlists) playlistItemsByPlaylist.set(pl.id, await fetchPlaylistItems(pl.id, apiKey, MAX_VIDEOS_PER_PLAYLIST));

    const allVideoIds = new Set<string>();
    for (const item of recentUploadItems) allVideoIds.add(item.snippet.resourceId.videoId);
    for (const items of playlistItemsByPlaylist.values()) for (const item of items) allVideoIds.add(item.snippet.resourceId.videoId);

    const hydratedVideos = await fetchVideoDetails([...allVideoIds], apiKey);
    const upsertedVideos = await upsertVideos(db, hydratedVideos);
    const upsertedPlaylists = await upsertPlaylists(db, playlists, playlistItemsByPlaylist, upsertedVideos);

    // Only reached when every fetch and upsert succeeded: a partial sync must never decide what is gone.
    const pruned = await pruneVanished(db, syncStartedAt, apiKey);

    console.log(
      `YouTube sync complete (trigger=cron): ${upsertedVideos.size} videos, ${upsertedPlaylists} playlists` +
        `; pruned ${pruned.videos} video(s), ${pruned.playlists} playlist(s)`,
    );
    return { videos: upsertedVideos.size, playlists: upsertedPlaylists };
  } catch (err) {
    console.error(`YouTube sync failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

async function resolveUploadsPlaylistId(channelId: string, apiKey: string): Promise<string | null> {
  const data = await fetchJson(`${YOUTUBE_API_BASE}/channels?part=contentDetails&id=${encodeURIComponent(channelId)}`, apiKey);
  const items = data.items ?? [];
  if (items.length === 0) return null;
  return items[0].contentDetails?.relatedPlaylists?.uploads ?? null;
}

async function fetchPlaylistItems(playlistId: string, apiKey: string, cap: number): Promise<YouTubePlaylistItem[]> {
  const out: YouTubePlaylistItem[] = [];
  let pageToken: string | undefined;
  while (out.length < cap) {
    const pageSize = Math.min(50, cap - out.length);
    const url =
      `${YOUTUBE_API_BASE}/playlistItems?part=snippet&playlistId=${encodeURIComponent(playlistId)}` +
      `&maxResults=${pageSize}` +
      (pageToken ? `&pageToken=${pageToken}` : '');
    const data = await fetchJson(url, apiKey);
    out.push(...((data.items ?? []) as YouTubePlaylistItem[]));
    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }
  return out;
}

async function fetchChannelPlaylists(channelId: string, apiKey: string): Promise<YouTubeApiPlaylist[]> {
  const out: YouTubeApiPlaylist[] = [];
  let pageToken: string | undefined;
  while (out.length < MAX_PLAYLISTS_PER_CHANNEL) {
    const url =
      `${YOUTUBE_API_BASE}/playlists?part=snippet,contentDetails&channelId=${encodeURIComponent(channelId)}` +
      `&maxResults=50` +
      (pageToken ? `&pageToken=${pageToken}` : '');
    const data = await fetchJson(url, apiKey);
    out.push(...((data.items ?? []) as YouTubeApiPlaylist[]));
    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }
  return out;
}

async function fetchVideoDetails(videoIds: string[], apiKey: string): Promise<YouTubeApiVideo[]> {
  const out: YouTubeApiVideo[] = [];
  // videos.list takes up to 50 ids per call.
  for (let i = 0; i < videoIds.length; i += 50) {
    const batch = videoIds.slice(i, i + 50);
    const url = `${YOUTUBE_API_BASE}/videos?part=snippet,contentDetails,statistics&id=${batch.map(encodeURIComponent).join(',')}`;
    const data = await fetchJson(url, apiKey);
    out.push(...((data.items ?? []) as YouTubeApiVideo[]));
  }
  return out;
}

/** Returns YouTube video_id → internal id, for the playlist joins. */
async function upsertVideos(db: PrismaClient, videos: YouTubeApiVideo[]): Promise<Map<string, string>> {
  const idMap = new Map<string, string>();
  for (const v of videos) {
    const fields = {
      title: v.snippet.title,
      description: v.snippet.description ?? null,
      thumbnail_url: pickThumbnail(v.snippet.thumbnails),
      channel_title: v.snippet.channelTitle ?? null,
      duration: v.contentDetails?.duration ?? null,
      view_count: v.statistics?.viewCount ? BigInt(v.statistics.viewCount) : null,
      like_count: v.statistics?.likeCount ? BigInt(v.statistics.likeCount) : null,
      last_synced_at: new Date(),
    };
    const upserted = await db.youtube_videos.upsert({
      where: { video_id: v.id },
      create: {
        ...fields,
        video_id: v.id,
        channel_id: v.snippet.channelId,
        published_at: v.snippet.publishedAt ? new Date(v.snippet.publishedAt) : null,
      },
      update: fields,
    });
    idMap.set(v.id, upserted.id);
  }
  return idMap;
}

async function upsertPlaylists(
  db: PrismaClient,
  playlists: YouTubeApiPlaylist[],
  itemsByPlaylist: Map<string, YouTubePlaylistItem[]>,
  videoIdMap: Map<string, string>,
): Promise<number> {
  for (const pl of playlists) {
    const fields = {
      title: pl.snippet.title,
      description: pl.snippet.description ?? null,
      thumbnail_url: pickThumbnail(pl.snippet.thumbnails),
      item_count: pl.contentDetails?.itemCount ?? null,
      last_synced_at: new Date(),
    };
    const upserted = await db.youtube_playlists.upsert({
      where: { playlist_id: pl.id },
      create: { ...fields, playlist_id: pl.id, channel_id: pl.snippet.channelId, published_at: pl.snippet.publishedAt ? new Date(pl.snippet.publishedAt) : null },
      update: fields,
    });

    // A video can appear twice in a YouTube playlist, but (playlist_id, video_id) is the key here: keep
    // the lowest position so the surviving row is deterministic.
    const joins = new Map<string, { playlist_id: string; video_id: string; position: number }>();
    for (const item of itemsByPlaylist.get(pl.id) ?? []) {
      const videoId = videoIdMap.get(item.snippet.resourceId.videoId);
      if (!videoId) continue;
      const existing = joins.get(videoId);
      if (!existing || item.snippet.position < existing.position) joins.set(videoId, { playlist_id: upserted.id, video_id: videoId, position: item.snippet.position });
    }

    // Replace the joins in one transaction, so a failure never leaves the playlist visibly empty.
    await db.$transaction([
      db.youtube_playlist_items.deleteMany({ where: { playlist_id: upserted.id } }),
      ...(joins.size > 0 ? [db.youtube_playlist_items.createMany({ data: [...joins.values()], skipDuplicates: true })] : []),
    ]);
  }
  return playlists.length;
}

/**
 * Drops mirror rows for videos and playlists that are deleted or private upstream. "Not touched by this
 * sync" isn't proof (a sync walks only the newest uploads and the playlists), so each untouched row is
 * re-checked by id and only the ones YouTube omits are removed. Never throws.
 */
async function pruneVanished(db: PrismaClient, syncStartedAt: Date, apiKey: string): Promise<{ videos: number; playlists: number }> {
  try {
    const videos = await pruneVanishedVideos(db, syncStartedAt, apiKey);
    const playlists = await pruneVanishedPlaylists(db, syncStartedAt, apiKey);
    return { videos, playlists };
  } catch (err) {
    console.warn(`YouTube prune skipped: ${err instanceof Error ? err.message : String(err)}`);
    return { videos: 0, playlists: 0 };
  }
}

function pruneLooksSane(kind: string, goneCount: number, total: number): boolean {
  const allowed = Math.max(PRUNE_ALWAYS_ALLOWED, Math.floor(total * PRUNE_MAX_SHARE));
  if (goneCount <= allowed) return true;
  console.warn(
    `YouTube prune refused: ${goneCount} of ${total} ${kind} look deleted upstream (limit ${allowed} per sync) — ` +
      'verify the channel / API key, then remove them manually if this is real',
  );
  return false;
}

async function pruneVanishedVideos(db: PrismaClient, syncStartedAt: Date, apiKey: string): Promise<number> {
  const untouched = await db.youtube_videos.findMany({
    where: { last_synced_at: { lt: syncStartedAt } },
    select: { id: true, video_id: true },
    // Oldest-checked first, so a backlog over the cap rotates through successive syncs.
    orderBy: { last_synced_at: 'asc' },
    take: MAX_PRUNE_CHECKS_PER_SYNC,
  });
  if (untouched.length === 0) return 0;

  const stillPublic = await fetchVideoDetails(untouched.map((v) => v.video_id), apiKey);
  await upsertVideos(db, stillPublic);

  const alive = new Set(stillPublic.map((v) => v.id));
  const gone = untouched.filter((v) => !alive.has(v.video_id));
  if (gone.length === 0) return 0;
  if (!pruneLooksSane('videos', gone.length, await db.youtube_videos.count())) return 0;

  // youtube_playlist_items rows cascade.
  const { count } = await db.youtube_videos.deleteMany({ where: { id: { in: gone.map((v) => v.id) } } });
  return count;
}

async function pruneVanishedPlaylists(db: PrismaClient, syncStartedAt: Date, apiKey: string): Promise<number> {
  const untouched = await db.youtube_playlists.findMany({
    where: { last_synced_at: { lt: syncStartedAt } },
    select: { id: true, playlist_id: true },
    take: MAX_PRUNE_CHECKS_PER_SYNC,
  });
  if (untouched.length === 0) return 0;

  const alive = new Set<string>();
  for (let i = 0; i < untouched.length; i += 50) {
    const batch = untouched.slice(i, i + 50).map((p) => p.playlist_id);
    const data = await fetchJson(`${YOUTUBE_API_BASE}/playlists?part=id&maxResults=50&id=${batch.map(encodeURIComponent).join(',')}`, apiKey);
    for (const item of (data.items ?? []) as Array<{ id: string }>) alive.add(item.id);
  }
  const gone = untouched.filter((p) => !alive.has(p.playlist_id));
  if (gone.length === 0) return 0;
  if (!pruneLooksSane('playlists', gone.length, await db.youtube_playlists.count())) return 0;

  const { count } = await db.youtube_playlists.deleteMany({ where: { id: { in: gone.map((p) => p.id) } } });
  return count;
}

async function fetchJson(url: string, apiKey: string): Promise<any> {
  const res = await fetch(url, { signal: AbortSignal.timeout(SYNC_TIMEOUT_MS), headers: { [YOUTUBE_API_KEY_HEADER]: apiKey } });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`YouTube API ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

function pickThumbnail(thumbs: Thumbnails | undefined): string | null {
  if (!thumbs) return null;
  return thumbs.high?.url ?? thumbs.medium?.url ?? thumbs.default?.url ?? null;
}
