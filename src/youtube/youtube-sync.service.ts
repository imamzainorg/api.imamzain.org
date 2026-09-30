import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { cronsDisabled } from '../common/utils/cron.util';
import { PrismaService } from '../prisma/prisma.service';
import { ADVISORY_LOCK_KEYS, withAdvisoryLock } from '../common/utils/advisory-lock.util';

const YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3';
// The API key travels in this header, never in the URL: a query-string key ends
// up in every access log, proxy log and error report that records the URL.
const YOUTUBE_API_KEY_HEADER = 'x-goog-api-key';
const SYNC_TIMEOUT_MS = 30_000;
// The whole guarded sync is allowed to hold its advisory-lock transaction this
// long; a normal sync is sub-minute, but a slow channel with many playlists
// can run longer, and we'd rather hold the lock than abort mid-run.
const SYNC_LOCK_TIMEOUT_MS = 600_000;
// If a successful sync landed more recently than this, the guarded path skips —
// stops a restart loop or a multi-replica cron tick from re-syncing within the
// 6-hour window even after one replica already did the work.
const SYNC_MIN_INTERVAL_MS = 5 * 60 * 60 * 1000 + 30 * 60 * 1000; // 5h30m
const MAX_RECENT_UPLOADS = 50;
const MAX_PLAYLISTS_PER_CHANNEL = 50;
const MAX_VIDEOS_PER_PLAYLIST = 200;
// Pruning (see pruneVanished). Rows a sync did not touch are re-checked by id
// before anything is deleted; this bounds that re-check (1 quota unit per 50).
const MAX_PRUNE_CHECKS_PER_SYNC = 2_000;
// Safety valve on an automatic delete: if one run wants to remove more than a
// quarter of the mirror (and more than a handful of rows), something upstream
// is off — skip and shout rather than empty the homepage.
const PRUNE_MAX_SHARE = 0.25;
const PRUNE_ALWAYS_ALLOWED = 10;

type YouTubeApiVideo = {
  id: string;
  snippet: {
    title: string;
    description?: string;
    thumbnails?: { high?: { url: string }; medium?: { url: string }; default?: { url: string } };
    channelId: string;
    channelTitle?: string;
    publishedAt: string;
  };
  contentDetails?: { duration?: string };
  statistics?: { viewCount?: string; likeCount?: string };
};

type YouTubePlaylistItem = {
  snippet: {
    title: string;
    description?: string;
    thumbnails?: { high?: { url: string }; medium?: { url: string }; default?: { url: string } };
    channelId: string;
    publishedAt?: string;
    resourceId: { videoId: string };
    position: number;
  };
};

type YouTubeApiPlaylist = {
  id: string;
  snippet: {
    title: string;
    description?: string;
    thumbnails?: { high?: { url: string }; medium?: { url: string }; default?: { url: string } };
    channelId: string;
    publishedAt?: string;
  };
  contentDetails?: { itemCount?: number };
};

/**
 * Syncs the configured YouTube channel's videos and playlists into local
 * tables every 6 hours. The public `/youtube/*` endpoints and the
 * `/homepage` aggregator read from those tables — never from YouTube
 * directly. This keeps YouTube Data API quota use predictable (~40 units
 * per day at default cadence vs. a 10k/day free quota) and means the
 * site survives YouTube outages or rate-limit hits.
 *
 * Sync strategy:
 * 1. Resolve the channel's `uploads` playlist ID via channels.list (1 unit).
 * 2. Pull the most recent N uploads via playlistItems.list (1 unit per page).
 * 3. Pull all public playlists on the channel via playlists.list (1 unit per page).
 * 4. For each playlist, pull its items.
 * 5. Hydrate every unique video ID with full details via videos.list (1 unit per 50).
 * 6. Prune: re-check by id every mirror row steps 1–5 didn't touch and delete
 *    the ones YouTube no longer returns (deleted / made private) — 1 unit per 50.
 *
 * Total per sync: ~10–20 units depending on playlist count, plus ~1 unit per
 * 50 older videos that sit outside the recent-uploads window and every playlist.
 *
 * Boot behaviour: skipped silently when `YOUTUBE_API_KEY` or
 * `YOUTUBE_CHANNEL_ID` are unset — same pattern as the SMTP service.
 * Local dev without a key still boots cleanly; the homepage just gets
 * an empty videos array.
 */
@Injectable()
export class YoutubeSyncService {
  private readonly logger = new Logger(YoutubeSyncService.name);
  private isRunning = false;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Runs every 6 hours (see the cron expression on the decorator below).
   * The first run also fires shortly after boot via `onApplicationBootstrap`
   * so a freshly-deployed server doesn't have to wait up to 6 hours before
   * the homepage has videos.
   */
  @Cron('0 */6 * * *')
  async runScheduledSync() {
    await this.runGuardedSync('cron');
  }

  /**
   * Multi-instance-safe entry point. Every replica runs the cron, so the work
   * is gated behind a Postgres advisory lock: only one instance acquires it and
   * performs the YouTube Data API fetch; the others `pg_try` → false and return
   * immediately (no blocking). A freshness check inside the lock means even the
   * winner skips if a recent sync is still fresh — so a restart storm or an
   * overlapping bootstrap+cron can't burn N× the API quota.
   */
  async runGuardedSync(
    trigger: 'cron' | 'bootstrap' | 'manual',
  ): Promise<{ videos: number; playlists: number } | null> {
    // Covers cron, bootstrap, and manual triggers alike — operator scripts
    // set DISABLE_CRON so a maintenance run never burns YouTube API quota.
    if (cronsDisabled()) return null;
    let result: { videos: number; playlists: number } | null = null;
    try {
      const ran = await withAdvisoryLock(
        this.prisma,
        ADVISORY_LOCK_KEYS.YOUTUBE_SYNC,
        async () => {
          if (await this.syncedWithin(SYNC_MIN_INTERVAL_MS)) {
            this.logger.log(`YouTube sync (${trigger}) skipped — a recent sync is still fresh`);
            return;
          }
          result = await this.sync(trigger);
        },
        SYNC_LOCK_TIMEOUT_MS,
      );
      if (!ran) {
        this.logger.log(`YouTube sync (${trigger}) skipped — another instance holds the lock`);
      }
    } catch (err) {
      // Never let a lock timeout / DB hiccup surface as an unhandled rejection
      // on the cron path; the next tick retries.
      this.logger.error(
        `YouTube guarded sync (${trigger}) failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    return result;
  }

  /** True if the most recently synced video was written within `ms`. */
  private async syncedWithin(ms: number): Promise<boolean> {
    const latest = await this.prisma.youtube_videos.findFirst({
      orderBy: { last_synced_at: 'desc' },
      select: { last_synced_at: true },
    });
    return !!latest?.last_synced_at && Date.now() - latest.last_synced_at.getTime() < ms;
  }

  async sync(trigger: 'cron' | 'bootstrap' | 'manual'): Promise<{ videos: number; playlists: number } | null> {
    const apiKey = process.env.YOUTUBE_API_KEY;
    const channelId = process.env.YOUTUBE_CHANNEL_ID;

    if (!apiKey || !channelId) {
      this.logger.warn('YouTube sync skipped — YOUTUBE_API_KEY or YOUTUBE_CHANNEL_ID not set');
      return null;
    }

    if (this.isRunning) {
      this.logger.log(`YouTube sync (${trigger}) skipped — previous run still in progress`);
      return null;
    }
    this.isRunning = true;

    try {
      this.logger.log(`YouTube sync starting (trigger=${trigger})`);
      // Every row this run writes gets last_synced_at >= this instant, so
      // "older than syncStartedAt" afterwards means "this run never saw it".
      const syncStartedAt = new Date();

      const uploadsPlaylistId = await this.resolveUploadsPlaylistId(channelId, apiKey);
      if (!uploadsPlaylistId) {
        this.logger.warn(`Channel ${channelId} not found or has no uploads playlist`);
        return null;
      }

      const recentUploadItems = await this.fetchPlaylistItems(uploadsPlaylistId, apiKey, MAX_RECENT_UPLOADS);
      const playlists = await this.fetchChannelPlaylists(channelId, apiKey);

      // Build the full set of video IDs across recent uploads + every
      // playlist's contents, then hydrate them all in batches of 50.
      const playlistItemsByPlaylist = new Map<string, YouTubePlaylistItem[]>();
      for (const pl of playlists) {
        const items = await this.fetchPlaylistItems(pl.id, apiKey, MAX_VIDEOS_PER_PLAYLIST);
        playlistItemsByPlaylist.set(pl.id, items);
      }

      const allVideoIds = new Set<string>();
      for (const item of recentUploadItems) allVideoIds.add(item.snippet.resourceId.videoId);
      for (const items of playlistItemsByPlaylist.values()) {
        for (const item of items) allVideoIds.add(item.snippet.resourceId.videoId);
      }

      const hydratedVideos = await this.fetchVideoDetails(Array.from(allVideoIds), apiKey);

      // Upsert into local tables.
      const upsertedVideos = await this.upsertVideos(hydratedVideos);
      const upsertedPlaylists = await this.upsertPlaylists(playlists, playlistItemsByPlaylist, upsertedVideos);

      // Only reached when every fetch + upsert above succeeded — a partial
      // sync must never be allowed to decide what no longer exists.
      const pruned = await this.pruneVanished(syncStartedAt, apiKey);

      this.logger.log(
        `YouTube sync complete (trigger=${trigger}): ${upsertedVideos.size} videos, ${upsertedPlaylists} playlists` +
          `; pruned ${pruned.videos} video(s), ${pruned.playlists} playlist(s)`,
      );

      return { videos: upsertedVideos.size, playlists: upsertedPlaylists };
    } catch (err) {
      this.logger.error(`YouTube sync failed: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    } finally {
      this.isRunning = false;
    }
  }

  // ── YouTube Data API calls ─────────────────────────────────────────────

  private async resolveUploadsPlaylistId(channelId: string, apiKey: string): Promise<string | null> {
    const url = `${YOUTUBE_API_BASE}/channels?part=contentDetails&id=${encodeURIComponent(channelId)}`;
    const data = await this.fetchJson(url, apiKey);
    const items = data.items ?? [];
    if (items.length === 0) return null;
    return items[0].contentDetails?.relatedPlaylists?.uploads ?? null;
  }

  private async fetchPlaylistItems(playlistId: string, apiKey: string, cap: number): Promise<YouTubePlaylistItem[]> {
    const out: YouTubePlaylistItem[] = [];
    let pageToken: string | undefined;

    while (out.length < cap) {
      const pageSize = Math.min(50, cap - out.length);
      const url =
        `${YOUTUBE_API_BASE}/playlistItems?part=snippet&playlistId=${encodeURIComponent(playlistId)}` +
        `&maxResults=${pageSize}` +
        (pageToken ? `&pageToken=${pageToken}` : '');
      const data = await this.fetchJson(url, apiKey);
      const items: YouTubePlaylistItem[] = data.items ?? [];
      out.push(...items);
      pageToken = data.nextPageToken;
      if (!pageToken) break;
    }

    return out;
  }

  private async fetchChannelPlaylists(channelId: string, apiKey: string): Promise<YouTubeApiPlaylist[]> {
    const out: YouTubeApiPlaylist[] = [];
    let pageToken: string | undefined;

    while (out.length < MAX_PLAYLISTS_PER_CHANNEL) {
      const url =
        `${YOUTUBE_API_BASE}/playlists?part=snippet,contentDetails&channelId=${encodeURIComponent(channelId)}` +
        `&maxResults=50` +
        (pageToken ? `&pageToken=${pageToken}` : '');
      const data = await this.fetchJson(url, apiKey);
      const items: YouTubeApiPlaylist[] = data.items ?? [];
      out.push(...items);
      pageToken = data.nextPageToken;
      if (!pageToken) break;
    }

    return out;
  }

  private async fetchVideoDetails(videoIds: string[], apiKey: string): Promise<YouTubeApiVideo[]> {
    if (videoIds.length === 0) return [];
    const out: YouTubeApiVideo[] = [];

    // videos.list accepts up to 50 ids per call.
    for (let i = 0; i < videoIds.length; i += 50) {
      const batch = videoIds.slice(i, i + 50);
      const url =
        `${YOUTUBE_API_BASE}/videos?part=snippet,contentDetails,statistics` +
        `&id=${batch.map(encodeURIComponent).join(',')}`;
      const data = await this.fetchJson(url, apiKey);
      const items: YouTubeApiVideo[] = data.items ?? [];
      out.push(...items);
    }

    return out;
  }

  // ── Upserts into local tables ──────────────────────────────────────────

  /** Returns a map of YouTube video_id → internal UUID for downstream joins. */
  private async upsertVideos(videos: YouTubeApiVideo[]): Promise<Map<string, string>> {
    const idMap = new Map<string, string>();

    for (const v of videos) {
      const upserted = await this.prisma.youtube_videos.upsert({
        where: { video_id: v.id },
        create: {
          video_id: v.id,
          title: v.snippet.title,
          description: v.snippet.description ?? null,
          thumbnail_url: pickThumbnail(v.snippet.thumbnails),
          channel_id: v.snippet.channelId,
          channel_title: v.snippet.channelTitle ?? null,
          published_at: v.snippet.publishedAt ? new Date(v.snippet.publishedAt) : null,
          duration: v.contentDetails?.duration ?? null,
          view_count: v.statistics?.viewCount ? BigInt(v.statistics.viewCount) : null,
          like_count: v.statistics?.likeCount ? BigInt(v.statistics.likeCount) : null,
          last_synced_at: new Date(),
        },
        update: {
          title: v.snippet.title,
          description: v.snippet.description ?? null,
          thumbnail_url: pickThumbnail(v.snippet.thumbnails),
          channel_title: v.snippet.channelTitle ?? null,
          duration: v.contentDetails?.duration ?? null,
          view_count: v.statistics?.viewCount ? BigInt(v.statistics.viewCount) : null,
          like_count: v.statistics?.likeCount ? BigInt(v.statistics.likeCount) : null,
          last_synced_at: new Date(),
        },
      });
      idMap.set(v.id, upserted.id);
    }

    return idMap;
  }

  /** Returns the number of playlists actually persisted. */
  private async upsertPlaylists(
    playlists: YouTubeApiPlaylist[],
    itemsByPlaylist: Map<string, YouTubePlaylistItem[]>,
    videoIdMap: Map<string, string>,
  ): Promise<number> {
    for (const pl of playlists) {
      const upserted = await this.prisma.youtube_playlists.upsert({
        where: { playlist_id: pl.id },
        create: {
          playlist_id: pl.id,
          title: pl.snippet.title,
          description: pl.snippet.description ?? null,
          thumbnail_url: pickThumbnail(pl.snippet.thumbnails),
          item_count: pl.contentDetails?.itemCount ?? null,
          channel_id: pl.snippet.channelId,
          published_at: pl.snippet.publishedAt ? new Date(pl.snippet.publishedAt) : null,
          last_synced_at: new Date(),
        },
        update: {
          title: pl.snippet.title,
          description: pl.snippet.description ?? null,
          thumbnail_url: pickThumbnail(pl.snippet.thumbnails),
          item_count: pl.contentDetails?.itemCount ?? null,
          last_synced_at: new Date(),
        },
      });

      // Replace the playlist→video join rows for this playlist. We delete
      // first because YouTube can reorder / drop videos from a playlist
      // between syncs, and we want the local state to mirror that. Wrapped
      // in a transaction so a crash between the delete and the recreate
      // doesn't leave the playlist visibly empty until the next sync.
      const items = itemsByPlaylist.get(pl.id) ?? [];
      const joins = items
        .map((item) => {
          const internalVideoId = videoIdMap.get(item.snippet.resourceId.videoId);
          if (!internalVideoId) return null;
          return {
            playlist_id: upserted.id,
            video_id: internalVideoId,
            position: item.snippet.position,
          };
        })
        .filter((x): x is { playlist_id: string; video_id: string; position: number } => x !== null);

      // A video can legitimately appear more than once in a YouTube playlist,
      // but (playlist_id, video_id) is the PK here. Deduplicate to the lowest
      // position so createMany's skipDuplicates isn't silently dropping an
      // arbitrary occurrence (which left the surviving `position`
      // nondeterministic). item_count keeps mirroring YouTube's authoritative
      // count rather than this row count.
      const dedupedJoins = Array.from(
        joins
          .reduce((map, j) => {
            const existing = map.get(j.video_id);
            if (!existing || j.position < existing.position) map.set(j.video_id, j);
            return map;
          }, new Map<string, { playlist_id: string; video_id: string; position: number }>())
          .values(),
      );

      await this.prisma.$transaction([
        this.prisma.youtube_playlist_items.deleteMany({ where: { playlist_id: upserted.id } }),
        ...(dedupedJoins.length > 0
          ? [
              this.prisma.youtube_playlist_items.createMany({
                data: dedupedJoins,
                skipDuplicates: true,
              }),
            ]
          : []),
      ]);
    }

    return playlists.length;
  }

  // ── Pruning ────────────────────────────────────────────────────────────

  /**
   * Drop mirror rows for videos / playlists that no longer exist publicly on
   * YouTube. The mirror was upsert-only, so anything deleted or made private
   * upstream stayed on the homepage and in /youtube/* forever.
   *
   * "This sync didn't touch it" is NOT proof it is gone: a sync only walks the
   * 50 newest uploads plus playlist contents (capped), so an older upload that
   * sits in no playlist is legitimately untouched. Each untouched row is
   * therefore re-checked BY ID — videos.list / playlists.list simply omit ids
   * that are deleted or private — and only the omitted ones are removed.
   * Videos that do still exist get their stats refreshed on the way.
   *
   * Never throws: a failed prune must not fail a sync whose upserts landed.
   */
  private async pruneVanished(syncStartedAt: Date, apiKey: string): Promise<{ videos: number; playlists: number }> {
    try {
      const videos = await this.pruneVanishedVideos(syncStartedAt, apiKey);
      const playlists = await this.pruneVanishedPlaylists(syncStartedAt, apiKey);
      return { videos, playlists };
    } catch (err) {
      this.logger.warn(`YouTube prune skipped: ${err instanceof Error ? err.message : String(err)}`);
      return { videos: 0, playlists: 0 };
    }
  }

  /** True when deleting `goneCount` of `total` rows is small enough to trust. */
  private pruneLooksSane(kind: string, goneCount: number, total: number): boolean {
    const allowed = Math.max(PRUNE_ALWAYS_ALLOWED, Math.floor(total * PRUNE_MAX_SHARE));
    if (goneCount <= allowed) return true;
    this.logger.warn(
      `YouTube prune refused: ${goneCount} of ${total} ${kind} look deleted upstream (limit ${allowed} per sync) — ` +
        'verify the channel / API key, then remove them manually if this is real',
    );
    return false;
  }

  private async pruneVanishedVideos(syncStartedAt: Date, apiKey: string): Promise<number> {
    const untouched = await this.prisma.youtube_videos.findMany({
      where: { last_synced_at: { lt: syncStartedAt } },
      select: { id: true, video_id: true },
      // Oldest-checked first, so a backlog larger than the cap rotates through
      // over successive syncs (a re-check bumps last_synced_at).
      orderBy: { last_synced_at: 'asc' },
      take: MAX_PRUNE_CHECKS_PER_SYNC,
    });
    if (untouched.length === 0) return 0;

    const stillPublic = await this.fetchVideoDetails(untouched.map((v) => v.video_id), apiKey);
    await this.upsertVideos(stillPublic);

    const alive = new Set(stillPublic.map((v) => v.id));
    const gone = untouched.filter((v) => !alive.has(v.video_id));
    if (gone.length === 0) return 0;

    const total = await this.prisma.youtube_videos.count();
    if (!this.pruneLooksSane('videos', gone.length, total)) return 0;

    // youtube_playlist_items rows cascade.
    const { count } = await this.prisma.youtube_videos.deleteMany({
      where: { id: { in: gone.map((v) => v.id) } },
    });
    return count;
  }

  private async pruneVanishedPlaylists(syncStartedAt: Date, apiKey: string): Promise<number> {
    const untouched = await this.prisma.youtube_playlists.findMany({
      where: { last_synced_at: { lt: syncStartedAt } },
      select: { id: true, playlist_id: true },
      take: MAX_PRUNE_CHECKS_PER_SYNC,
    });
    if (untouched.length === 0) return 0;

    const alive = await this.fetchExistingPlaylistIds(untouched.map((p) => p.playlist_id), apiKey);
    const gone = untouched.filter((p) => !alive.has(p.playlist_id));
    if (gone.length === 0) return 0;

    const total = await this.prisma.youtube_playlists.count();
    if (!this.pruneLooksSane('playlists', gone.length, total)) return 0;

    const { count } = await this.prisma.youtube_playlists.deleteMany({
      where: { id: { in: gone.map((p) => p.id) } },
    });
    return count;
  }

  /** Which of these playlist ids still resolve publicly (1 quota unit per 50). */
  private async fetchExistingPlaylistIds(playlistIds: string[], apiKey: string): Promise<Set<string>> {
    const found = new Set<string>();
    for (let i = 0; i < playlistIds.length; i += 50) {
      const batch = playlistIds.slice(i, i + 50);
      const url =
        `${YOUTUBE_API_BASE}/playlists?part=id&maxResults=50` +
        `&id=${batch.map(encodeURIComponent).join(',')}`;
      const data = await this.fetchJson(url, apiKey);
      for (const item of (data.items ?? []) as Array<{ id: string }>) found.add(item.id);
    }
    return found;
  }

  // ── HTTP helper ────────────────────────────────────────────────────────

  private async fetchJson(url: string, apiKey: string): Promise<any> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), SYNC_TIMEOUT_MS);

    try {
      const res = await fetch(url, { signal: controller.signal, headers: { [YOUTUBE_API_KEY_HEADER]: apiKey } });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`YouTube API ${res.status}: ${body.slice(0, 200)}`);
      }
      return await res.json();
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

function pickThumbnail(thumbs: { high?: { url: string }; medium?: { url: string }; default?: { url: string } } | undefined): string | null {
  if (!thumbs) return null;
  return thumbs.high?.url ?? thumbs.medium?.url ?? thumbs.default?.url ?? null;
}
