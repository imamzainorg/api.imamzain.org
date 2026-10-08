import type { Context } from 'hono';
import type { youtube_playlists, youtube_videos } from '../../generated/prisma/client';
import { getDb } from '../../lib/db';
import { notFound } from '../../lib/errors';
import { buildPaginationMeta, resolvePagination } from '../../lib/pagination';
import type { AppEnv } from '../../lib/types';

type Ctx = Context<AppEnv>;

export async function findVideos(c: Ctx, query: { page: number; limit: number }) {
  const db = getDb(c);
  const { page, limit, skip } = resolvePagination(query);
  const [items, total] = await Promise.all([
    db.youtube_videos.findMany({
      orderBy: [{ published_at: 'desc' }, { id: 'asc' }],
      skip,
      take: limit,
    }),
    db.youtube_videos.count(),
  ]);

  return {
    message: 'Videos fetched',
    data: { items: items.map(serialiseVideo), pagination: buildPaginationMeta(page, limit, total) },
  };
}

export async function findPlaylists(c: Ctx, query: { page: number; limit: number }) {
  const db = getDb(c);
  const { page, limit, skip } = resolvePagination(query);
  const [items, total] = await Promise.all([
    db.youtube_playlists.findMany({
      orderBy: [{ published_at: 'desc' }, { id: 'asc' }],
      skip,
      take: limit,
    }),
    db.youtube_playlists.count(),
  ]);

  return {
    message: 'Playlists fetched',
    data: {
      items: items.map(serialisePlaylist),
      pagination: buildPaginationMeta(page, limit, total),
    },
  };
}

/** `playlistId` is YouTube's id (`PLxxxx`), not the internal UUID. */
export async function findPlaylistVideos(c: Ctx, playlistId: string, limit: number) {
  const db = getDb(c);
  const playlist = await db.youtube_playlists.findUnique({ where: { playlist_id: playlistId } });
  if (!playlist) throw notFound('Playlist not found');

  const items = await db.youtube_playlist_items.findMany({
    where: { playlist_id: playlist.id },
    include: { youtube_videos: true },
    orderBy: { position: 'asc' },
    take: limit,
  });

  return {
    message: 'Playlist videos fetched',
    data: {
      playlist: serialisePlaylist(playlist),
      videos: items.map((i) => serialiseVideo(i.youtube_videos)),
      // YouTube's own count: may exceed videos.length when `limit` truncates the page.
      total: playlist.item_count,
    },
  };
}

/**
 * The homepage's latest uploads. The mirror also holds other channels' videos that only sit in one of
 * the foundation's playlists, so with a channel configured only its own are "recent uploads".
 */
export async function findRecentVideos(c: Ctx, limit: number) {
  const channelId = c.env.YOUTUBE_CHANNEL_ID?.trim();
  return getDb(c).youtube_videos.findMany({
    where: channelId ? { channel_id: channelId } : undefined,
    orderBy: [{ published_at: 'desc' }, { id: 'asc' }],
    take: limit,
  });
}

function serialiseVideo(v: youtube_videos) {
  return {
    video_id: v.video_id,
    title: v.title,
    description: v.description,
    thumbnail_url: v.thumbnail_url,
    channel_id: v.channel_id,
    channel_title: v.channel_title,
    published_at: v.published_at,
    duration: v.duration,
    view_count: v.view_count !== null && v.view_count !== undefined ? Number(v.view_count) : null,
    like_count: v.like_count !== null && v.like_count !== undefined ? Number(v.like_count) : null,
    last_synced_at: v.last_synced_at,
  };
}

function serialisePlaylist(p: youtube_playlists) {
  return {
    playlist_id: p.playlist_id,
    title: p.title,
    description: p.description,
    thumbnail_url: p.thumbnail_url,
    item_count: p.item_count,
    channel_id: p.channel_id,
    published_at: p.published_at,
    last_synced_at: p.last_synced_at,
  };
}
