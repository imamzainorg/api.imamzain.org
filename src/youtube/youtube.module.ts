import { Module, OnApplicationBootstrap } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { YoutubeController } from './youtube.controller';
import { YoutubeService } from './youtube.service';
import { YoutubeSyncService } from './youtube-sync.service';

const BOOTSTRAP_SYNC_FRESHNESS_MS = 6 * 60 * 60 * 1000;

/**
 * The sync service runs on a 6-hour cron, but on first boot we also fire
 * a single sync after a 30-second delay so a freshly-deployed server
 * isn't empty until the first cron tick (~6h later in the worst case).
 *
 * The delay lets HTTP traffic settle first; the sync itself runs in the
 * background and never blocks the request path. Skipped if the most
 * recent video sync is under 6h old, so a restart loop doesn't trigger
 * a sync storm and burn YouTube API quota.
 */
@Module({
  providers: [YoutubeService, YoutubeSyncService],
  controllers: [YoutubeController],
  exports: [YoutubeService, YoutubeSyncService],
})
export class YoutubeModule implements OnApplicationBootstrap {
  constructor(
    private readonly sync: YoutubeSyncService,
    private readonly prisma: PrismaService,
  ) {}

  onApplicationBootstrap() {
    setTimeout(async () => {
      try {
        const latest = await this.prisma.youtube_videos.findFirst({
          orderBy: { last_synced_at: 'desc' },
          select: { last_synced_at: true },
        });
        if (
          latest?.last_synced_at &&
          Date.now() - latest.last_synced_at.getTime() < BOOTSTRAP_SYNC_FRESHNESS_MS
        ) {
          return;
        }
      } catch {
        // If the freshness check fails (DB not ready, table missing, etc.)
        // fall through to the sync anyway — we'd rather double-sync once
        // than skip indefinitely.
      }
      void this.sync.sync('bootstrap');
    }, 30_000);
  }
}
