import { YoutubeSyncService } from './youtube-sync.service';

type Json = Record<string, unknown>;

/** Route a YouTube Data API URL to a canned response by endpoint + query. */
function mockYoutubeApi(handlers: {
  channels?: () => Json;
  playlistItems?: (playlistId: string) => Json;
  playlists?: (url: URL) => Json;
  videos?: (ids: string[]) => Json;
}) {
  return jest.fn(async (input: string) => {
    const url = new URL(input);
    const endpoint = url.pathname.split('/').pop();
    let body: Json = { items: [] };
    if (endpoint === 'channels') body = handlers.channels?.() ?? body;
    if (endpoint === 'playlistItems') body = handlers.playlistItems?.(url.searchParams.get('playlistId') ?? '') ?? body;
    if (endpoint === 'playlists') body = handlers.playlists?.(url) ?? body;
    if (endpoint === 'videos') body = handlers.videos?.((url.searchParams.get('id') ?? '').split(',')) ?? body;
    return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
  });
}

const apiVideo = (id: string) => ({
  id,
  snippet: { title: `Video ${id}`, channelId: 'UC-main', publishedAt: '2026-01-01T00:00:00Z' },
  contentDetails: { duration: 'PT5M' },
  statistics: { viewCount: '10', likeCount: '1' },
});

const uploadItem = (videoId: string, position: number) => ({
  snippet: { title: videoId, channelId: 'UC-main', resourceId: { videoId }, position },
});

describe('YoutubeSyncService — pruning rows that vanished upstream', () => {
  const realFetch = global.fetch;
  let prisma: any;
  let service: YoutubeSyncService;

  beforeEach(() => {
    process.env.YOUTUBE_API_KEY = 'test-key';
    process.env.YOUTUBE_CHANNEL_ID = 'UC-main';

    prisma = {
      youtube_videos: {
        upsert: jest.fn(async ({ where }: any) => ({ id: `uuid-${where.video_id}` })),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(100),
        deleteMany: jest.fn(async ({ where }: any) => ({ count: where.id.in.length })),
      },
      youtube_playlists: {
        upsert: jest.fn(async ({ where }: any) => ({ id: `uuid-${where.playlist_id}` })),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(20),
        deleteMany: jest.fn(async ({ where }: any) => ({ count: where.id.in.length })),
      },
      youtube_playlist_items: { deleteMany: jest.fn(), createMany: jest.fn() },
      $transaction: jest.fn().mockResolvedValue([]),
    };
    service = new YoutubeSyncService(prisma);
  });

  afterEach(() => {
    global.fetch = realFetch;
    delete process.env.YOUTUBE_API_KEY;
    delete process.env.YOUTUBE_CHANNEL_ID;
  });

  function withApi(extra: Parameters<typeof mockYoutubeApi>[0] = {}) {
    global.fetch = mockYoutubeApi({
      channels: () => ({ items: [{ contentDetails: { relatedPlaylists: { uploads: 'UU-uploads' } } }] }),
      playlistItems: () => ({ items: [uploadItem('fresh-1', 0)] }),
      playlists: () => ({ items: [] }),
      videos: (ids) => ({ items: ids.filter((id) => id === 'fresh-1').map(apiVideo) }),
      ...extra,
    }) as unknown as typeof fetch;
  }

  it('sends the API key in a header and never in the URL, on every kind of call', async () => {
    prisma.youtube_videos.findMany.mockResolvedValue([{ id: 'uuid-old', video_id: 'old' }]);
    prisma.youtube_playlists.findMany.mockResolvedValue([{ id: 'uuid-PL', playlist_id: 'PL-1' }]);
    withApi({
      playlists: (url) => (url.searchParams.get('id') ? { items: [{ id: 'PL-1' }] } : { items: [{ id: 'PL-1', snippet: { title: 'p', channelId: 'UC-main' } }] }),
      videos: (ids) => ({ items: ids.map(apiVideo) }),
    });

    await service.sync('manual');

    const calls = (global.fetch as unknown as jest.Mock).mock.calls as Array<[string, { headers?: Record<string, string> }]>;
    const endpoints = new Set(calls.map(([url]) => new URL(url).pathname.split('/').pop()));
    // channels, playlistItems, playlists (list + by-id prune check) and videos are all exercised.
    expect(endpoints).toEqual(new Set(['channels', 'playlistItems', 'playlists', 'videos']));
    for (const [url, init] of calls) {
      expect(url).not.toMatch(/[?&]key=/);
      expect(url).not.toContain('test-key');
      expect(init.headers).toEqual({ 'x-goog-api-key': 'test-key' });
    }
  });

  it('deletes a video YouTube no longer returns, and keeps (refreshing) one it still does', async () => {
    prisma.youtube_videos.findMany.mockResolvedValue([
      { id: 'uuid-old-public', video_id: 'old-public' },
      { id: 'uuid-made-private', video_id: 'made-private' },
    ]);
    withApi({
      videos: (ids) => ({ items: ids.filter((id) => id !== 'made-private').map(apiVideo) }),
    });

    const result = await service.sync('manual');

    expect(result).toEqual({ videos: 1, playlists: 0 });
    // Only rows the sync did not touch are candidates.
    expect(prisma.youtube_videos.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { last_synced_at: { lt: expect.any(Date) } } }),
    );
    expect(prisma.youtube_videos.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['uuid-made-private'] } } });
    // The still-public older upload was re-upserted, which refreshes its stats
    // and stamps last_synced_at so it is not re-checked first next time.
    expect(prisma.youtube_videos.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { video_id: 'old-public' } }),
    );
  });

  it('deletes a playlist that was removed or made private upstream', async () => {
    prisma.youtube_playlists.findMany.mockResolvedValue([
      { id: 'uuid-PL-kept', playlist_id: 'PL-kept' },
      { id: 'uuid-PL-gone', playlist_id: 'PL-gone' },
    ]);
    withApi({
      // First call lists the channel's playlists (none); the prune re-check
      // asks by id and only PL-kept still resolves.
      playlists: (url) => (url.searchParams.get('id') ? { items: [{ id: 'PL-kept' }] } : { items: [] }),
    });

    await service.sync('manual');

    expect(prisma.youtube_playlists.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['uuid-PL-gone'] } } });
  });

  it('deletes nothing when every untouched row still exists', async () => {
    prisma.youtube_videos.findMany.mockResolvedValue([{ id: 'uuid-old', video_id: 'old' }]);
    withApi({ videos: (ids) => ({ items: ids.map(apiVideo) }) });

    await service.sync('manual');

    expect(prisma.youtube_videos.deleteMany).not.toHaveBeenCalled();
    expect(prisma.youtube_playlists.deleteMany).not.toHaveBeenCalled();
  });

  it('refuses a mass delete (upstream anomaly) instead of emptying the mirror', async () => {
    const untouched = Array.from({ length: 60 }, (_, i) => ({ id: `uuid-${i}`, video_id: `v-${i}` }));
    prisma.youtube_videos.findMany.mockResolvedValue(untouched);
    prisma.youtube_videos.count.mockResolvedValue(100); // 60 of 100 > 25 %
    withApi(); // videos.list returns none of them

    const result = await service.sync('manual');

    expect(prisma.youtube_videos.deleteMany).not.toHaveBeenCalled();
    expect(result).toEqual({ videos: 1, playlists: 0 });
  });

  it('never prunes after a failed sync', async () => {
    prisma.youtube_videos.findMany.mockResolvedValue([{ id: 'uuid-x', video_id: 'x' }]);
    global.fetch = jest.fn(async () => ({
      ok: false,
      status: 403,
      text: async () => 'quotaExceeded',
      json: async () => ({}),
    })) as unknown as typeof fetch;

    const result = await service.sync('manual');

    expect(result).toBeNull();
    expect(prisma.youtube_videos.findMany).not.toHaveBeenCalled();
    expect(prisma.youtube_videos.deleteMany).not.toHaveBeenCalled();
  });

  it('keeps the sync result when the prune itself fails', async () => {
    prisma.youtube_videos.findMany.mockRejectedValue(new Error('db hiccup'));
    withApi();

    const result = await service.sync('manual');

    expect(result).toEqual({ videos: 1, playlists: 0 });
    expect(prisma.youtube_videos.deleteMany).not.toHaveBeenCalled();
  });
});
