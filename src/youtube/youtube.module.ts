import { Module, OnApplicationBootstrap } from '@nestjs/common';
import { YoutubeController } from './youtube.controller';
import { YoutubeService } from './youtube.service';
import { YoutubeSyncService } from './youtube-sync.service';

/**
 * The sync service runs on a 6-hour cron, but on first boot we also fire
 * a single sync after a 30-second delay so a freshly-deployed server
 * isn't empty until the first cron tick (~6h later in the worst case).
 *
 * The delay lets HTTP traffic settle first; the sync itself runs in the
 * background and never blocks the request path. `runGuardedSync` applies
 * both the cross-instance advisory lock and the recency freshness check,
 * so a restart loop or a multi-replica fleet can't trigger a sync storm
 * and burn YouTube API quota.
 */
@Module({
  providers: [YoutubeService, YoutubeSyncService],
  controllers: [YoutubeController],
  exports: [YoutubeService, YoutubeSyncService],
})
export class YoutubeModule implements OnApplicationBootstrap {
  constructor(private readonly sync: YoutubeSyncService) {}

  onApplicationBootstrap() {
    setTimeout(() => {
      void this.sync.runGuardedSync('bootstrap');
    }, 30_000);
  }
}
