import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';

const YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3';
const SYNC_TIMEOUT_MS = 30_000;
const MAX_RECENT_UPLOADS = 50;
const MAX_PLAYLISTS_PER_CHANNEL = 50;
const MAX_VIDEOS_PER_PLAYLIST = 200;

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
 *
 * Total per sync: ~10–20 units depending on playlist count.
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
    await this.sync('cron');
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

      this.logger.log(
        `YouTube sync complete (trigger=${trigger}): ${upsertedVideos.size} videos, ${upsertedPlaylists} playlists`,
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
    const url = `${YOUTUBE_API_BASE}/channels?part=contentDetails&id=${encodeURIComponent(channelId)}&key=${apiKey}`;
    const data = await this.fetchJson(url);
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
        `&maxResults=${pageSize}&key=${apiKey}` +
        (pageToken ? `&pageToken=${pageToken}` : '');
      const data = await this.fetchJson(url);
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
        `&maxResults=50&key=${apiKey}` +
        (pageToken ? `&pageToken=${pageToken}` : '');
      const data = await this.fetchJson(url);
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
        `&id=${batch.map(encodeURIComponent).join(',')}&key=${apiKey}`;
      const data = await this.fetchJson(url);
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
      // between syncs, and we want the local state to mirror that.
      await this.prisma.youtube_playlist_items.deleteMany({ where: { playlist_id: upserted.id } });

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

      if (joins.length > 0) {
        await this.prisma.youtube_playlist_items.createMany({
          data: joins,
          skipDuplicates: true,
        });
      }
    }

    return playlists.length;
  }

  // ── HTTP helper ────────────────────────────────────────────────────────

  private async fetchJson(url: string): Promise<any> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), SYNC_TIMEOUT_MS);

    try {
      const res = await fetch(url, { signal: controller.signal });
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
