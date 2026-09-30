import { YoutubeService } from './youtube.service';

describe('YoutubeService.findRecentVideos (homepage videos)', () => {
  const original = process.env.YOUTUBE_CHANNEL_ID;
  let prisma: any;
  let service: YoutubeService;

  beforeEach(() => {
    prisma = { youtube_videos: { findMany: jest.fn().mockResolvedValue([]) } };
    service = new YoutubeService(prisma);
  });

  afterEach(() => {
    if (original === undefined) delete process.env.YOUTUBE_CHANNEL_ID;
    else process.env.YOUTUBE_CHANNEL_ID = original;
  });

  it("is restricted to the foundation's own channel, so playlist guests never surface", async () => {
    process.env.YOUTUBE_CHANNEL_ID = 'UC-foundation';

    await service.findRecentVideos(7);

    expect(prisma.youtube_videos.findMany).toHaveBeenCalledWith({
      where: { channel_id: 'UC-foundation' },
      orderBy: [{ published_at: 'desc' }, { id: 'asc' }],
      take: 7,
    });
  });

  it('tolerates stray whitespace in the configured channel id', async () => {
    process.env.YOUTUBE_CHANNEL_ID = '  UC-foundation \n';

    await service.findRecentVideos(3);

    expect(prisma.youtube_videos.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { channel_id: 'UC-foundation' } }),
    );
  });

  it('filters nothing when no channel is configured (the sync is off then too)', async () => {
    delete process.env.YOUTUBE_CHANNEL_ID;

    await service.findRecentVideos(7);

    expect(prisma.youtube_videos.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: undefined, take: 7 }));
  });

  it('treats a blank channel id as unset', async () => {
    process.env.YOUTUBE_CHANNEL_ID = '   ';

    await service.findRecentVideos(7);

    expect(prisma.youtube_videos.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: undefined }));
  });

  it('leaves the /youtube/videos listing untouched: playlist guests still appear there', async () => {
    process.env.YOUTUBE_CHANNEL_ID = 'UC-foundation';
    prisma.youtube_videos.count = jest.fn().mockResolvedValue(0);

    await service.findVideos(1, 20);

    expect(prisma.youtube_videos.findMany).toHaveBeenCalledWith(
      expect.not.objectContaining({ where: expect.anything() }),
    );
  });
});
