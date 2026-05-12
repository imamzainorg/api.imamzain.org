import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class YoutubeService {
  constructor(private readonly prisma: PrismaService) {}

  async findVideos(page: number, limit: number) {
    const skip = (page - 1) * limit;
    const [items, total] = await Promise.all([
      this.prisma.youtube_videos.findMany({
        orderBy: [{ published_at: 'desc' }, { id: 'asc' }],
        skip,
        take: limit,
      }),
      this.prisma.youtube_videos.count(),
    ]);

    return {
      message: 'Videos fetched',
      data: {
        items: items.map(serialiseVideo),
        pagination: { page, limit, total, pages: Math.ceil(total / limit) },
      },
    };
  }

  async findPlaylists(page: number, limit: number) {
    const skip = (page - 1) * limit;
    const [items, total] = await Promise.all([
      this.prisma.youtube_playlists.findMany({
        orderBy: [{ published_at: 'desc' }, { id: 'asc' }],
        skip,
        take: limit,
      }),
      this.prisma.youtube_playlists.count(),
    ]);

    return {
      message: 'Playlists fetched',
      data: {
        items: items.map(serialisePlaylist),
        pagination: { page, limit, total, pages: Math.ceil(total / limit) },
      },
    };
  }

  /**
   * Fetch a playlist and its videos in their YouTube-defined order. The
   * `playlistId` parameter is the YouTube playlist ID (e.g. `PLxxxx`),
   * not the internal UUID — that's the identifier the public site and
   * CMS know about.
   */
  async findPlaylistVideos(playlistId: string, limit: number) {
    const playlist = await this.prisma.youtube_playlists.findUnique({
      where: { playlist_id: playlistId },
    });
    if (!playlist) throw new NotFoundException('Playlist not found');

    const items = await this.prisma.youtube_playlist_items.findMany({
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
      },
    };
  }

  /** Used by the homepage aggregator to pull the most-recent N uploads. */
  async findRecentVideos(limit: number) {
    return this.prisma.youtube_videos.findMany({
      orderBy: [{ published_at: 'desc' }, { id: 'asc' }],
      take: limit,
    });
  }
}

function serialiseVideo(v: any) {
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

function serialisePlaylist(p: any) {
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
